import {
  Activity,
  Bot,
  HardDrive,
  Layers,
  Link2,
  Search,
  Users,
  type LucideIcon,
} from "@/icons";

/** Quién puede ver una sección de Configuración. */
export type SettingsSectionAccess = "admin" | "active";

export interface SettingsSection {
  /** Identidad estable: con ella se cruzan los avisos (`SettingsSectionBadge`). */
  id: string;
  title: string;
  /** Qué se hace en la sección, en una frase. Se lee en el resumen. */
  description: string;
  href: string;
  icon: LucideIcon;
  access: SettingsSectionAccess;
  /**
   * Rutas que no tienen entrada propia y pertenecen a esta sección (vistas
   * antiguas que siguen vivas por compatibilidad).
   */
  aliases?: readonly string[];
}

export type SettingsBadgeTone = "warning" | "brand" | "positive" | "neutral";

/** El aviso corto que acompaña a una sección: «5 pendientes», «Conectado». */
export interface SettingsSectionBadge {
  label: string;
  tone: SettingsBadgeTone;
}

export type SettingsSectionBadges = Readonly<Record<string, SettingsSectionBadge | undefined>>;

export const SETTINGS_ROOT_HREF = "/settings";

/**
 * Las secciones de Configuración, en el orden en que se leen. Es la única
 * lista: de aquí salen el resumen (`/settings`), la navegación interna
 * (`SettingsNav`) y los grupos del menú de la marca.
 *
 * «Catálogo de fuentes» ya no está aquí: es un módulo propio del menú lateral
 * (`/source-catalog`).
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "users",
    title: "Usuarios y acceso",
    description: "Aprueba solicitudes y gestiona roles, grupos y accesos del equipo.",
    href: "/settings/users",
    icon: Users,
    access: "admin",
  },
  {
    id: "providers",
    title: "Proveedores y consumo",
    description: "Conecta los proveedores de datos e IA, fija sus cuotas y revisa cuánto se ha gastado este mes.",
    href: "/settings/providers",
    icon: Layers,
    access: "admin",
    aliases: ["/settings/budget-credits", "/settings/usage", "/settings/ai"],
  },
  {
    id: "automations",
    title: "Automatizaciones",
    description: "Decide qué hace SellUp por su cuenta, qué sugiere y qué espera a que lo hagas tú.",
    href: "/settings/automations",
    icon: Bot,
    access: "admin",
  },
  {
    id: "integrations",
    title: "Integraciones comerciales",
    description: "Conecta HubSpot, Slack y las demás herramientas con las que trabaja el equipo comercial.",
    href: "/settings/integrations",
    icon: Link2,
    access: "admin",
  },
  {
    id: "prospecting",
    title: "Prospección y enriquecimiento",
    description: "Prepara los proveedores con los que se encuentran empresas y se completan sus datos.",
    href: "/settings/prospecting",
    icon: Search,
    access: "admin",
  },
  {
    id: "activity",
    title: "Actividad de la plataforma",
    description: "Quién hizo qué y cuándo: usuarios, integraciones y cambios de configuración.",
    href: "/settings/activity",
    icon: Activity,
    access: "active",
  },
  {
    id: "my-drive",
    title: "Mi Google Drive",
    description: "Conecta tu Drive para guardar ahí las propuestas y los archivos que genera SellUp.",
    href: "/settings/my-drive",
    icon: HardDrive,
    access: "active",
  },
];

export interface SettingsViewer {
  isAdmin: boolean;
  /** Tiene acceso activo a SellUp (cualquier rol). */
  isActive: boolean;
}

/** Las secciones que puede ver quien mira. Nunca se pinta una que redirige. */
export function getVisibleSettingsSections(viewer: SettingsViewer): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) =>
    section.access === "admin" ? viewer.isAdmin : viewer.isAdmin || viewer.isActive,
  );
}

function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * La sección a la que pertenece una ruta, o `null` en el resumen y en rutas
 * sin sección (p. ej. `/settings/system-status`).
 */
export function resolveSettingsSectionId(pathname: string): string | null {
  for (const section of SETTINGS_SECTIONS) {
    if (matchesPath(pathname, section.href)) return section.id;
    if (section.aliases?.some((alias) => matchesPath(pathname, alias))) return section.id;
  }
  return null;
}
