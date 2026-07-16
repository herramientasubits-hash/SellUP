import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { SurfaceCard } from "@/components/shared/surface-card";

// Design Refresh v1: sin overlays de gradiente sobre la card (lavaban la
// superficie) — la identidad de cada macroestado la da solo la barra de acento.
const PIPELINE_STATES = [
  {
    label: "Preparación inicial",
    count: 0,
    accent: "bg-muted-foreground/30",
  },
  {
    label: "Listos para profundizar",
    count: 0,
    accent: "bg-su-brand/50",
  },
  {
    label: "Inteligencia lista",
    count: 0,
    accent: "bg-su-brand/80",
  },
  {
    label: "Preparados para contacto",
    count: 0,
    accent: "bg-su-success/70",
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
          <SurfaceCard key={state.label} className="group min-h-[170px]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground/80">
                  {state.label}
                </p>
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-muted/60 text-[10px] font-bold text-muted-foreground">
                  {i + 1}
                </span>
              </div>
              <div className={`h-1 w-full rounded-full ${state.accent}`} />
              <p className="text-3xl font-bold tracking-tight text-foreground/85 tabular-nums">
                {state.count}
              </p>
              <p className="text-[11px] text-muted-foreground/70">
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
