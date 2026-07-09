import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./notifications.controller.js";

const router = Router();
const params = z.object({ id: z.string().min(1) });

router.get("/", requireAuth, asyncHandler(controller.list));
router.patch("/:id/read", requireAuth, validate({ params }), asyncHandler(controller.markRead));

export default router;
