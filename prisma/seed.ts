import bcrypt from "bcrypt";
import "dotenv/config";
import {
  DocumentType,
  UserRole,
  VerificationStatus,
  type PrismaClient
} from "@prisma/client";
import { PrismaClient as Client } from "@prisma/client";

const prisma: PrismaClient = new Client();

async function upsertUser(input: {
  role: UserRole;
  name: string;
  organizationName: string;
  email: string;
}) {
  const passwordHash = await bcrypt.hash("password123", 12);
  return prisma.user.upsert({
    where: { email: input.email },
    update: { ...input, passwordHash },
    create: { ...input, passwordHash }
  });
}

async function main() {
  const msme = await upsertUser({
    role: UserRole.MSME,
    name: "Ravi Sharma",
    organizationName: "Sharma Textiles",
    email: "msme@pramaan.demo"
  });
  const buyer = await upsertUser({
    role: UserRole.BUYER,
    name: "Ananya Iyer",
    organizationName: "Acme Retail Buyers",
    email: "buyer@pramaan.demo"
  });
  const bank = await upsertUser({
    role: UserRole.BANK,
    name: "Karan Mehta",
    organizationName: "Kisan NBFC",
    email: "bank@pramaan.demo"
  });

  const existingGstinOwner = await prisma.business.findUnique({
    where: { gstin: "33ABCDE1234F1Z5" }
  });
  if (existingGstinOwner && existingGstinOwner.userId !== msme.id) {
    const consents = await prisma.consentRequest.findMany({
      where: { businessId: existingGstinOwner.id },
      select: { id: true }
    });
    const consentIds = consents.map((consent) => consent.id);

    await prisma.notification.deleteMany({ where: { relatedConsentId: { in: consentIds } } });
    await prisma.auditLog.deleteMany({ where: { businessId: existingGstinOwner.id } });
    await prisma.consentRequest.deleteMany({ where: { businessId: existingGstinOwner.id } });
    await prisma.passport.deleteMany({ where: { businessId: existingGstinOwner.id } });
    await prisma.document.deleteMany({ where: { businessId: existingGstinOwner.id } });
    await prisma.business.delete({ where: { id: existingGstinOwner.id } });
  }

  const business = await prisma.business.upsert({
    where: { userId: msme.id },
    update: {
      legalName: "Sharma Textiles",
      gstin: "33ABCDE1234F1Z5",
      udyamNumber: "UDYAM-TN-01-0001234",
      pan: "ABCDE1234F",
      address: "12 Textile Market Road, Coimbatore, Tamil Nadu",
      turnoverBand: "INR 1Cr-INR 5Cr",
      verificationStatus: VerificationStatus.UNVERIFIED
    },
    create: {
      userId: msme.id,
      legalName: "Sharma Textiles",
      gstin: "33ABCDE1234F1Z5",
      udyamNumber: "UDYAM-TN-01-0001234",
      pan: "ABCDE1234F",
      address: "12 Textile Market Road, Coimbatore, Tamil Nadu",
      turnoverBand: "INR 1Cr-INR 5Cr",
      verificationStatus: VerificationStatus.UNVERIFIED
    }
  });

  for (const docType of [
    DocumentType.GST_CERTIFICATE,
    DocumentType.UDYAM_CERTIFICATE,
    DocumentType.BANK_STATEMENT
  ]) {
    const existing = await prisma.document.findFirst({ where: { businessId: business.id, docType } });
    if (!existing) {
      await prisma.document.create({
        data: {
          businessId: business.id,
          docType,
          filePath: `uploads/seed-${docType.toLowerCase()}.pdf`,
          originalName: `seed-${docType.toLowerCase()}.pdf`,
          mimeType: "application/pdf"
        }
      });
    }
  }

  console.log("Seeded demo users:");
  console.table([
    { role: "MSME", email: msme.email, password: "password123" },
    { role: "BUYER", email: buyer.email, password: "password123" },
    { role: "BANK", email: bank.email, password: "password123" }
  ]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
