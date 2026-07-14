import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./readiness.controller.js";

const router = Router();

router.get("/", controller.listProfiles);
router.get("/evaluations", requireAuth, asyncHandler(controller.history));
router.get("/:profileId", controller.getProfile);
router.post("/:profileId/evaluate", requireAuth, asyncHandler(controller.evaluate));
router.get("/:profileId/latest", requireAuth, asyncHandler(controller.latest));

export default router;
