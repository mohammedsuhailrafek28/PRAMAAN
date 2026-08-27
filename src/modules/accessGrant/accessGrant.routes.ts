import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./accessGrant.controller.js";

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
export default router;
