import { Router } from "express";
import { UserRole } from "@prisma/client";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/roles.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./passport.controller.js";

const router = Router();

router.use(requireAuth, requireRole([UserRole.MSME]));
router.post("/generate", asyncHandler(controller.generate));
router.get("/me", asyncHandler(controller.getMine));

export default router;
