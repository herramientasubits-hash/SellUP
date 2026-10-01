import type { LucideIcon } from "@/icons";
import { Activity, HardDrive, Layers, Users } from "@/icons";
import {
  ACCOUNTS_EMPRESAS_ROUTE,
  CONTACTS_APPROVED_ROUTE,
  CONTACTS_CANDIDATES_ROUTE,
  PROSPECTOS_DISCARDED_TAB_ROUTE,
  PROSPECTOS_TAB_ROUTE,
  getVisibleNavItems,
  mainNavItems,
  type NavAccessContext,
} from "@/config/navigation";
import {
  SETTINGS_ROOT_HREF,
  getVisibleSettingsSections,
  type SettingsSection,
} from "@/components/settings/settings-sections";

/** Un destino dentro de una sección del menú. */
export interface SidebarNavChild {
  id: string;
  label: string;
  href: string;
  /** Rutas sin entrada propia que pertenecen a este destino. */
  aliases?: readonly string[];
}

/** Una sección del menú lateral: navega sola o despliega sus destinos. */
export interface SidebarNavRoot {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  children?: readonly SidebarNavChild[];
}

/**
 * Las vistas que hoy viven en la barra de pestañas de cada módulo. El menú las
 * ofrece como atajo; las pestañas de la página siguen ahí. Los rótulos son los
 * mismos de `ModuleTabsNav` y `ContactsModuleTabsNav`.
 */
const MODULE_VIEWS: Readonly<Record<string, readonly SidebarNavChild[]>> = {
  "/accounts": [
    { id: "accounts-empresas", label: "Empresas", href: ACCOUNTS_EMPRESAS_ROUTE },
    { id: "accounts-por-revisar", label: "Por revisar", href: PROSPECTOS_TAB_ROUTE },
    { id: "accounts-descartadas", label: "Descartadas", href: PROSPECTOS_DISCARDED_TAB_ROUTE },
  ],
  "/contacts": [
    { id: "contacts-contactos", label: "Contactos", href: CONTACTS_APPROVED_ROUTE },
    { id: "contacts-por-revisar", label: "Por revisar", href: CONTACTS_CANDIDATES_ROUTE },
  ],
};

function settingsChild(section: SettingsSection): SidebarNavChild {
  return {
    id: `settings-${section.id}`,
    label: section.title,
    href: section.href,
    aliases: section.aliases,
  };
}

/**
 * El árbol del menú lateral para quien mira: las secciones de
 * `mainNavItems` que su rol puede ver (`navAccess`) y, dentro, sus vistas.
 * Nunca lista un destino que le redirigiría.
 */
export function buildSidebarNav(navAccess: NavAccessContext): SidebarNavRoot[] {
  const settingsChildren = getVisibleSettingsSections({
    isAdmin: navAccess.isAdmin,
    isActive: true,
  }).map(settingsChild);

  return getVisibleNavItems(mainNavItems, navAccess).map((item) => {
    const children =
      item.href === SETTINGS_ROOT_HREF ? settingsChildren : MODULE_VIEWS[item.href];
    return {
      id: item.href,
      label: item.title,
      href: item.href,
      icon: item.icon,
      children: children && children.length > 0 ? children : undefined,
    };
  });
}

function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function splitHref(href: string): { path: string; params: URLSearchParams } {
  const [path, query = ""] = href.split("?");
  return { path, params: new URLSearchParams(query) };
}

/** Cuántos parámetros del destino coinciden con la URL; -1 si alguno no. */
function childSpecificity(child: SidebarNavChild, pathname: string, search: URLSearchParams): number {
  const { path, params } = splitHref(child.href);
  const inPath =
    matchesPath(pathname, path) ||
    Boolean(child.aliases?.some((alias) => matchesPath(pathname, alias)));
  if (!inPath) return -1;
  let matched = 0;
  for (const [key, value] of params) {
    if (search.get(key) !== value) return -1;
    matched += 1;
  }
  return matched;
}

export interface ActiveSidebarNode {
  rootId: string | null;
  childId: string | null;
}

/**
 * Dónde estás en el menú: la sección y, si tiene vistas, cuál. Sin parámetro
 * en la URL gana la primera vista del módulo (`/accounts` es «Empresas»).
 */
export function resolveActiveSidebarNode(
  nav: readonly SidebarNavRoot[],
  pathname: string,
  search: URLSearchParams,
): ActiveSidebarNode {
  for (const root of nav) {
    const children = root.children ?? [];
    let best: SidebarNavChild | null = null;
    let bestScore = -1;
    for (const child of children) {
      const score = childSpecificity(child, pathname, search);
      if (score > bestScore) {
        best = child;
        bestScore = score;
      }
    }
    const inRoot = matchesPath(pathname, root.href);
    if (!inRoot && !best) continue;
    if (best) return { rootId: root.id, childId: best.id };
    const firstChild = children[0];
    const defaultsToFirst = firstChild && splitHref(firstChild.href).path === root.href;
    return { rootId: root.id, childId: defaultsToFirst ? firstChild.id : null };
  }
  return { rootId: null, childId: null };
}

/** Un grupo de ajustes del menú de la marca. */
export interface WorkspaceSettingsGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: readonly { id: string; label: string; href: string }[];
}

const SETTINGS_GROUPS: readonly { id: string; label: string; icon: LucideIcon; sections: readonly string[] }[] = [
  { id: "team", label: "Equipo", icon: Users, sections: ["users", "activity"] },
  {
    id: "data",
    label: "Datos e IA",
    icon: Layers,
    sections: ["providers", "prospecting", "source-catalog", "automations"],
  },
  { id: "connections", label: "Conexiones", icon: HardDrive, sections: ["integrations", "my-drive"] },
];

/** Para que una sección nueva de Configuración nunca se quede sin puerta. */
const OTHER_GROUP = { id: "other", label: "Más ajustes", icon: Activity } as const;

/**
 * Los ajustes del menú de la marca, agrupados: un grupo, una fila. Solo las
 * secciones que puede ver quien mira; un grupo vacío no se pinta.
 */
export function buildWorkspaceSettingsGroups(navAccess: NavAccessContext): WorkspaceSettingsGroup[] {
  const visible = getVisibleSettingsSections({ isAdmin: navAccess.isAdmin, isActive: true });
  const grouped = new Set<string>(SETTINGS_GROUPS.flatMap((group) => group.sections));
  const toItem = (section: SettingsSection) => ({
    id: section.id,
    label: section.title,
    href: section.href,
  });

  const groups = SETTINGS_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    icon: group.icon,
    items: group.sections
      .map((id) => visible.find((section) => section.id === id))
      .filter((section): section is SettingsSection => Boolean(section))
      .map(toItem),
  }));
  const rest = visible.filter((section) => !grouped.has(section.id)).map(toItem);

  return [...groups, { ...OTHER_GROUP, items: rest }].filter((group) => group.items.length > 0);
}
