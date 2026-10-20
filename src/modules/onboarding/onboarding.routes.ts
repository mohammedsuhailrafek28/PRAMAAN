import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/roles.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./onboarding.controller.js";

const router = Router();
const idParams = z.object({ id: z.string().min(1) });
const packParams = z.object({ key: z.string().min(1), version: z.string().optional() });
const listQuery = z.object({ scope: z.enum(["incoming", "outgoing"]) });
const createSchema = z.object({ businessGstin: z.string().trim().min(1).max(15).toUpperCase(), packKey: z.string().min(1), packVersion: z.string().optional(), purpose: z.string().trim().min(3).max(120) });

router.use(requireAuth);
router.get("/packs", validate({ query: z.object({}).passthrough() }), asyncHandler(controller.packs));
router.get("/packs/:key", validate({ params: z.object({ key: z.string().min(1) }) }), asyncHandler(controller.pack));
router.get("/packs/:key/:version", validate({ params: packParams }), asyncHandler(controller.pack));
router.post("/assignments", requireRole([UserRole.BUYER, UserRole.BANK]), validate({ body: createSchema }), asyncHandler(controller.create));
router.get("/assignments", validate({ query: listQuery }), asyncHandler(controller.list));
router.get("/assignments/:id", validate({ params: idParams }), asyncHandler(controller.detail));
router.patch("/assignments/:id/accept", requireRole([UserRole.MSME]), validate({ params: idParams }), asyncHandler(controller.accept));
router.patch("/assignments/:id/decline", requireRole([UserRole.MSME]), validate({ params: idParams }), asyncHandler(controller.decline));
router.patch("/assignments/:id/cancel", requireRole([UserRole.BUYER, UserRole.BANK]), validate({ params: idParams }), asyncHandler(controller.cancel));

export default router;
