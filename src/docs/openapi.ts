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
