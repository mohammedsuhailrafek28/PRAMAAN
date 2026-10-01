import bcrypt from "bcrypt";
import "dotenv/config";
import { AuditAction, DocumentType, EvidenceStatus, UserRole, VerificationStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { PrismaClient as Client } from "@prisma/client";
import { generate } from "../src/modules/passport/passport.service.js";

const prisma: PrismaClient = new Client();
const password = "password123";

async function upsertUser(input: { role: UserRole; name: string; organizationName: string; email: string }) {
  return prisma.user.upsert({ where: { email: input.email }, update: { ...input, passwordHash: await bcrypt.hash(password, 12) }, create: { ...input, passwordHash: await bcrypt.hash(password, 12) } });
}

async function clearBusiness(businessId: string) {
  const consents = await prisma.consentRequest.findMany({ where: { businessId }, select: { id: true } });
  const grants = await prisma.accessGrant.findMany({ where: { businessId }, select: { id: true } });
  await prisma.notification.deleteMany({ where: { OR: [{ relatedConsentId: { in: consents.map((item) => item.id) } }, { userId: { in: [] } }] } });
  await prisma.auditLog.deleteMany({ where: { businessId } });
  await prisma.generatedReport.deleteMany({ where: { businessId } });
  await prisma.readinessEvaluation.deleteMany({ where: { businessId } });
  await prisma.consentRequest.deleteMany({ where: { businessId } });
  await prisma.accessGrant.deleteMany({ where: { id: { in: grants.map((item) => item.id) } } });
  await prisma.passport.deleteMany({ where: { businessId } });
  await prisma.document.deleteMany({ where: { businessId } });
}

async function main() {
  const msme = await upsertUser({ role: UserRole.MSME, name: "Ravi Sharma", organizationName: "Sharma Textiles", email: "msme@pramaan.demo" });
  const buyer = await upsertUser({ role: UserRole.BUYER, name: "Ananya Iyer", organizationName: "Acme Retail Buyers", email: "buyer@pramaan.demo" });
  const bank = await upsertUser({ role: UserRole.BANK, name: "Karan Mehta", organizationName: "Kisan NBFC", email: "bank@pramaan.demo" });
  void bank;
  const business = await prisma.business.upsert({ where: { userId: msme.id }, update: { legalName: "Sharma Textiles", gstin: "33ABCDE1234F1Z5", udyamNumber: "UDYAM-TN-01-0001234", pan: "ABCDE1234F", address: "12 Textile Market Road, Coimbatore, Tamil Nadu", turnoverBand: "INR 1Cr-INR 5Cr", verificationStatus: VerificationStatus.UNVERIFIED, trustStatus: EvidenceStatus.SELF_DECLARED }, create: { userId: msme.id, legalName: "Sharma Textiles", gstin: "33ABCDE1234F1Z5", udyamNumber: "UDYAM-TN-01-0001234", pan: "ABCDE1234F", address: "12 Textile Market Road, Coimbatore, Tamil Nadu", turnoverBand: "INR 1Cr-INR 5Cr" } });
  await clearBusiness(business.id);
  const fixture = (name: string) => `test-fixtures/${name}`;
  await prisma.document.createMany({ data: [
    { businessId: business.id, docType: DocumentType.GST_CERTIFICATE, filePath: fixture("gst-certificate.pdf"), originalName: "gst-certificate.pdf", mimeType: "application/pdf", evidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, confidence: 45, confidenceReason: "Synthetic demo evidence; contents are not externally verified.", source: "MSME_SUBMITTED", issuedAt: new Date("2026-01-01"), expiresAt: new Date("2027-01-01") },
    { businessId: business.id, docType: DocumentType.UDYAM_CERTIFICATE, filePath: fixture("udyam-certificate.pdf"), originalName: "udyam-certificate.pdf", mimeType: "application/pdf", evidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, confidence: 45, confidenceReason: "Synthetic demo evidence; contents are not externally verified.", source: "MSME_SUBMITTED", issuedAt: new Date("2026-01-01") },
    { businessId: business.id, docType: DocumentType.BANK_STATEMENT, filePath: fixture("bank-statement.pdf"), originalName: "bank-statement.pdf", mimeType: "application/pdf", evidenceStatus: EvidenceStatus.EXPIRED, confidence: 45, confidenceReason: "Synthetic stale demo evidence.", source: "MSME_SUBMITTED", issuedAt: new Date("2025-01-01"), expiresAt: new Date("2026-06-30") }
  ] });
  await prisma.business.update({ where: { id: business.id }, data: { verificationStatus: VerificationStatus.VERIFIED, trustStatus: EvidenceStatus.CROSS_CHECKED } });
  await generate(msme.id);
  const pending = await prisma.consentRequest.create({ data: { requesterId: buyer.id, businessId: business.id, requestedFields: ["legalBusinessName", "gstin", "udyamNumber"] as Prisma.InputJsonValue, requestedEvidenceTypes: [] as Prisma.InputJsonValue, purpose: "Vendor onboarding", status: "PENDING" } });
  await prisma.auditLog.create({ data: { businessId: business.id, actorId: buyer.id, consentRequestId: pending.id, action: AuditAction.CONSENT_REQUESTED, metadata: { seeded: true } } });
  await prisma.notification.create({ data: { userId: msme.id, relatedConsentId: pending.id, message: "Acme Retail Buyers wants to view your Business Trust Profile." } });
  console.table([{ role: "MSME", email: msme.email, password }, { role: "BUYER", email: buyer.email, password }, { role: "BANK", email: bank.email, password }]);
  console.log("Seeded verified Sharma Textiles with a pinned passport, stale bank evidence, and pending consent request.");
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(async () => prisma.$disconnect());
