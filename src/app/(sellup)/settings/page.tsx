import Link from 'next/link';
import { Settings, Cpu, Link2, Search, Bot, Users, Activity, HardDrive, BarChart2, Database, Coins } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/surface-card";
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
    title: "Proveedores y tarifas de IA",
    description: "Proveedores, modelos y tarifas base de inteligencia artificial",
    status: "Funcional",
    icon: Cpu,
    href: "/settings/ai",
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
    title: "Estado y auditoría",
    description: "Monitorea la salud de configuraciones clave y revisa cambios administrativos recientes en SellUp.",
    status: "Funcional",
    icon: Activity,
    href: "/settings/system-status",
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
    title: "Uso, costos y efectividad",
    description: "Foundation operativa para monitorear ejecuciones de agentes, llamadas a proveedores y costos estimados por resultado.",
    status: "Foundation",
    icon: BarChart2,
    href: "/settings/usage",
    adminOnly: true,
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
  {
    title: "Créditos y presupuestos",
    description: "Controla el consumo de herramientas con créditos, costos y reglas por proveedor.",
    status: "Funcional",
    icon: Coins,
    href: "/settings/budget-credits",
    adminOnly: true,
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

          const CardContent = (
            <>
              <SurfaceCardHeader
                title={section.title}
                description={section.description}
                actions={
                  <div className="flex items-center gap-2">
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
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
                        section.status === 'Funcional'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                          : 'border-border/40 bg-muted/30 text-muted-foreground/60'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          section.status === 'Funcional'
                            ? 'bg-emerald-500'
                            : 'bg-muted-foreground/25'
                        }`}
                      />
                      {section.status}
                    </span>
                  </div>
                }
              />
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                    section.status === 'Funcional'
                      ? 'bg-su-brand-soft text-su-brand group-hover:bg-su-brand/20'
                      : 'bg-accent/60 text-muted-foreground/40 group-hover:bg-su-brand/10 group-hover:text-su-brand/60'
                  }`}
                >
                  <section.icon className="h-4 w-4" />
                </div>
                {section.status !== 'Funcional' && (
                  <div className="flex-1 space-y-2">
                    <div className="h-1.5 w-3/4 rounded-full su-skeleton" />
                    <div className="h-1.5 w-1/2 rounded-full su-skeleton" />
                  </div>
                )}
              </div>
            </>
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
              <SurfaceCardHeader
                title="Mi Google Drive"
                description="Conecta tu Drive para guardar propuestas, business cases y archivos generados por SellUp en tu propio espacio de trabajo."
                actions={
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
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
                }
              />
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors bg-su-brand-soft text-su-brand group-hover:bg-su-brand/20">
                  <HardDrive className="h-4 w-4" />
                </div>
              </div>
            </SurfaceCard>
          </Link>
        )}
      </div>

      <ModulePlaceholder
        icon={Settings}
        module="Configuración e Integraciones — Módulo en construcción"
        description="El módulo de Configuración centralizará los parámetros del sistema, integraciones con herramientas externas y los niveles de automatización de los agentes."
        features={[
          { label: "Proveedores de IA y selección de modelos" },
          { label: "Integración con HubSpot CRM" },
          { label: "Conexión con proveedor de prospección activo" },
          { label: "Niveles de automatización por agente" },
          { label: "Gestión de claves API" },
          { label: "Parámetros globales del sistema" },
        ]}
      />
    </div>
  );
}
