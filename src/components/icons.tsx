import type { LucideIcon, LucideProps } from "lucide-react";
import {
  Archive,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GraduationCap,
  History,
  Home,
  Languages,
  LayoutDashboard,
  LogIn,
  LogOut,
  NotebookPen,
  Plus,
  Search,
  Settings,
  Sparkles,
  Users,
  Video,
  X,
} from "lucide-react";

/** Shared stroke weight for product chrome. */
export const ICON_STROKE = 1.85;

export function UiIcon({
  icon: Icon,
  className,
  size = 16,
  ...props
}: LucideProps & { icon: LucideIcon; size?: number }) {
  return (
    <Icon
      className={className}
      size={size}
      strokeWidth={ICON_STROKE}
      aria-hidden
      {...props}
    />
  );
}

export const navIcons = {
  today: LayoutDashboard,
  calendar: CalendarDays,
  students: Users,
  prep: NotebookPen,
  availability: Clock3,
  settings: Settings,
  home: Home,
  book: CalendarPlus,
  history: History,
} as const;

export {
  Archive,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GraduationCap,
  History,
  Home,
  Languages,
  LayoutDashboard,
  LogIn,
  LogOut,
  NotebookPen,
  Plus,
  Search,
  Settings,
  Sparkles,
  Users,
  Video,
  X,
};
