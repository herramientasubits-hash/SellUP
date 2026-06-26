import { type LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Building2,
  Users,
  BrainCircuit,
  Settings,
  Search,
  UserSearch,
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
    title: "Empresas",
    href: "/accounts",
    icon: Building2,
  },
  {
    title: "Contactos",
    href: "/contacts",
    icon: Users,
  },
  {
    title: "Prospectos",
    href: "/prospects",
    icon: Search,
  },
  {
    title: "Enriquecer contactos",
    href: "/contact-enrichment",
    icon: UserSearch,
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
