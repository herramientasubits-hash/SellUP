import { type LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Building2,
  Users,
  ClipboardList,
  BrainCircuit,
  Settings,
} from "lucide-react";

/**
 * Visibility requirement for a sidebar module.
 *
 * - `public`    → every active user can see and use the module (operativa).
 * - `adminOnly` → only administrators. Used for modules whose pages already
 *   gate their data/route to admins (Uso de IA, Configuración), so the sidebar
 *   must mirror that gate instead of advertising a dead-end "sin permisos" view.
 *
 * Role-aware extension point: when the commercial-scope rollout
 * (ENABLE_COMMERCIAL_SCOPE) is enabled, `NavAccessContext` already carries
 * `roleKey`, so additional access levels (e.g. team-scoped Uso de IA for
 * líder/manager) can be added to `canAccessNavItem` without touching callers.
 */
export type NavAccess = "public" | "adminOnly";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Who may see this item in the sidebar. Defaults to `public` when omitted. */
  access?: NavAccess;
}

/**
 * Serializable context describing the current user's navigation permissions.
 *
 * Only primitives cross the Server → Client boundary (icons stay client-side),
 * so this is computed in the (sellup) layout via committed access primitives
 * (`isCurrentUserAdmin`, `getCurrentUser`) and passed down to the nav renderers.
 */
export interface NavAccessContext {
  isAdmin: boolean;
  roleKey: string | null;
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
    title: "Revisión de prospectos",
    href: "/prospect-batches/review",
    icon: ClipboardList,
    // The pending-review queue reads via the admin (service-role) client and
    // gates the route/data to admins today (Q3F-5AZ.2A, read-only). Mirror that
    // gate in the sidebar so non-admins never see a dead-end "sin permisos"
    // view — role-scoped access is a later milestone.
    access: "adminOnly",
  },
  {
    title: "Uso de IA y costos",
    href: "/ai-usage",
    icon: BrainCircuit,
    // `/ai-usage` only returns data to admins today (queries gate it to admin
    // when ENABLE_COMMERCIAL_SCOPE is off — the production default). Showing it
    // to non-admins leads straight to the "requiere permisos de administrador"
    // banner, so it is hidden from the sidebar for them.
    access: "adminOnly",
  },
  {
    title: "Configuración",
    href: "/settings",
    icon: Settings,
    // `/settings` and every sensitive sub-route (users, ai, integrations,
    // automations, …) redirect non-admins. The module is administrative, so it
    // is hidden from the sidebar for non-admins.
    access: "adminOnly",
  },
];

/**
 * Pure predicate: can a user with the given context see this nav item?
 *
 * Kept free of server/IO dependencies so it is trivially unit-testable and
 * usable from both server and client components.
 */
export function canAccessNavItem(
  item: NavItem,
  ctx: NavAccessContext,
): boolean {
  switch (item.access ?? "public") {
    case "public":
      return true;
    case "adminOnly":
      return ctx.isAdmin;
    default:
      return false;
  }
}

/**
 * Returns the subset of nav items the given user may see. The UX principle is
 * "if a module is not available to the current role, hide it from the sidebar";
 * the per-route guards remain as protection for manual URL access.
 */
export function getVisibleNavItems(
  items: readonly NavItem[],
  ctx: NavAccessContext,
): NavItem[] {
  return items.filter((item) => canAccessNavItem(item, ctx));
}
