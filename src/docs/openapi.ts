export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Pramaan Backend API",
    version: "1.0.0",
    description:
      "Rule-based Trust OS API for Pramaan, India's reusable KYB trust infrastructure for MSMEs. The MVP performs internal cross-checks only and does not perform live GST, Udyam, bank, Account Aggregator, DigiLocker, or government-registry verification."
  },
  servers: [{ url: "http://localhost:4000", description: "Local development" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    },
    schemas: {
      ReadinessPurpose: {
        type: "string",
        enum: ["VENDOR_ONBOARDING", "LOAN_APPLICATION_PREPARATION", "GOVERNMENT_PROCUREMENT", "GOVERNMENT_SCHEME_APPLICATION"]
      },
      RequirementStatus: {
        type: "string",
        enum: ["SATISFIED", "PARTIALLY_SATISFIED", "MISSING", "BLOCKED", "MANUAL_REVIEW", "NOT_APPLICABLE"]
      },
      ReadinessLevel: {
        type: "string",
        enum: ["NOT_READY", "EARLY_STAGE", "PARTIALLY_READY", "MOSTLY_READY", "READY_FOR_REVIEW", "BLOCKED"]
      },
      ReportType: {
        type: "string",
        enum: [
          "BUSINESS_TRUST_PROFILE",
          "VENDOR_ONBOARDING_READINESS",
          "LOAN_APPLICATION_PREPARATION",
          "GOVERNMENT_PROCUREMENT_READINESS",
          "GOVERNMENT_SCHEME_APPLICATION_READINESS"
        ]
      },
      ErrorResponse: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string", example: "UNAUTHORIZED" },
              message: { type: "string", example: "Missing bearer token." }
            }
          }
        }
      },
      RegisterRequest: {
        type: "object",
        required: ["role", "name", "organizationName", "email", "password"],
        properties: {
          role: { type: "string", enum: ["MSME", "BUYER", "BANK"], example: "MSME" },
          name: { type: "string", example: "Ravi Sharma" },
          organizationName: { type: "string", example: "Sharma Textiles" },
          email: { type: "string", example: "msme@pramaan.demo" },
          password: { type: "string", example: "password123" }
        }
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", example: "buyer@pramaan.demo" },
          password: { type: "string", example: "password123" }
        }
      },
      AuthResponse: {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              id: { type: "string" },
              role: { type: "string", example: "MSME" },
              email: { type: "string" },
              name: { type: "string" },
              organizationName: { type: "string" }
            }
          },
          token: { type: "string", example: "eyJhbGciOi..." }
        }
      },
      BusinessRequest: {
        type: "object",
        required: ["legalName", "gstin", "udyamNumber", "pan", "address", "turnoverBand"],
        properties: {
          legalName: { type: "string", example: "Sharma Textiles" },
          gstin: { type: "string", example: "33ABCDE1234F1Z5" },
          udyamNumber: { type: "string", example: "UDYAM-TN-01-0001234" },
          pan: { type: "string", example: "ABCDE1234F" },
          address: { type: "string", example: "Chennai, Tamil Nadu" },
          turnoverBand: { type: "string", example: "INR 1Cr-INR 5Cr" }
        }
      },
      ConsentRequest: {
        type: "object",
        required: ["businessGstin", "requestedFields"],
        properties: {
          businessGstin: { type: "string", example: "33ABCDE1234F1Z5" },
          requestedFields: {
            type: "array",
            items: { type: "string" },
            example: ["legalBusinessName", "gstin", "udyamNumber", "summary", "limitations"]
          }
        }
      },
      ApproveConsentRequest: {
        type: "object",
        required: ["approvedFields", "durationDays"],
        properties: {
          approvedFields: {
            type: "array",
            items: { type: "string" },
            example: ["legalBusinessName", "gstin", "udyamNumber", "summary"]
          },
          durationDays: { type: "integer", example: 7 }
        }
      }
    },
    responses: {
      Unauthorized: {
        description: "Unauthorized",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
      },
      Forbidden: {
        description: "Forbidden",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
      },
      ValidationError: {
        description: "Validation error",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
      }
    }
  },
  paths: {
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Health check with database connectivity",
        responses: {
          "200": {
            description: "Service health",
            content: {
              "application/json": {
                example: {
                  status: "healthy",
                  service: "Pramaan Backend",
                  version: "1.0.0",
                  environment: "development",
                  uptimeSeconds: 123,
                  database: { connected: true, provider: "sqlite" },
                  timestamp: "2026-07-09T08:00:00.000Z"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register an MSME, buyer, or bank user",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterRequest" } } }
        },
        responses: {
          "201": { description: "Registered", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
          "400": { $ref: "#/components/responses/ValidationError" }
        }
      }
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login and receive a JWT",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } }
        },
        responses: {
          "200": { description: "Authenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" }
        }
      }
    },
    "/api/business/me": {
      get: {
        tags: ["Business"],
        summary: "Fetch the authenticated MSME's business profile with concise Trust OS summary",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Business profile" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" }
        }
      }
    },
    "/api/business": {
      post: {
        tags: ["Business"],
        summary: "Create or update the authenticated MSME's business profile",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/BusinessRequest" } } }
        },
        responses: {
          "201": { description: "Business saved" },
          "400": { $ref: "#/components/responses/ValidationError" }
        }
      }
    },
    "/api/business/documents": {
      post: {
        tags: ["Business"],
        summary: "Upload submitted evidence for internal assessment",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["docType", "file"],
                properties: {
                  docType: { type: "string", enum: ["GST_CERTIFICATE", "UDYAM_CERTIFICATE", "BANK_STATEMENT"] },
                  file: { type: "string", format: "binary" }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Document uploaded" } }
      }
    },
    "/api/business/verify": {
      post: {
        tags: ["Business"],
        summary: "Deprecated alias for internal business cross-checking",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Internal cross-check result",
            content: {
              "application/json": {
                example: {
                  trustStatus: "CROSS_CHECKED",
                  profile: {
                    summary: {
                      trustReadiness: 74,
                      profileCompleteness: 90,
                      evidenceStrength: 52,
                      consistency: 100,
                      freshness: 100
                    },
                    sourceVerificationPerformed: false,
                    limitations: [
                      "No authoritative GST, Udyam, bank, Account Aggregator, DigiLocker, or government registry source was queried."
                    ]
                  },
                  metadata: { mode: "INTERNAL_CROSS_CHECK", sourceVerificationPerformed: false }
                }
              }
            }
          }
        }
      }
    },
    "/api/business/cross-check": {
      post: {
        tags: ["Business"],
        summary: "Run deterministic internal cross-checks and calculate Trust OS metrics",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Trust OS cross-check result with field confidence, document confidence, gaps, contradictions, and metrics"
          }
        }
      }
    },
    "/api/passport/generate": {
      post: {
        tags: ["Passport"],
        summary: "Generate a versioned Business Trust Profile",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Business Trust Profile generated" } }
      }
    },
    "/api/passport/me": {
      get: {
        tags: ["Passport"],
        summary: "Fetch the MSME owner's latest Business Trust Profile",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Latest Business Trust Profile" } }
      }
    },
    "/api/consent-requests": {
      post: {
        tags: ["Consent"],
        summary: "Buyer or bank requests access by GSTIN",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ConsentRequest" } } }
        },
        responses: { "201": { description: "Consent request created" } }
      },
      get: {
        tags: ["Consent"],
        summary: "List incoming or outgoing consent requests",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "scope", in: "query", required: true, schema: { type: "string", enum: ["incoming", "outgoing"] } }
        ],
        responses: { "200": { description: "Consent requests" } }
      }
    },
    "/api/consent-requests/{id}/approve": {
      patch: {
        tags: ["Consent"],
        summary: "MSME approves selected fields for a duration",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ApproveConsentRequest" } } }
        },
        responses: { "200": { description: "Consent approved" } }
      }
    },
    "/api/consent-requests/{id}/reject": {
      patch: {
        tags: ["Consent"],
        summary: "MSME rejects a pending request",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Consent rejected" } }
      }
    },
    "/api/consent-requests/{id}/revoke": {
      patch: {
        tags: ["Consent"],
        summary: "MSME revokes active consent",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Consent revoked" } }
      }
    },
    "/api/trust-view/{consentRequestId}": {
      get: {
        tags: ["Trust View"],
        summary: "Requester fetches approved Business Trust Profile fields",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "consentRequestId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Filtered Trust View",
            content: {
              "application/json": {
                example: {
                  businessId: "business-id",
                  consentId: "consent-id",
                  sharedFields: {
                    legalBusinessName: {
                      value: "Sharma Textiles",
                      evidenceStatus: "SELF_DECLARED",
                      confidence: 25,
                      confidenceReason: "This claim is self-declared with confidence 25."
                    },
                    gstin: {
                      value: "33ABCDE1234F1Z5",
                      evidenceStatus: "CROSS_CHECKED",
                      confidence: 60,
                      confidenceReason: "Internal deterministic checks support this claim. No source verification was performed."
                    }
                  },
                  metadata: { accessGrantedAt: "2026-07-09T08:00:00.000Z", expiresAt: "2026-07-16T08:00:00.000Z" }
                }
              }
            }
          },
          "410": { description: "Consent expired or revoked", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/readiness-profiles": {
      get: {
        tags: ["Readiness"],
        summary: "List available purpose-specific readiness preparation profiles",
        description:
          "Returns version-controlled policy profiles. Readiness is based on submitted evidence and internal checks; it is not approval, eligibility, creditworthiness, or external verification.",
        responses: {
          "200": {
            description: "Available readiness profiles",
            content: {
              "application/json": {
                example: {
                  profiles: [
                    {
                      id: "vendor-onboarding",
                      version: "1.0",
                      name: "Vendor Onboarding Readiness",
                      purpose: "VENDOR_ONBOARDING",
                      description: "Evaluates preparation for B2B vendor onboarding.",
                      disclaimer: "Final buyer requirements vary."
                    }
                  ]
                }
              }
            }
          }
        }
      }
    },
    "/api/readiness-profiles/{profileId}": {
      get: {
        tags: ["Readiness"],
        summary: "Fetch a full readiness profile definition",
        parameters: [{ name: "profileId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Readiness profile definition including requirements, blockers, thresholds, and disclaimer" },
          "404": { description: "Unknown profile", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/readiness-profiles/{profileId}/evaluate": {
      post: {
        tags: ["Readiness"],
        summary: "Evaluate an MSME against a selected readiness preparation profile",
        description:
          "MSME-only private evaluation. Reuses the Business Trust Profile, recalculates Trust OS data safely, persists an explainable summary, and writes audit events. It does not claim approval, eligibility, creditworthiness, vendor acceptance, tender qualification, or source verification.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "profileId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "201": {
            description: "Readiness evaluation",
            content: {
              "application/json": {
                example: {
                  profile: {
                    id: "vendor-onboarding",
                    version: "1.0",
                    name: "Vendor Onboarding Readiness",
                    purpose: "VENDOR_ONBOARDING",
                    disclaimer: "Final buyer requirements vary."
                  },
                  result: {
                    score: 78,
                    level: "MOSTLY_READY",
                    blocked: false,
                    satisfiedRequirements: 7,
                    partialRequirements: 1,
                    missingRequirements: 1,
                    totalApplicableRequirements: 9
                  },
                  requirements: [
                    {
                      requirementId: "vendor_gstin",
                      status: "SATISFIED",
                      score: 100,
                      reason: "GSTIN satisfies the configured confidence and evidence-status requirement."
                    }
                  ],
                  blockingIssues: [],
                  nextActions: [],
                  limitations: [
                    "This readiness profile is a preparation guide, not an approval, eligibility, creditworthiness, or acceptance decision."
                  ]
                }
              }
            }
          },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Business or profile not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/readiness-profiles/{profileId}/latest": {
      get: {
        tags: ["Readiness"],
        summary: "Fetch the authenticated MSME's latest persisted readiness evaluation for a profile",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "profileId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Latest persisted readiness evaluation" },
          "404": { description: "No evaluation found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/readiness-profiles/evaluations": {
      get: {
        tags: ["Readiness"],
        summary: "Fetch the authenticated MSME's readiness evaluation history",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Evaluation history" } }
      }
    },
    "/api/report-types": {
      get: {
        tags: ["Reports"],
        summary: "List structured JSON report types",
        description: "Reports are private, JSON-first snapshots. This phase does not provide HTML or PDF rendering and does not claim approval, eligibility, creditworthiness, or external verification.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Available report types",
            content: {
              "application/json": {
                example: {
                  reportTypes: [
                    {
                      reportType: "BUSINESS_TRUST_PROFILE",
                      displayName: "Business Trust Profile Report",
                      reportVersion: "1.0",
                      readinessProfileId: null
                    },
                    {
                      reportType: "VENDOR_ONBOARDING_READINESS",
                      displayName: "Vendor Onboarding Readiness Report",
                      reportVersion: "1.0",
                      readinessProfileId: "vendor-onboarding"
                    }
                  ]
                }
              }
            }
          }
        }
      }
    },
    "/api/reports/generate": {
      post: {
        tags: ["Reports"],
        summary: "Generate an immutable structured report snapshot",
        description: "MSME-only. Generates JSON snapshots only. Business Trust Profile reports do not require readiness evaluation; readiness reports use canonical readiness evaluations.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["reportType"],
                properties: { reportType: { $ref: "#/components/schemas/ReportType" } }
              },
              examples: {
                trustProfile: { value: { reportType: "BUSINESS_TRUST_PROFILE" } },
                vendorReadiness: { value: { reportType: "VENDOR_ONBOARDING_READINESS" } },
                blockedLoan: { value: { reportType: "LOAN_APPLICATION_PREPARATION" } }
              }
            }
          }
        },
        responses: {
          "201": { description: "Report metadata and structured ReportDocument snapshot" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "400": { $ref: "#/components/responses/ValidationError" }
        }
      }
    },
    "/api/reports": {
      get: {
        tags: ["Reports"],
        summary: "List the authenticated MSME's report metadata",
        description: "Returns metadata only, not full report snapshots. Buyers and banks cannot access this endpoint.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "reportType", in: "query", required: false, schema: { $ref: "#/components/schemas/ReportType" } },
          { name: "revoked", in: "query", required: false, schema: { type: "string", enum: ["true", "false"] } }
        ],
        responses: { "200": { description: "Report metadata list" } }
      }
    },
    "/api/reports/{reportId}": {
      get: {
        tags: ["Reports"],
        summary: "Retrieve a stored immutable report snapshot",
        description: "GET returns stored snapshotJson; it never regenerates the report. Revoked reports remain visible to the owner with revoked status.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "reportId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Report metadata and stored ReportDocument" },
          "404": { description: "Report not found or not owned by the caller", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/reports/{reportId}/revoke": {
      post: {
        tags: ["Reports"],
        summary: "Non-destructively revoke a report",
        description: "Sets revokedAt, retains the immutable snapshot for owner audit history, and writes REPORT_REVOKED.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "reportId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Revoked report metadata and snapshot" } }
      }
    },
    "/api/audit-logs": {
      get: {
        tags: ["Audit"],
        summary: "MSME owner fetches consent and passport audit timeline",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Audit logs" } }
      }
    },
    "/api/notifications": {
      get: {
        tags: ["Notifications"],
        summary: "Fetch authenticated user's notifications",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Notifications" } }
      }
    }
  }
};
