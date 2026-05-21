import { type LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Building2,
  BrainCircuit,
  Settings,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const mainNavItems: NavItem[] = [
  {
    title: "Pipeline SellUp",
    href: "/pipeline",
    icon: LayoutDashboard,
  },
  {
    title: "Cuentas",
    href: "/accounts",
    icon: Building2,
  },
  {
    title: "Uso de IA y costos",
    href: "/ai-usage",
    icon: BrainCircuit,
  },
  {
    title: "Configuración",
    href: "/settings",
    icon: Settings,
  },
];
