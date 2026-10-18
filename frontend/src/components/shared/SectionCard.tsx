import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

/** Standard titled section. Its title is an h2 under the page's h1. */
export function SectionCard({ title, description, action, children, className, contentClassName }: SectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 p-5 pb-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h2>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardHeader>
      <CardContent className={cn("p-5 pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
