import { redirect } from 'next/navigation';
import { Bot, Zap, MousePointerClick, Lightbulb, Brain } from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { EmptyState } from '@/components/ui/empty-state';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getAllAutomations, getAutomationsSummary } from '@/modules/automations/actions';
import {
  EXECUTION_MODE_LABELS,
  EXECUTION_MODE_DESCRIPTIONS,
  type AutomationExecutionMode,
} from '@/modules/automations/types';
import { AutomationCard } from './automation-card';

export default async function AutomationsPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [automations, summary] = await Promise.all([
    getAllAutomations(),
    getAutomationsSummary(),
  ]);

  const summaryCards = [
    {
      label: 'Configuradas',
      description: 'Total de automatizaciones',
      value: summary.total,
      icon: Bot,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Automáticas',
      description: 'Ejecutadas sin intervención',
      value: summary.automatic,
      icon: Zap,
      color: 'text-success',
      bg: 'bg-success/10',
    },
    {
      label: 'Sugeridas',
      description: 'Con sugerencia de IA',
      value: summary.suggested,
      icon: Lightbulb,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Manuales',
      description: 'Requieren acción humana',
      value: summary.manual,
      icon: MousePointerClick,
      color: 'text-muted-foreground',
      bg: 'bg-surface-subtle',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automatizaciones"
        description="Controla cómo SellUp responde ante eventos clave del flujo comercial, definiendo qué acciones son manuales, sugeridas o automáticas."
        backHref="/settings"
      />

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <MetricCard
            key={card.label}
            title={card.label}
            description={card.description}
            value={card.value}
            iconPosition="top"
            icon={
              <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} aria-hidden="true" />
              </div>
            }
          />
        ))}
      </div>

      {/* Leyenda de modos */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Modos de ejecución"
          description="Cómo SellUp interpreta cada configuración"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              {
                mode: 'manual' as AutomationExecutionMode,
                icon: MousePointerClick,
                color: 'text-muted-foreground',
                bg: 'bg-surface-subtle',
              },
              {
                mode: 'suggested' as AutomationExecutionMode,
                icon: Lightbulb,
                color: 'text-primary',
                bg: 'bg-primary/10',
              },
              {
                mode: 'automatic' as AutomationExecutionMode,
                icon: Zap,
                color: 'text-success',
                bg: 'bg-success/10',
              },
            ] as const
          ).map(({ mode, icon: Icon, color, bg }) => (
            <div
              key={mode}
              className="flex items-start gap-3 rounded-xl border border-border/60 p-3"
            >
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-3 w-3 ${color}`} aria-hidden="true" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs font-semibold text-foreground">
                  {EXECUTION_MODE_LABELS[mode]}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {EXECUTION_MODE_DESCRIPTIONS[mode]}
                </p>
              </div>
            </div>
          ))}
        </div>
      </SurfaceCard>

      {/* Listado de automatizaciones */}
      <section className="space-y-4">
        <SurfaceCardHeader
          className="mb-0"
          title="Automatizaciones configurables"
          description="Ajusta el comportamiento de SellUp para cada evento operativo"
        />

        {automations.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="Sin automatizaciones registradas"
            description="Las automatizaciones aparecerán aquí cuando sean configuradas en el sistema."
          />
        ) : (
          <div className="space-y-4">
            {automations.map((automation) => (
              <AutomationCard key={automation.id} automation={automation} />
            ))}
          </div>
        )}
      </section>

      {/* Nota informativa */}
      <SurfaceCard className="bg-surface-subtle shadow-none">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Brain className="h-3 w-3 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold text-foreground">
              Esta sección configura comportamiento, no ejecuta flujos
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Los ajustes realizados aquí serán consultados por los módulos operativos de
              SellUp (Pipeline, Cuentas, agentes de IA) cuando estén disponibles.
              Cambiar el modo a{' '}
              <strong>Automático</strong> no ejecuta nada todavía — prepara la
              configuración para cuando los flujos reales sean implementados.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
