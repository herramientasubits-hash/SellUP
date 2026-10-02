import { redirect } from 'next/navigation';
import { Bot, Zap, MousePointerClick, Lightbulb } from "@/icons";
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { IconTile, type IconTileTone } from '@/components/utility';

const MODE_LEGEND: ReadonlyArray<{
  mode: AutomationExecutionMode;
  icon: typeof Zap;
  tone: IconTileTone;
}> = [
  { mode: 'manual', icon: MousePointerClick, tone: 'neutral' },
  { mode: 'suggested', icon: Lightbulb, tone: 'primary' },
  { mode: 'automatic', icon: Zap, tone: 'positive' },
];

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
      <Alert variant="info">
        <AlertTitle>Aquí eliges cómo quieres que actúe SellUp</AlertTitle>
        <AlertDescription>
          Poner algo en <strong className="font-semibold text-foreground">Automático</strong> todavía no lanza
          ninguna acción: deja guardada tu preferencia para cuando cada automatización esté disponible.
        </AlertDescription>
      </Alert>

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
        <div className="grid gap-4 sm:grid-cols-3">
          {MODE_LEGEND.map(({ mode, icon: Icon, tone }) => (
            <div key={mode} className="flex items-start gap-3">
              <IconTile icon={<Icon />} tone={tone} size="sm" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold text-foreground">{EXECUTION_MODE_LABELS[mode]}</p>
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
