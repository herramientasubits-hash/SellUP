"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard } from "@/icons";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SETTINGS_ROOT_HREF,
  getVisibleSettingsSections,
  resolveSettingsSectionId,
  type SettingsSectionBadges,
  type SettingsViewer,
} from "./settings-sections";

const OVERVIEW_ID = "overview";
const OVERVIEW_TITLE = "Resumen";

interface SettingsNavProps extends SettingsViewer {
  /** Avisos por sección (`id` → «5 pendientes»). */
  badges?: SettingsSectionBadges;
  className?: string;
}

interface NavEntry {
  id: string;
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * SettingsNav — la navegación secundaria de Configuración. Está en todas las
 * pantallas del módulo para pasar de una sección a otra sin volver al resumen.
 *
 * - **Escritorio (`lg`)**: lista lateral con icono, nombre y aviso de estado.
 * - **Móvil**: un selector con las mismas secciones, encima del contenido.
 *
 * Solo lista las secciones que quien mira puede abrir. Usa el dibujo de
 * `NavLink` (misma altura, mismo estado activo) pero no la pieza: aquí cada
 * entrada lleva un aviso y el «Resumen» solo se marca en su ruta exacta.
 */
export function SettingsNav({ isAdmin, isActive, badges = {}, className }: SettingsNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  const sections = getVisibleSettingsSections({ isAdmin, isActive });
  const entries: NavEntry[] = [
    { id: OVERVIEW_ID, title: OVERVIEW_TITLE, href: SETTINGS_ROOT_HREF, icon: LayoutDashboard },
    ...sections,
  ];

  const sectionId = resolveSettingsSectionId(pathname);
  const activeId = sectionId ?? (pathname === SETTINGS_ROOT_HREF ? OVERVIEW_ID : null);

  return (
    <div className={cn("shrink-0 lg:w-60", className)}>
      {/* Móvil y tableta: selector */}
      <div className="lg:hidden">
        <Select
          value={activeId ?? ""}
          onValueChange={(value) => {
            const next = entries.find((entry) => entry.id === value);
            if (next && next.id !== activeId) router.push(next.href);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Sección de Configuración">
            <SelectValue>
              {entries.find((entry) => entry.id === activeId)?.title ?? "Ir a una sección"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {entries.map((entry) => {
              const badge = badges[entry.id];
              return (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.title}
                  {badge ? ` · ${badge.label}` : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Escritorio: lista lateral */}
      <nav aria-label="Secciones de Configuración" className="hidden flex-col gap-0.5 lg:flex">
        {entries.map((entry) => {
          const isCurrent = entry.id === activeId;
          const badge = badges[entry.id];
          return (
            <Link
              key={entry.id}
              href={entry.href}
              aria-current={isCurrent ? "page" : undefined}
              className={cn(
                "group flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                isCurrent
                  ? "bg-primary/10 font-semibold text-primary"
                  : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
              )}
            >
              <entry.icon
                className={cn(
                  "size-4 shrink-0",
                  isCurrent ? "text-primary" : "text-text-muted group-hover:text-foreground",
                )}
              />
              <span className="min-w-0 flex-1 leading-snug">{entry.title}</span>
              {badge && (
                <Badge variant={badge.tone} className="shrink-0">
                  {badge.label}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
