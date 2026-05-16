import { Settings, Cpu, Link2, Rocket, Key } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/surface-card";

const CONFIG_SECTIONS = [
  {
    title: "Proveedores de IA",
    description: "Modelos, claves API y parámetros de generación",
    status: "Pendiente",
    icon: Cpu,
  },
  {
    title: "Integración HubSpot",
    description: "Sincronización de cuentas y contactos",
    status: "Pendiente",
    icon: Link2,
  },
  {
    title: "Integración Apollo.io",
    description: "Enriquecimiento automático de prospectos",
    status: "Pendiente",
    icon: Rocket,
  },
  {
    title: "Automatización",
    description: "Niveles de automatización por módulo",
    status: "Pendiente",
    icon: Key,
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Configuración e Integraciones"
        description="Parámetros del sistema, integraciones externas y configuración de agentes."
      />

      {/* Config section cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {CONFIG_SECTIONS.map((section) => (
          <SurfaceCard key={section.title} className="group">
            <SurfaceCardHeader
              title={section.title}
              description={section.description}
              actions={
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
                  {section.status}
                </span>
              }
            />
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/60 text-muted-foreground/40 transition-colors group-hover:bg-su-brand/10 group-hover:text-su-brand/60">
                <section.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="h-1.5 w-3/4 rounded-full su-skeleton" />
                <div className="h-1.5 w-1/2 rounded-full su-skeleton" />
              </div>
            </div>
          </SurfaceCard>
        ))}
      </div>

      <ModulePlaceholder
        icon={Settings}
        module="Configuración e Integraciones — Módulo en construcción"
        description="El módulo de Configuración centralizará los parámetros del sistema, integraciones con herramientas externas y los niveles de automatización de los agentes."
        features={[
          { label: "Proveedores de IA y selección de modelos" },
          { label: "Integración con HubSpot CRM" },
          { label: "Integración con Apollo.io" },
          { label: "Niveles de automatización por agente" },
          { label: "Gestión de claves API" },
          { label: "Parámetros globales del sistema" },
        ]}
      />
    </div>
  );
}
