import Link from 'next/link';
import { Link2, Search, Bot, Users, Activity, HardDrive, Database, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { SurfaceCard } from "@/components/shared/surface-card";
import { isCurrentUserAdmin, getUsersSummary, hasActiveAccess } from "@/modules/access/actions";
import { getUserDriveConnection } from "@/modules/drive/actions";

const CONFIG_SECTIONS = [
  {
    title: "Usuarios y acceso",
    description: "Gestionar solicitudes, roles y estados de acceso",
    status: "Funcional",
    icon: Users,
    href: "/settings/users",
    adminOnly: true,
  },
  {
    title: "Proveedores y consumo",
    description: "Configura proveedores de IA y herramientas externas, controla presupuestos y monitorea consumo mensual.",
    status: "Funcional",
    icon: Layers,
    href: "/settings/providers",
    adminOnly: true,
  },
  {
    title: "Automatizaciones",
    description: "Define qué acciones de SellUp se ejecutan manualmente, como sugerencia o de forma automática.",
    status: "Funcional",
    icon: Bot,
    href: "/settings/automations",
    adminOnly: true,
  },
  {
    title: "Integraciones comerciales",
    description: "Conecta HubSpot y futuras herramientas externas que alimentan la operación comercial de SellUp.",
    status: "Funcional",
    icon: Link2,
    href: "/settings/integrations",
    adminOnly: true,
  },
  {
    title: "Prospección y enriquecimiento",
    description: "Prepara la conexión con proveedores externos para generar, validar y enriquecer cuentas comerciales.",
    status: "Funcional",
    icon: Search,
    href: "/settings/prospecting",
    adminOnly: true,
  },
  {
    title: "Actividad de la plataforma",
    description: "Historial de acciones de usuarios, integraciones y configuración de IA. Los líderes pueden ver la actividad de su equipo.",
    status: "Funcional",
    icon: Activity,
    href: "/settings/activity",
    adminOnly: false,
  },
  {
    title: "Catálogo de fuentes",
    description: "Consulta el estado, cobertura y prioridad de las fuentes de datos usadas por SellUp.",
    status: "Funcional",
    icon: Database,
    href: "/settings/source-catalog",
    adminOnly: true,
    badge: "52 fuentes",
  },
];

export default async function SettingsPage() {
  const isAdmin = await isCurrentUserAdmin();
  const isActive = await hasActiveAccess();
  const summary = isAdmin ? await getUsersSummary() : null;

  // Drive connection for personal card (any active user)
  const driveConn = isActive ? await getUserDriveConnection() : null;
  const driveConnected = driveConn?.connection_status === 'connected';

  const visibleSections = CONFIG_SECTIONS.filter(
    (section) => !section.adminOnly || isAdmin
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Configuración e Integraciones"
        description="Parámetros del sistema, integraciones externas y configuración de agentes."
      />

      {/* Config section cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {visibleSections.map((section) => {
          const isPendingUsersSection = section.href === '/settings/users';
          const pendingCount = isPendingUsersSection && summary ? summary.pending : 0;

          // Design Refresh v1: icono anclado a la izquierda del contenido
          // (antes flotaba huérfano bajo el header) y sin pill "Funcional"
          // repetido — el estado normal no se anuncia, solo las excepciones.
          const CardContent = (
            <div className="flex items-start gap-4">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  section.status === 'Funcional'
                    ? 'bg-su-brand-soft text-su-brand group-hover:bg-su-brand/20'
                    : 'bg-accent/60 text-muted-foreground/40 group-hover:bg-su-brand/10 group-hover:text-su-brand/60'
                }`}
              >
                <section.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-sm font-semibold leading-tight text-foreground">
                    {section.title}
                  </h2>
                  <div className="flex shrink-0 items-center gap-2">
                    {pendingCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-amber-500">
                        {pendingCount} pendiente{pendingCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {'badge' in section && section.badge && (
                      <span className="inline-flex items-center rounded-full border border-su-brand/30 bg-su-brand-soft px-2.5 py-0.5 text-[10px] font-medium text-su-brand">
                        {section.badge}
                      </span>
                    )}
                    {section.status !== 'Funcional' && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/60">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
                        {section.status}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {section.description}
                </p>
              </div>
            </div>
          );

          if (section.href) {
            return (
              <Link key={section.title} href={section.href}>
                <SurfaceCard className="group cursor-pointer transition-all hover:border-su-brand/30 hover:shadow-md">
                  {CardContent}
                </SurfaceCard>
              </Link>
            );
          }

          return (
            <SurfaceCard key={section.title} className="group">
              {CardContent}
            </SurfaceCard>
          );
        })}

        {/* Mi Google Drive — visible para todo usuario activo */}
        {isActive && (
          <Link href="/settings/my-drive">
            <SurfaceCard className="group cursor-pointer transition-all hover:border-su-brand/30 hover:shadow-md">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-su-brand-soft text-su-brand transition-colors group-hover:bg-su-brand/20">
                  <HardDrive className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-sm font-semibold leading-tight text-foreground">
                      Mi Google Drive
                    </h2>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
                        driveConnected
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                          : 'border-border/40 bg-muted/30 text-muted-foreground/60'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          driveConnected ? 'bg-emerald-500' : 'bg-muted-foreground/25'
                        }`}
                      />
                      {driveConnected ? 'Conectado' : 'No conectado'}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Conecta tu Drive para guardar propuestas, business cases y archivos generados por SellUp en tu propio espacio de trabajo.
                  </p>
                </div>
              </div>
            </SurfaceCard>
          </Link>
        )}
      </div>

    </div>
  );
}
