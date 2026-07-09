import { Router } from "express";
import { UserRole } from "@prisma/client";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/roles.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as auditService from "./audit.service.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requireRole([UserRole.MSME]),
  asyncHandler(async (req, res) => {
    res.json({ logs: await auditService.listForOwner(req.user!.id) });
  })
);

export default router;
