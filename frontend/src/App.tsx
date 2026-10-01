import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { LandingPage } from "@/pages/LandingPage";
import { LoginPage } from "@/pages/auth/LoginPage";
import { RegisterPage } from "@/pages/auth/RegisterPage";
import { SettingsPage } from "@/pages/SettingsPage";

import { MsmeDashboard } from "@/pages/msme/MsmeDashboard";
import { BusinessVerificationPage } from "@/pages/msme/BusinessVerificationPage";
import { TrustProfilePage } from "@/pages/msme/TrustProfilePage";
import { ConsentRequestsPage } from "@/pages/msme/ConsentRequestsPage";
import { AuditLogPage } from "@/pages/msme/AuditLogPage";
import { EvidenceVaultPage } from "@/pages/msme/EvidenceVaultPage";

import { BuyerDashboard } from "@/pages/buyer/BuyerDashboard";
import { BankDashboard } from "@/pages/bank/BankDashboard";
import { DynamicTrustViewPage } from "@/pages/shared/DynamicTrustViewPage";
import { ExternalVerificationPage } from "@/pages/shared/ExternalVerificationPage";
import { AccessControlPage } from "@/pages/msme/AccessControlPage";
import { useEffect } from "react";
import { useAuthStore } from "@/store/authStore";

export default function App() {
  const restoreSession = useAuthStore((state) => state.restoreSession);
  useEffect(() => { void restoreSession(); }, [restoreSession]);

  return (
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route element={<ProtectedRoute allow={["msme"]} />}>
            <Route element={<AppLayout />}>
              <Route path="/msme/dashboard" element={<MsmeDashboard />} />
              <Route path="/msme/verification" element={<BusinessVerificationPage />} />
              <Route path="/msme/trust-profile" element={<TrustProfilePage />} />
              <Route path="/msme/consent-requests" element={<ConsentRequestsPage />} />
              <Route path="/msme/audit-log" element={<AuditLogPage />} />
              <Route path="/msme/evidence-vault" element={<EvidenceVaultPage />} />
              <Route path="/msme/access" element={<AccessControlPage />} />
              <Route path="/msme/settings" element={<SettingsPage />} />
            </Route>
          </Route>

          <Route path="/verify/:token" element={<ExternalVerificationPage />} />

          <Route element={<ProtectedRoute allow={["buyer"]} />}>
            <Route element={<AppLayout />}>
              <Route path="/buyer/dashboard" element={<BuyerDashboard />} />
              <Route path="/buyer/settings" element={<SettingsPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allow={["bank"]} />}>
            <Route element={<AppLayout />}>
              <Route path="/bank/dashboard" element={<BankDashboard />} />
              <Route path="/bank/settings" element={<SettingsPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allow={["buyer", "bank"]} />}>
            <Route element={<AppLayout />}>
              <Route path="/trust-view/:consentId" element={<DynamicTrustViewPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </TooltipProvider>
  );
}
