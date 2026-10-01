import Link from 'next/link';
import { ArrowRight } from "@/icons";
import { SettingsPage } from "@/components/settings/settings-page";
import {
  getVisibleSettingsSections,
  type SettingsSectionBadge,
} from "@/components/settings/settings-sections";
import { SurfaceCard } from "@/components/shared/surface-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { isCurrentUserAdmin, getUsersSummary, hasActiveAccess } from "@/modules/access/actions";
import { getUserDriveConnection } from "@/modules/drive/actions";
import { Heading } from '@/components/typography';

/**
 * Resumen de Configuración: una tarjeta por sección con lo que se hace en ella
 * y su estado. La navegación entre secciones vive en el marco (`layout.tsx`);
 * esta pantalla es la vista de conjunto, no un paso obligado.
 */
export default async function SettingsOverviewPage() {
  const [isAdmin, isActive] = await Promise.all([isCurrentUserAdmin(), hasActiveAccess()]);
  const [summary, driveConn] = await Promise.all([
    isAdmin ? getUsersSummary() : null,
    isActive ? getUserDriveConnection() : null,
  ]);

  const sections = getVisibleSettingsSections({ isAdmin, isActive });
  const pendingCount = summary?.pending ?? 0;
  const driveConnected = driveConn?.connection_status === 'connected';

  const badges: Record<string, SettingsSectionBadge | undefined> = {
    users:
      pendingCount > 0
        ? { label: `${pendingCount} pendiente${pendingCount === 1 ? '' : 's'}`, tone: 'warning' }
        : undefined,
    'my-drive': driveConnected
      ? { label: 'Conectado', tone: 'positive' }
      : { label: 'Sin conectar', tone: 'neutral' },
  };

  return (
    <SettingsPage
      title="Configuración"
      description="Quién entra a SellUp, con qué herramientas trabaja y cuánto se gasta en ellas."
    >
      {sections.length === 0 ? (
        <EmptyState
          title="No tienes secciones de configuración disponibles"
          description="Pide a un administrador que revise tu acceso."
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {sections.map((section) => {
            const badge = badges[section.id];
            return (
              <li key={section.id} className="min-w-0">
                <Link
                  href={section.href}
                  className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <SurfaceCard className="group h-full hover:border-primary/30 hover:shadow-drawer">
                    <div className="flex items-start gap-4">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                        <section.icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                          <Heading level={6} as="h2" className="leading-tight">
                            {section.title}
                          </Heading>
                          {badge && (
                            <Badge variant={badge.tone} className="shrink-0">
                              {badge.label}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {section.description}
                        </p>
                      </div>
                      <ArrowRight
                        aria-hidden
                        className="mt-1 size-4 shrink-0 text-text-muted transition-colors group-hover:text-primary"
                      />
                    </div>
                  </SurfaceCard>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsPage>
  );
}
