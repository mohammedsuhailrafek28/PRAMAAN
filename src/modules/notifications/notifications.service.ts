import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";

export async function createNotification(input: {
  userId: string;
  message: string;
  relatedConsentId?: string | null;
}) {
  return prisma.notification.create({ data: input });
}

export async function list(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });
}

export async function markRead(userId: string, id: string) {
  const notification = await prisma.notification.findFirst({ where: { id, userId } });
  if (!notification) throw new ApiError(404, "NOT_FOUND", "Notification not found.");
  return prisma.notification.update({ where: { id }, data: { readFlag: true } });
}
