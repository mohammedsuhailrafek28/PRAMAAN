import { chromium, type Browser } from "playwright";
import { ApiError } from "../../../utils/apiError.js";

const maxConcurrentPdfRenders = 2;
const renderTimeoutMs = 30000;
let activePdfRenders = 0;
const waitQueue: Array<() => void> = [];
let browserPromise: Promise<Browser> | null = null;

async function acquireSlot() {
  if (activePdfRenders < maxConcurrentPdfRenders) {
    activePdfRenders += 1;
    return;
  }

  await new Promise<void>((resolve) => waitQueue.push(resolve));
  activePdfRenders += 1;
}

function releaseSlot() {
  activePdfRenders = Math.max(0, activePdfRenders - 1);
  const next = waitQueue.shift();
  if (next) next();
}

async function getBrowser() {
  browserPromise ??= chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"]
  });
  return browserPromise;
}

export async function closePdfBrowser() {
  const browser = await browserPromise;
  browserPromise = null;
  await browser?.close();
}

export async function renderPdfFromHtml(input: { html: string; reportId: string; generatedAt: string }) {
  await acquireSlot();
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new ApiError(503, "PDF_RENDER_TIMEOUT", "PDF rendering timed out.")), renderTimeoutMs);
  });

  try {
    return await Promise.race([renderPdf(input), timeoutPromise]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "PDF_RENDER_UNAVAILABLE", "PDF renderer is unavailable.");
  } finally {
    if (timeout) clearTimeout(timeout);
    releaseSlot();
  }
}

async function renderPdf(input: { html: string; reportId: string; generatedAt: string }) {
  const browser = await getBrowser();
  const page = await browser.newPage({ javaScriptEnabled: false });
  try {
    await page.setContent(input.html, { waitUntil: "load", timeout: renderTimeoutMs });
    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      margin: {
        top: "18mm",
        right: "14mm",
        bottom: "20mm",
        left: "14mm"
      },
      headerTemplate: `<div style="font-family:Arial,sans-serif;font-size:8px;color:#59636e;width:100%;padding:0 14mm;">PRAMAAN</div>`,
      footerTemplate: `<div style="font-family:Arial,sans-serif;font-size:8px;color:#59636e;width:100%;padding:0 14mm;display:flex;justify-content:space-between;"><span>PRAMAAN - ${escapeAttribute(input.reportId)} - ${escapeAttribute(input.generatedAt)}</span><span>Evidence-backed report - not an approval or certificate - Page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
    });
    return Buffer.from(buffer);
  } finally {
    await page.close().catch(() => undefined);
  }
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

process.once("exit", () => {
  void closePdfBrowser();
});
