import { ReportType } from "@prisma/client";
import type { ReportDocument } from "../src/modules/reportComposer/report-composer.types.js";
import { renderHtmlFromSnapshot } from "../src/modules/reportComposer/rendering/report-html-renderer.js";
import { renderPdfFromHtml, closePdfBrowser } from "../src/modules/reportComposer/rendering/report-pdf-renderer.js";

let failures = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

const baseDocument: ReportDocument = {
  reportId: "report_123",
  reportType: ReportType.VENDOR_ONBOARDING_READINESS,
  reportVersion: "1.0",
  generatedAt: "2026-07-14T00:00:00.000Z",
  expiresAt: null,
  revokedAt: null,
  business: {
    businessId: "business_1",
    businessName: "Sharma Textiles <script>alert(1)</script>",
    ownerName: "Ravi Sharma",
    identifiers: {
      gstin: "33ABCDE1234F1Z5",
      pan: "ABCDE1234F",
      udyamNumber: "UDYAM-TN-01-0001234"
    },
    address: "Chennai & Tamil Nadu"
  },
  headline: {
    statusLabel: "MOSTLY_READY",
    score: 72,
    level: "MOSTLY_READY",
    summary: "Prepared from stored snapshot only.",
    blocked: false
  },
  trustMetrics: [
    { metric: "trustReadiness", label: "Trust Readiness", score: 72, explanation: "Stored trust readiness." },
    { metric: "profileCompleteness", label: "Profile Completeness", score: 80, explanation: "Stored completeness." },
    { metric: "evidenceStrength", label: "Evidence Strength", score: 65, explanation: "Stored evidence strength." },
    { metric: "consistency", label: "Consistency", score: 90, explanation: "Stored consistency." },
    { metric: "freshness", label: "Freshness", score: 85, explanation: "Stored freshness." }
  ],
  identityFields: [
    {
      field: "gstin",
      label: "GSTIN",
      value: "33ABCDE1234F1Z5",
      evidenceStatus: "CROSS_CHECKED",
      confidence: 80,
      reason: "Internal format and consistency checks.",
      evidenceIds: ["doc_1"],
      checks: ["format"]
    },
    {
      field: "bankAccount",
      label: "Bank Account",
      value: "123456789012",
      evidenceStatus: "DOCUMENT_SUBMITTED",
      confidence: 45,
      reason: "Submitted evidence only.",
      evidenceIds: ["doc_2"],
      checks: []
    }
  ],
  requirements: [
    {
      requirementId: "vendor_bank_evidence",
      label: "Bank Evidence",
      status: "MISSING",
      score: 0,
      weight: 20,
      evidenceStatus: "SELF_DECLARED",
      reason: "Bank evidence missing.",
      nextAction: "Upload bank statement."
    }
  ],
  evidence: [
    {
      documentType: "GST_CERTIFICATE",
      fileName: "uploads/private/gst<script>.pdf",
      submittedAt: "2026-07-14T00:00:00.000Z",
      evidenceStatus: "DOCUMENT_SUBMITTED",
      confidence: 45,
      expiresAt: null,
      crossCheckMethod: "INTERNAL_METADATA_CHECK",
      reason: "Document contents were not parsed.",
      limitations: ["No authoritative source verification was performed."]
    }
  ],
  contradictions: [
    {
      field: "pan",
      severity: "HIGH",
      reason: "Stored contradiction.",
      claimedValue: "<img src=x onerror=alert(1)>",
      evidenceValues: ["ABCDE1234F"],
      resolutionNeeded: "Review submitted claim."
    }
  ],
  gaps: [{ field: "bankEvidence", severity: "HIGH", message: "Bank evidence missing." }],
  actions: [{ priority: "HIGH", title: "Upload bank statement", description: "Add evidence.", reason: "Missing requirement.", expectedStatusChange: "MISSING -> PARTIALLY_SATISFIED" }],
  timeline: [{ eventId: "audit_1", createdAt: "2026-07-14T00:00:00.000Z", title: "Report generated", description: "Snapshot stored.", actorRole: "MSME" }],
  limitations: ["No authoritative external source verification was performed."],
  disclaimer: "This is not an approval, certificate, eligibility decision, or credit assessment.",
  provenance: {
    businessId: "business_1",
    trustProfileId: "passport_1",
    trustProfileGeneratedAt: "2026-07-14T00:00:00.000Z",
    readinessEvaluationId: "ready_1",
    readinessProfileId: "vendor-onboarding",
    readinessProfileVersion: "1.0",
    sourceVerificationPerformed: false
  }
};

async function main() {
  await test("HTML renderer escapes user-controlled values and unsafe markup", () => {
    const html = renderHtmlFromSnapshot(baseDocument);
    assert(html.includes("Sharma Textiles &lt;script&gt;alert(1)&lt;/script&gt;"), "business name was not escaped");
    assert(!html.includes("<script>alert(1)</script>"), "script tag rendered");
    assert(!html.includes("<img"), "image tag rendered");
    assert(!html.includes("uploads/private"), "local path leaked");
    assert(html.includes("gst&lt;script&gt;.pdf"), "filename basename should be escaped and retained");
    assert(html.includes("********9012"), "bank-like value should be masked");
  });

  await test("HTML renderer shows limitations, provenance, and no external verification statement", () => {
    const html = renderHtmlFromSnapshot(baseDocument);
    assert(html.includes("No authoritative external source verification was performed."), "source verification limitation missing");
    assert(html.includes("Provenance"), "provenance missing");
    assert(html.includes("report_123"), "report ID missing");
  });

  await test("HTML renderer shows revoked state without removing content", () => {
    const revoked = { ...baseDocument, revokedAt: "2026-07-15T00:00:00.000Z" };
    const html = renderHtmlFromSnapshot(revoked);
    assert(html.includes("REVOKED"), "revoked watermark missing");
    assert(html.includes("Sharma Textiles"), "historical content missing after revoke");
  });

  await test("HTML renderer handles empty evidence and timeline gracefully", () => {
    const empty = { ...baseDocument, evidence: [], timeline: [] };
    const html = renderHtmlFromSnapshot(empty);
    assert(html.includes("No submitted evidence was stored"), "empty evidence state missing");
    assert(html.includes("No timeline events were stored"), "empty timeline state missing");
  });

  await test("PDF renderer returns a non-empty PDF buffer", async () => {
    const html = renderHtmlFromSnapshot(baseDocument);
    const pdf = await renderPdfFromHtml({ html, reportId: baseDocument.reportId, generatedAt: baseDocument.generatedAt });
    assert(pdf.length > 1000, "PDF too small");
    assert(pdf.subarray(0, 4).toString("utf8") === "%PDF", "PDF signature missing");
  });

  await test("PDF renderer handles concurrent requests within limiter", async () => {
    const html = renderHtmlFromSnapshot(baseDocument);
    const [a, b, c] = await Promise.all([
      renderPdfFromHtml({ html, reportId: "a", generatedAt: baseDocument.generatedAt }),
      renderPdfFromHtml({ html, reportId: "b", generatedAt: baseDocument.generatedAt }),
      renderPdfFromHtml({ html, reportId: "c", generatedAt: baseDocument.generatedAt })
    ]);
    assert([a, b, c].every((pdf) => pdf.subarray(0, 4).toString("utf8") === "%PDF"), "concurrent PDF render failed");
  });

  await closePdfBrowser().catch(() => undefined);

  if (failures > 0) {
    console.error(`\nReport rendering tests failed with ${failures} failure(s).`);
    process.exit(1);
  }

  console.log("\nReport rendering tests passed.");
}

main().catch(async (error) => {
  await closePdfBrowser().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
