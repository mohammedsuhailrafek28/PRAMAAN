import { Router, type RequestHandler } from "express";
import { DocumentType, UserRole } from "@prisma/client";
import multer from "multer";
import { unlink } from "node:fs/promises";
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

async function removeUploadedFile(file: Express.Multer.File | undefined) {
  if (!file?.path) return;
  try {
    await unlink(file.path);
  } catch {
    // The file may already have been removed by a failed upload cleanup.
  }
}

const businessSchema = z.object({
  legalName: z.string().min(2),
  gstin: z.string().trim().toUpperCase(),
  udyamNumber: z.string().trim().toUpperCase(),
  pan: z.string().trim().toUpperCase(),
  address: z.string().min(5),
  turnoverBand: z.string().min(1)
});

const docSchema = z.object({
  docType: z.nativeEnum(DocumentType),
  issuedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  source: z.string().trim().max(120).optional()
});

const uploadSingleFile: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (error: unknown) => {
    if (error) {
      void removeUploadedFile(req.file).finally(() => next(error));
      return;
    }
    next();
  });
};

const validateDocumentBody: RequestHandler = (req, _res, next) => {
  try {
    req.body = docSchema.parse(req.body);
    next();
  } catch (error) {
    void removeUploadedFile(req.file).finally(() => next(error));
  }
};

const lookupParams = z.object({ gstin: z.string().trim().min(1).max(15).toUpperCase() });

router.get("/lookup/:gstin", requireAuth, requireRole([UserRole.BUYER, UserRole.BANK]), validate({ params: lookupParams }), asyncHandler(controller.lookup));

router.use(requireAuth, requireRole([UserRole.MSME]));
router.post("/", validate({ body: businessSchema }), asyncHandler(controller.upsert));
router.get("/me", asyncHandler(controller.getMine));
router.patch("/me", validate({ body: businessSchema }), asyncHandler(controller.patchMine));
router.post(
  "/documents",
  uploadSingleFile,
  validateDocumentBody,
  asyncHandler(controller.uploadDocument)
);
router.post("/cross-check", asyncHandler(controller.crossCheck));
router.post("/verify", asyncHandler(controller.verify));

export default router;
