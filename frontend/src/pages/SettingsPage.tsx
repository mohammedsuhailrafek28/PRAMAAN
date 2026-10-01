import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/shared/SectionCard";
import { useAuthStore } from "@/store/authStore";

export function SettingsPage() {
  const { currentUser, logout } = useAuthStore();
  const navigate = useNavigate();

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your signed-in Pramaan account details.</p>
      </div>
      <SectionCard title="Profile">
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" value={currentUser?.name || ""} readOnly /></div>
          <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" value={currentUser?.email || ""} readOnly /></div>
          <p className="text-xs text-muted-foreground">Profile editing is not part of this MVP.</p>
        </div>
      </SectionCard>
      <SectionCard title="Security"><p className="text-sm text-muted-foreground">Passwords are managed through the Pramaan sign-in flow.</p></SectionCard>
      <SectionCard title="Notifications"><p className="text-sm text-muted-foreground">Consent requests and access changes appear in the notification center.</p></SectionCard>
      <Button variant="destructive" onClick={() => { logout(); navigate("/login"); }}>Log Out</Button>
    </div>
  );
}
