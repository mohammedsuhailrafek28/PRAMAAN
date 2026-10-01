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
import * as api from "@/services/api";
import type { Role } from "@/types";
import { cn } from "@/lib/utils";

const schema = z
  .object({
    name: z.string().min(2, "Enter your full name"),
    orgName: z.string().min(2, "Enter your business/organization name"),
    email: z.string().email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
type FormValues = z.infer<typeof schema>;

const ROLE_TABS: { role: Role; label: string; icon: typeof Building2 }[] = [
  { role: "msme", label: "MSME", icon: Building2 },
  { role: "buyer", label: "Buyer", icon: Search },
  { role: "bank", label: "Bank / NBFC", icon: Landmark },
];

const ROLE_HOME: Record<Role, string> = {
  msme: "/msme/dashboard",
  buyer: "/buyer/dashboard",
  bank: "/bank/dashboard",
};

export function RegisterPage() {
  const [params] = useSearchParams();
  const initialRole = (params.get("role") as Role) || "msme";
  const [role, setRole] = useState<Role>(initialRole);
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    const user = await api.register({ name: values.name, orgName: values.orgName, email: values.email, password: values.password, role });
    useAuthStore.setState({ currentUser: user });
    setSubmitting(false);
    navigate(ROLE_HOME[role]);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-primary-700 text-sm font-bold text-white">
            P
          </div>
          <CardTitle>Create your Pramaan account</CardTitle>
          <CardDescription>Choose how you'll use Pramaan.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-5 grid grid-cols-3 gap-1.5 rounded-md bg-secondary p-1">
            {ROLE_TABS.map((tab) => (
              <button
                key={tab.role}
                type="button"
                onClick={() => setRole(tab.role)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-sm px-2 py-2 text-xs font-medium text-muted-foreground transition-colors",
                  role === tab.role && "bg-white text-slate-900 shadow-subtle"
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" placeholder="Rajeev Sharma" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orgName">
                {role === "msme" ? "Business name" : "Organization name"}
              </Label>
              <Input id="orgName" placeholder="Sharma Textiles Pvt. Ltd." {...register("orgName")} />
              {errors.orgName && <p className="text-xs text-destructive">{errors.orgName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" placeholder="you@company.com" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" {...register("password")} />
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm</Label>
                <Input id="confirmPassword" type="password" {...register("confirmPassword")} />
                {errors.confirmPassword && (
                  <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
                )}
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating account…" : "Create Account"}
            </Button>
          </form>

          <p className="mt-3 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to={`/login?role=${role}`} className="font-medium text-primary-700 hover:underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
