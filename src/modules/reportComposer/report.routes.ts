import { Router } from "express";
import { z } from "zod";
import { ReportType, UserRole } from "@prisma/client";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/roles.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./report.controller.js";

const router = Router();

const generateSchema = z.object({
  reportType: z.nativeEnum(ReportType)
});

router.get("/report-types", requireAuth, controller.listTypes);
router.post("/reports/generate", requireAuth, requireRole([UserRole.MSME]), validate({ body: generateSchema }), asyncHandler(controller.generate));
router.get("/reports", requireAuth, requireRole([UserRole.MSME]), asyncHandler(controller.list));
router.get("/reports/:reportId/preview", requireAuth, requireRole([UserRole.MSME]), asyncHandler(controller.previewHtml));
router.get("/reports/:reportId/html", requireAuth, requireRole([UserRole.MSME]), asyncHandler(controller.downloadHtml));
router.get("/reports/:reportId/pdf", requireAuth, requireRole([UserRole.MSME]), asyncHandler(controller.downloadPdf));
router.get("/reports/:reportId", requireAuth, requireRole([UserRole.MSME]), asyncHandler(controller.get));
router.post("/reports/:reportId/revoke", requireAuth, requireRole([UserRole.MSME]), asyncHandler(controller.revoke));

export default router;
