import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./trustView.controller.js";
import { registeredConclusionRateLimit } from "../evidenceFirewall/firewall-rate-limit.js";
import { z } from "zod";

const router = Router();
const params = z.object({ consentRequestId: z.string().min(1) });
const conclusion = z.union([
  z.object({ kind: z.literal("FIELD_SUPPORTED_BY_EVIDENCE"), field: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("FIELD_NOT_CONTRADICTED"), field: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("EVIDENCE_CURRENT"), docType: z.string().min(1) }).strict()
]);

router.get("/:consentRequestId", requireAuth, validate({ params }), asyncHandler(controller.get));
router.post("/:consentRequestId/conclusions", requireAuth, registeredConclusionRateLimit, validate({ params, body: conclusion }), asyncHandler(controller.conclusions));

export default router;
