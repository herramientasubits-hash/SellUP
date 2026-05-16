import { BrainCircuit, Zap, Coins, Activity } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/surface-card";

const STAT_CARDS = [
  {
    label: "Ejecuciones totales",
    value: "—",
    icon: Zap,
    gradient: "from-su-brand/10 to-su-accent-cool/5",
  },
  {
    label: "Tokens consumidos",
    value: "—",
    icon: Activity,
    gradient: "from-su-accent-cool/10 to-su-brand/5",
  },
  {
    label: "Costo estimado",
    value: "—",
    icon: Coins,
    gradient: "from-su-warning/8 to-su-accent-warm/5",
  },
  {
    label: "Agentes activos",
    value: "—",
    icon: BrainCircuit,
    gradient: "from-su-success/8 to-su-brand/5",
  },
];

export default function AIUsagePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Uso de IA y costos"
        description="Registro de ejecuciones de agentes, consumo de tokens y costos estimados."
      />

      {/* Stat cards with icon + gradient */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_CARDS.map((stat) => (
          <SurfaceCard key={stat.label} className="group relative overflow-hidden">
            <div className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} rounded-2xl opacity-50 transition-opacity group-hover:opacity-100`} />
            <div className="relative">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground/70">
                  {stat.label}
                </p>
                <stat.icon className="h-4 w-4 text-muted-foreground/30" />
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight text-muted-foreground/25 font-heading">
                {stat.value}
              </p>
            </div>
          </SurfaceCard>
        ))}
      </div>

      {/* Execution log skeleton */}
      <SurfaceCard noPadding>
        <div className="border-b border-border/40 px-5 py-4">
          <SurfaceCardHeader title="Registro de ejecuciones" className="mb-0" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border/20 px-5 py-4 transition-colors hover:bg-accent/30 last:border-0"
          >
            <div className="h-2 w-24 rounded-full su-skeleton" />
            <div className="h-2 w-32 rounded-full su-skeleton flex-1" />
            <div className="h-6 w-16 rounded-full su-skeleton" />
            <div className="h-2 w-16 rounded-full su-skeleton" />
          </div>
        ))}
      </SurfaceCard>

      <ModulePlaceholder
        icon={BrainCircuit}
        module="Uso de IA y costos — Módulo en construcción"
        description="Vista de trazabilidad y control de consumo de IA. Permite auditar cada ejecución de agente con detalle de usuario, cuenta, modelo, tokens, costo y resultado."
        features={[
          { label: "Registro por ejecución de agente" },
          { label: "Consumo por modelo de IA" },
          { label: "Costos por cuenta y por usuario" },
          { label: "Trazabilidad de estados y regeneraciones" },
          { label: "Exportación de reportes" },
          { label: "Alertas de consumo por umbral" },
        ]}
      />
    </div>
  );
}
