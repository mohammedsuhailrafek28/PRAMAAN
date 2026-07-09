import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./trustView.controller.js";

const router = Router();
const params = z.object({ consentRequestId: z.string().min(1) });

router.get("/:consentRequestId", requireAuth, validate({ params }), asyncHandler(controller.get));

export default router;
