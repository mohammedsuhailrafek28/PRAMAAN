import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./consent.controller.js";

const router = Router();

const createSchema = z.object({
  businessGstin: z.string().trim().toUpperCase(),
  requestedFields: z.array(z.string()).min(1)
});
const listQuery = z.object({ scope: z.enum(["incoming", "outgoing"]) });
const params = z.object({ id: z.string().min(1) });
const approveSchema = z.object({
  approvedFields: z.array(z.string()).min(1),
  durationDays: z.number().int().positive().max(365)
});

router.use(requireAuth);
router.post("/", validate({ body: createSchema }), asyncHandler(controller.create));
router.get("/", validate({ query: listQuery }), asyncHandler(controller.list));
router.patch("/:id/approve", validate({ params, body: approveSchema }), asyncHandler(controller.approve));
router.patch("/:id/reject", validate({ params }), asyncHandler(controller.reject));
router.patch("/:id/revoke", validate({ params }), asyncHandler(controller.revoke));

export default router;
