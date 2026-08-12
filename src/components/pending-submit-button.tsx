"use client";

import { useFormStatus } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { UiIcon } from "@/components/icons";

export function PendingSubmitButton({
  label,
  pendingLabel,
  icon,
  className = "btn",
}: {
  label: string;
  pendingLabel: string;
  icon?: LucideIcon;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {icon ? <UiIcon icon={icon} size={15} /> : null}
      {pending ? pendingLabel : label}
    </button>
  );
}
