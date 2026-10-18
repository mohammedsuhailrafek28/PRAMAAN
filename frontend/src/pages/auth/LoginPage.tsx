import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, Landmark, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuthStore } from "@/store/authStore";
import type { Role } from "@/types";
import { cn } from "@/lib/utils";
import { getApiError } from "@/services/api";
import { DEMO_MODE } from "@/lib/demoMode";
import { homeForRole, parseRoleParam } from "@/lib/roles";
import { useToast } from "@/components/ui/use-toast";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(4, "Password must be at least 4 characters"),
});
type FormValues = z.infer<typeof schema>;

const ROLE_TABS: { role: Role; label: string; icon: typeof Building2 }[] = [
  { role: "msme", label: "MSME", icon: Building2 },
  { role: "buyer", label: "Buyer", icon: Search },
  { role: "bank", label: "Bank / NBFC", icon: Landmark },
];

export function LoginPage() {
  const [params] = useSearchParams();
  const initialRole = parseRoleParam(params.get("role"));
  const [role, setRole] = useState<Role>(initialRole);
  const { loginAs, loading, sessionExpired } = useAuthStore();
  const { toast } = useToast();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    try {
      // The account decides the destination; the tab above is only a label.
      const user = await loginAs(values.email, values.password);
      navigate(homeForRole(user.role));
    } catch (error) {
      toast({ title: "Login failed", description: getApiError(error), variant: "destructive" });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-primary-700 text-sm font-bold text-white">
            P
          </div>
          <CardTitle>Log in to Pramaan</CardTitle>
          <CardDescription>Consent-based business trust for MSMEs, buyers, and lenders.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-5 grid grid-cols-3 gap-1.5 rounded-md bg-secondary p-1">
            {ROLE_TABS.map((tab) => (
              <button
                key={tab.role}
                type="button"
                onClick={() => setRole(tab.role)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-sm px-2 py-2 text-xs font-medium text-slate-600 transition-colors",
                  role === tab.role && "bg-white text-slate-900 shadow-subtle"
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {sessionExpired && <p role="alert" className="mb-4 rounded-md bg-warning-bg px-3 py-2 text-sm text-warning-foreground">Your session ended. Please log in again.</p>}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" placeholder="you@company.com" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="••••••••" {...register("password")} />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Logging in…" : "Log in"}
            </Button>
          </form>

          {DEMO_MODE && (
            <p className="mt-5 text-center text-xs text-muted-foreground">
              Demo access: {role === "msme" ? "msme" : role === "buyer" ? "buyer" : "bank"}@pramaan.demo / password123
            </p>
          )}
          <p className="mt-3 text-center text-sm text-muted-foreground">
            No account?{" "}
            <Link to={`/register?role=${role}`} className="font-medium text-primary-700 hover:underline">
              Register
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
