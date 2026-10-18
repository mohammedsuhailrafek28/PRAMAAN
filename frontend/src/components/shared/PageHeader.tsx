import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Small label above the title, e.g. the workspace or object type. */
  eyebrow?: string;
  actions?: ReactNode;
}

/** The single h1 of every authenticated page. */
export function PageHeader({ title, description, eyebrow, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary-700">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
