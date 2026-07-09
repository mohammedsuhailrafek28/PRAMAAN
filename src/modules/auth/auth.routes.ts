import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as controller from "./auth.controller.js";

const router = Router();

const registerSchema = z.object({
  role: z.nativeEnum(UserRole),
  name: z.string().min(2),
  organizationName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

router.post("/register", validate({ body: registerSchema }), asyncHandler(controller.register));
router.post("/login", validate({ body: loginSchema }), asyncHandler(controller.login));
router.post("/logout", requireAuth, asyncHandler(controller.logout));

export default router;
