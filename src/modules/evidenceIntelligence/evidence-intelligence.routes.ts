import { Router } from "express";
import { UserRole } from "@prisma/client";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/roles.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { confirmCorrection, getReview } from "./evidence-intelligence.service.js";

const router = Router();

// Extraction reads and parses stored files, so it is throttled per owner on top of the global API limit.
const reviewLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.user?.id ?? "anonymous",
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many evidence reviews. Please wait a few minutes." } }
});

const correctionBody = z.object({
  claim: z.enum(["legalName", "gstin", "pan", "udyamNumber"]),
  sourceDocumentId: z.string().min(1).max(64).nullable(),
  source: z.enum(["DOCUMENT_TEXT", "GSTIN_EMBEDDED_PAN", "ACCOUNT_ORGANIZATION_NAME"]),
  confirm: z.literal(true)
}).strict();

router.use(requireAuth, requireRole([UserRole.MSME]), reviewLimit);

router.get("/review", asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ review: await getReview(req.user!.id) });
}));

router.post("/corrections", validate({ body: correctionBody }), asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { claim, sourceDocumentId, source } = req.body as z.infer<typeof correctionBody>;
  res.json({ review: await confirmCorrection(req.user!.id, { claim, sourceDocumentId, source }) });
}));

export default router;
