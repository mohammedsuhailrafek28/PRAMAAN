import { Router } from "express";
import { DocumentType, UserRole } from "@prisma/client";
import multer from "multer";
import path from "node:path";
import { z } from "zod";
import { env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/roles.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./business.controller.js";

const router = Router();

const upload = multer({
  dest: path.resolve(env.UPLOAD_DIR),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const businessSchema = z.object({
  legalName: z.string().min(2),
  gstin: z.string().trim().toUpperCase(),
  udyamNumber: z.string().trim().toUpperCase(),
  pan: z.string().trim().toUpperCase(),
  address: z.string().min(5),
  turnoverBand: z.string().min(1)
});

const docSchema = z.object({
  docType: z.nativeEnum(DocumentType)
});

router.use(requireAuth, requireRole([UserRole.MSME]));
router.post("/", validate({ body: businessSchema }), asyncHandler(controller.upsert));
router.get("/me", asyncHandler(controller.getMine));
router.patch("/me", validate({ body: businessSchema }), asyncHandler(controller.patchMine));
router.post(
  "/documents",
  upload.single("file"),
  validate({ body: docSchema }),
  asyncHandler(controller.uploadDocument)
);
router.post("/verify", asyncHandler(controller.verify));

export default router;
