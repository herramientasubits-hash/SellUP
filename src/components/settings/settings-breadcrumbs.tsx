"use client";

import { usePathname } from "next/navigation";

import { Breadcrumbs, type BreadcrumbItem } from "@/components/navigation/breadcrumbs";
import {
  SETTINGS_ROOT_HREF,
  SETTINGS_SECTIONS,
  resolveSettingsSectionId,
} from "@/components/settings/settings-sections";

export type SettingsTrail = readonly (string | BreadcrumbItem)[];

function crumbLabel(item: string | BreadcrumbItem): string {
  return typeof item === "string" ? item : item.label;
}

/**
 * Las migas de una pantalla de Configuración, a continuación de «SellUp ›
 * Configuración» en la barra superior.
 *
 * Configuración ya no tiene menú lateral: la ruta es lo único que dice dónde se
 * está. Por eso la sección sale siempre de la URL (`resolveSettingsSectionId`)
 * —también en las rutas antiguas que solo son alias— y no depende de que cada
 * pantalla se acuerde de ponerla:
 *
 * - `/settings/providers` → «Proveedores y consumo»
 * - `/settings/integrations/hubspot` → «Integraciones comerciales › HubSpot»
 *
 * Si el `trail` de la pantalla ya empieza por la sección, no se repite; si el
 * título es el de la sección, tampoco. En el resumen (`/settings`) no hay migas.
 */
export function SettingsBreadcrumbs({ trail = [], title }: { trail?: SettingsTrail; title: string }) {
  const pathname = usePathname() ?? "";
  // El resumen ya lo nombra la barra: «SellUp › Configuración».
  if (pathname === SETTINGS_ROOT_HREF) return null;

  const sectionId = resolveSettingsSectionId(pathname);
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === sectionId);

  const items: (string | BreadcrumbItem)[] = [];
  if (section) items.push({ label: section.title, href: section.href });
  for (const item of trail) {
    if (items.some((existing) => crumbLabel(existing) === crumbLabel(item))) continue;
    items.push(item);
  }
  if (!items.some((existing) => crumbLabel(existing) === title)) items.push(title);

  return <Breadcrumbs items={items} />;
}
