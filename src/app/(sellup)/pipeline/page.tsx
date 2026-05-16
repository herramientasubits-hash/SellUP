import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { SurfaceCard } from "@/components/shared/surface-card";

const PIPELINE_STATES = [
  {
    label: "Preparación inicial",
    count: "—",
    gradient: "from-muted/60 to-muted/30",
    accent: "bg-muted-foreground/20",
  },
  {
    label: "Listos para profundizar",
    count: "—",
    gradient: "from-su-brand/10 to-su-brand/5",
    accent: "bg-su-brand/30",
  },
  {
    label: "Inteligencia lista",
    count: "—",
    gradient: "from-su-brand/15 to-su-accent-cool/10",
    accent: "bg-su-brand/50",
  },
  {
    label: "Preparados para contacto",
    count: "—",
    gradient: "from-su-success/10 to-su-brand/10",
    accent: "bg-su-success/50",
  },
];

export default function PipelinePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Pipeline SellUp"
        description="Vista operativa del avance de cuentas en los macroestados del proceso comercial."
      />

      {/* Kanban column cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {PIPELINE_STATES.map((state, i) => (
          <SurfaceCard
            key={state.label}
            className="group relative min-h-[180px] overflow-hidden"
          >
            {/* Subtle gradient overlay */}
            <div
              className={`absolute inset-0 bg-gradient-to-br ${state.gradient} rounded-2xl opacity-60 transition-opacity group-hover:opacity-100`}
            />
            <div className="relative space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground/70 font-heading">
                  {state.label}
                </p>
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-card/60 text-[10px] font-bold text-muted-foreground/40">
                  {i + 1}
                </span>
              </div>
              <div className={`h-1 w-full rounded-full ${state.accent}`} />
              <p className="text-3xl font-bold tracking-tight text-muted-foreground/25 font-heading">
                {state.count}
              </p>
              <p className="text-[11px] text-muted-foreground/40">
                Sin cuentas todavía
              </p>
            </div>
          </SurfaceCard>
        ))}
      </div>

      {/* Module placeholder */}
      <ModulePlaceholder
        icon={LayoutDashboard}
        module="Pipeline SellUp — Módulo en construcción"
        description="El Pipeline será la entrada operativa principal del MVP. Aquí vivirá el avance de cuentas a través de los cuatro macroestados del proceso comercial asistido por IA."
        features={[
          { label: "Vista kanban por macroestado" },
          { label: "Tarjetas de cuenta con estado y señales" },
          { label: "Acceso directo al expediente" },
          { label: "Filtros por industria, tamaño y estado" },
          { label: "Indicadores de progreso de agentes IA" },
          { label: "Acciones rápidas por cuenta" },
        ]}
      />
    </div>
  );
}
