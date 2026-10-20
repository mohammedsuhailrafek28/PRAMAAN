import { Router } from "express";
import { UserRole } from "@prisma/client";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/roles.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { confirmCorrection, getReview } from "./evidence-intelligence.service.js";
import { cancelReviewJob, getReviewJob, startReviewJob } from "./evidence-review-jobs.service.js";

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

// Polling is frequent and cheap (a row read), so it has its own, much more generous limit.
const pollLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 900,
  keyGenerator: (req) => req.user?.id ?? "anonymous",
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many status checks. Please wait a moment." } }
});
const jobParams = z.object({ jobId: z.string().min(1).max(64) });

router.use(requireAuth, requireRole([UserRole.MSME]));

// Start (or join) a review job. Returns immediately with a job id; the work happens in the background.
router.post("/jobs", reviewLimit, asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(202).json(await startReviewJob(req.user!.id));
}));

router.get("/jobs/:jobId", pollLimit, validate({ params: jobParams }), asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await getReviewJob(req.user!.id, String(req.params.jobId)));
}));

router.post("/jobs/:jobId/cancel", reviewLimit, validate({ params: jobParams }), asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await cancelReviewJob(req.user!.id, String(req.params.jobId)));
}));


router.get("/review", reviewLimit, asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ review: await getReview(req.user!.id) });
}));

router.post("/corrections", reviewLimit, validate({ body: correctionBody }), asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { claim, sourceDocumentId, source } = req.body as z.infer<typeof correctionBody>;
  res.json({ review: await confirmCorrection(req.user!.id, { claim, sourceDocumentId, source }) });
}));

export default router;
