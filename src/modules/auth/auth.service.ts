import bcrypt from "bcrypt";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/apiError.js";

type RegisterInput = {
  role: UserRole;
  name: string;
  organizationName: string;
  email: string;
  password: string;
};

function signToken(user: { id: string; role: UserRole; email: string }) {
  return jwt.sign(
    { role: user.role, email: user.email },
    env.JWT_SECRET as Secret,
    { subject: user.id, expiresIn: env.JWT_EXPIRES_IN } as SignOptions
  );
}

export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ApiError(409, "CONFLICT", "Account already exists, log in instead.");

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      role: input.role,
      name: input.name,
      organizationName: input.organizationName,
      email: input.email.toLowerCase(),
      passwordHash,
      business:
        input.role === UserRole.MSME
          ? { create: { legalName: input.organizationName } }
          : undefined
    },
    select: { id: true, role: true, email: true, name: true, organizationName: true }
  });

  return { user, token: signToken(user) };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new ApiError(401, "UNAUTHORIZED", "Invalid email or password.");

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) throw new ApiError(401, "UNAUTHORIZED", "Invalid email or password.");

  return {
    user: {
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      organizationName: user.organizationName
    },
    token: signToken(user)
  };
}
