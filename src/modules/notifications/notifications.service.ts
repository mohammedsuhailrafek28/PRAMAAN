import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";

type NotificationClient = Pick<typeof prisma, "notification">;

export async function createNotification(input: {
  userId: string;
  message: string;
  relatedConsentId?: string | null;
  relatedOnboardingAssignmentId?: string | null;
  client?: NotificationClient;
}) {
  const { client, ...data } = input;
  return (client ?? prisma).notification.create({ data });
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
