import Link from 'next/link';
import { Settings, Cpu, Link2, Search, Bot, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/surface-card";
import { isCurrentUserAdmin } from "@/modules/access/actions";

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
];

interface ConfigSection {
  title: string;
  description: string;
  status: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string | null;
  adminOnly?: boolean;
}

export default async function SettingsPage() {
  const isAdmin = await isCurrentUserAdmin();

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
          const CardContent = (
            <>
              <SurfaceCardHeader
                title={section.title}
                description={section.description}
                actions={
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
