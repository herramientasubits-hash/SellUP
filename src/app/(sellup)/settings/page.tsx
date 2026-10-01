import Link from 'next/link';
import { Link2, Search, Bot, Users, Activity, HardDrive, Database, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { SurfaceCard } from "@/components/shared/surface-card";
import { Badge } from "@/components/ui/badge";
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
    <div className="space-y-6">
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
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                  section.status === 'Funcional'
                    ? 'bg-primary/10 text-primary group-hover:bg-primary/15'
                    : 'bg-surface-muted text-text-muted group-hover:bg-primary/10 group-hover:text-primary'
                }`}
              >
                <section.icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold leading-tight tracking-tight text-foreground">
                    {section.title}
                  </h2>
                  <div className="flex shrink-0 items-center gap-2">
                    {pendingCount > 0 && (
                      <Badge variant="warning">
                        {pendingCount} pendiente{pendingCount > 1 ? 's' : ''}
                      </Badge>
                    )}
                    {'badge' in section && section.badge && (
                      <Badge variant="brand">{section.badge}</Badge>
                    )}
                    {section.status !== 'Funcional' && (
                      <Badge variant="neutral">
                        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                        {section.status}
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {section.description}
                </p>
              </div>
            </div>
          );

          if (section.href) {
            return (
              <Link
                key={section.title}
                href={section.href}
                className="block rounded-2xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <SurfaceCard className="group h-full cursor-pointer hover:border-primary/30 hover:shadow-drawer">
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
          <Link
            href="/settings/my-drive"
            className="block rounded-2xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <SurfaceCard className="group h-full cursor-pointer hover:border-primary/30 hover:shadow-drawer">
              <div className="flex items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                  <HardDrive className="size-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-base font-semibold leading-tight tracking-tight text-foreground">
                      Mi Google Drive
                    </h2>
                    <Badge variant={driveConnected ? 'positive' : 'neutral'} className="shrink-0">
                      <span
                        className={`size-1.5 rounded-full ${
                          driveConnected ? 'bg-success' : 'bg-muted-foreground/40'
                        }`}
                      />
                      {driveConnected ? 'Conectado' : 'No conectado'}
                    </Badge>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
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
