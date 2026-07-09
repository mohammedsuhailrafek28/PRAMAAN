import { DocumentType, VerificationStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const udyamRegex = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;

type FieldResult = {
  field: string;
  status: "VERIFIED" | "FLAGGED";
  message: string;
};

function result(field: string, pass: boolean, good: string, bad: string): FieldResult {
  return { field, status: pass ? "VERIFIED" : "FLAGGED", message: pass ? good : bad };
}

export async function runMockVerification(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { documents: true }
  });
  if (!business) throw new Error("Business not found");

  const docTypes = new Set(business.documents.map((doc) => doc.docType));
  const hasGstDoc = docTypes.has(DocumentType.GST_CERTIFICATE);
  const hasUdyamDoc = docTypes.has(DocumentType.UDYAM_CERTIFICATE);
  const hasBankDoc = docTypes.has(DocumentType.BANK_STATEMENT);

  const fieldResults: FieldResult[] = [
    result(
      "gstin",
      Boolean(business.gstin && gstinRegex.test(business.gstin) && hasGstDoc),
      "GSTIN format is valid and sample GST certificate is present.",
      "GSTIN must match the mock format and include a GST certificate."
    ),
    result(
      "udyamNumber",
      Boolean(business.udyamNumber && udyamRegex.test(business.udyamNumber) && hasUdyamDoc),
      "Udyam number format is valid and sample Udyam certificate is present.",
      "Udyam number must match UDYAM-XX-00-0000000 and include a Udyam certificate."
    ),
    result(
      "pan",
      Boolean(business.pan && panRegex.test(business.pan)),
      "PAN format is valid.",
      "PAN must match the mock format ABCDE1234F."
    ),
    result(
      "bankStatement",
      hasBankDoc,
      "Sample bank statement is present.",
      "A sample bank statement is required."
    ),
    result(
      "profile",
      Boolean(business.legalName && business.address && business.turnoverBand),
      "Required business profile fields are present.",
      "Legal name, address, and turnover band are required."
    )
  ];

  const verificationStatus = fieldResults.every((item) => item.status === "VERIFIED")
    ? VerificationStatus.VERIFIED
    : VerificationStatus.FLAGGED;

  await prisma.document.updateMany({
    where: { businessId },
    data: { verifiedFlag: verificationStatus === VerificationStatus.VERIFIED }
  });

  const updatedBusiness = await prisma.business.update({
    where: { id: businessId },
    data: { verificationStatus },
    include: { documents: true }
  });

  return {
    business: updatedBusiness,
    verificationStatus,
    fieldResults,
    metadata: {
      verificationMode: "MOCK_RULE_BASED",
      liveGovernmentVerification: false
    }
  };
}
