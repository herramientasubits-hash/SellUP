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
      label: 'Automatizaciones',
      description: 'En total',
      value: summary.total,
      icon: Bot,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Automáticas',
      description: 'SellUp actúa solo',
      value: summary.automatic,
      icon: Zap,
      color: 'text-success',
      bg: 'bg-success/10',
    },
    {
      label: 'Sugeridas',
      description: 'SellUp propone, tú decides',
      value: summary.suggested,
      icon: Lightbulb,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Manuales',
      description: 'Las haces tú',
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
        description="Decide qué hace SellUp por su cuenta, qué sugiere y qué espera a que lo hagas tú."
      />

      {/* Lo primero que hay que saber: aquí se decide, todavía no se ejecuta */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <Brain className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Aquí eliges cómo quieres que actúe SellUp.</span>{' '}
          Poner algo en <strong className="font-semibold text-foreground">Automático</strong> todavía no lanza
          ninguna acción: deja guardada tu preferencia para cuando cada automatización esté disponible.
        </p>
      </div>

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
          title="Qué significa cada modo"
          description="Los tres niveles entre hacerlo tú y que SellUp lo haga solo"
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
          title="Tus automatizaciones"
          description="Elige el modo de cada una"
        />

        {automations.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="Todavía no hay automatizaciones"
            description="Cuando SellUp tenga una acción que se pueda automatizar aparecerá aquí para que elijas su modo."
          />
        ) : (
          <div className="space-y-4">
            {automations.map((automation) => (
              <AutomationCard key={automation.id} automation={automation} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
