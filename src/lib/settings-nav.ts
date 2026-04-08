import {
  Building2,
  Palette,
  ListChecks,
  Flame,
  Users,
  Mail,
  FileSignature,
  ClipboardList,
  Bell,
  FileText,
  Download,
} from "lucide-react";
import type { ComponentType } from "react";

export interface SettingsNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  disabled?: boolean;
}

export const settingsNavItems: SettingsNavItem[] = [
  { href: "/settings/company", label: "Company Profile", icon: Building2 },
  { href: "/settings/appearance", label: "Appearance", icon: Palette, disabled: true },
  { href: "/settings/statuses", label: "Job Statuses", icon: ListChecks, disabled: true },
  { href: "/settings/damage-types", label: "Damage Types", icon: Flame, disabled: true },
  { href: "/settings/users", label: "Users & Crew", icon: Users, disabled: true },
  { href: "/settings/email", label: "Email Accounts", icon: Mail },
  { href: "/settings/signatures", label: "Email Signatures", icon: FileSignature, disabled: true },
  { href: "/settings/intake-form", label: "Intake Form", icon: ClipboardList, disabled: true },
  { href: "/settings/notifications", label: "Notifications", icon: Bell, disabled: true },
  { href: "/settings/reports", label: "Reports", icon: FileText, disabled: true },
  { href: "/settings/export", label: "Data Export", icon: Download, disabled: true },
];
