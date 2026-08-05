import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { UiIcon } from "@/components/icons";

export function PageHeading({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1 className="h1 page-title">
          {icon ? (
            <UiIcon icon={icon} className="page-title-icon" size={22} />
          ) : null}
          <span>{title}</span>
        </h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

export function PanelTitle({
  icon,
  children,
  trailing,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="panel-header">
      <h2 className="panel-title">
        {icon ? (
          <UiIcon icon={icon} className="panel-title-icon" size={16} />
        ) : null}
        <span>{children}</span>
      </h2>
      {trailing}
    </div>
  );
}

export function EmptyState({
  icon,
  children,
}: {
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ? (
        <UiIcon icon={icon} className="empty-state-icon" size={28} />
      ) : null}
      {typeof children === "string" ? <p>{children}</p> : children}
    </div>
  );
}
