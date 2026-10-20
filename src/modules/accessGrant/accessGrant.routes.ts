import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./accessGrant.controller.js";
import { guestConclusionRateLimit, guestIpConclusionRateLimit } from "../evidenceFirewall/firewall-rate-limit.js";
import { z } from "zod";

const router = Router();
const scope = z.object({ fields: z.array(z.string()).default([]), evidenceTypes: z.array(z.string()).default([]) });
const createSchema = z.object({
  recipientName: z.string().max(120).optional(), recipientOrganization: z.string().max(160).optional(), recipientEmail: z.string().email().max(180).optional(),
  purpose: z.string().min(1), scope, durationHours: z.number().positive().max(8760).optional(), expiresAt: z.string().datetime().optional()
});
const params = z.object({ id: z.string().min(1) });

router.post("/", requireAuth, validate({ body: createSchema }), asyncHandler(controller.create));
router.get("/", requireAuth, asyncHandler(controller.list));
router.patch("/:id/revoke", requireAuth, validate({ params }), asyncHandler(controller.revoke));

export const guestRouter = Router();
guestRouter.get("/:token", asyncHandler(controller.guest));
const conclusion = z.union([
  z.object({ kind: z.literal("FIELD_SUPPORTED_BY_EVIDENCE"), field: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("FIELD_NOT_CONTRADICTED"), field: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("EVIDENCE_CURRENT"), docType: z.string().min(1) }).strict()
]);
guestRouter.post("/:token/conclusions", guestIpConclusionRateLimit, guestConclusionRateLimit, validate({ body: conclusion }), asyncHandler(controller.conclusions));
export default router;
