import { type LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Building2,
  Users,
  BrainCircuit,
  Settings,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Canonical routes for the unified "Empresas" module.
 *
 * Prospectos no longer exists as a standalone module: it lives as an internal
 * pill inside Empresas, reachable via the `tab=prospectos` query param. The
 * legacy `/prospects` route is kept only as a redirect for existing deep links
 * (e.g. the Agente 1 flow passing `?sourceId=`).
 */
export const ACCOUNTS_ROUTE = "/accounts";
export const ACCOUNTS_EMPRESAS_ROUTE = "/accounts?tab=empresas";
export const PROSPECTOS_TAB_ROUTE = "/accounts?tab=prospectos";

/**
 * Canonical routes for the unified "Contactos" module (Hito 17A.4A).
 *
 * Contactos hosts two sibling pills inside a single module: "Contactos
 * aprobados" (the official `contacts` table, default view) and "Candidatos por
 * revisar" (`contact_enrichment_candidates` in `pending_review`). Switching tabs
 * stays within `/contacts` via the `tab` query param — no new sidebar item. The
 * bare `/contacts` route keeps its historical behaviour (approved contacts).
 */
export const CONTACTS_ROUTE = "/contacts";
export const CONTACTS_APPROVED_ROUTE = "/contacts?tab=approved";
export const CONTACTS_CANDIDATES_ROUTE = "/contacts?tab=candidates";

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
