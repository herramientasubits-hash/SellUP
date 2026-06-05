import { redirect } from 'next/navigation';
import { Bot, Zap, MousePointerClick, Lightbulb, Brain } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
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
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
    {
      label: 'Automáticas',
      description: 'Ejecutadas sin intervención',
      value: summary.automatic,
      icon: Zap,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Sugeridas',
      description: 'Con sugerencia de IA',
      value: summary.suggested,
      icon: Lightbulb,
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
    {
      label: 'Manuales',
      description: 'Requieren acción humana',
      value: summary.manual,
      icon: MousePointerClick,
      color: 'text-muted-foreground',
      bg: 'bg-muted/40',
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Automatizaciones"
        description="Controla cómo SellUp responde ante eventos clave del flujo comercial, definiendo qué acciones son manuales, sugeridas o automáticas."
        backHref="/settings"
      />

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summaryCards.map((card) => (
          <MetricCard
            key={card.label}
            title={card.label}
            description={card.description}
            value={card.value}
            iconPosition="top"
            icon={
              <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
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
                bg: 'bg-muted/40',
              },
              {
                mode: 'suggested' as AutomationExecutionMode,
                icon: Lightbulb,
                color: 'text-su-brand',
                bg: 'bg-su-brand-soft',
              },
              {
                mode: 'automatic' as AutomationExecutionMode,
                icon: Zap,
                color: 'text-emerald-500',
                bg: 'bg-emerald-500/10',
              },
            ] as const
          ).map(({ mode, icon: Icon, color, bg }) => (
            <div
              key={mode}
              className="flex items-start gap-3 rounded-xl border border-border/40 p-3"
            >
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-3 w-3 ${color}`} />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-foreground">
                  {EXECUTION_MODE_LABELS[mode]}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {EXECUTION_MODE_DESCRIPTIONS[mode]}
                </p>
              </div>
            </div>
          ))}
        </div>
      </SurfaceCard>

      {/* Listado de automatizaciones */}
      <div className="space-y-3">
        <SurfaceCardHeader
          title="Automatizaciones configurables"
          description="Ajusta el comportamiento de SellUp para cada evento operativo"
        />

        {automations.length === 0 ? (
          <SurfaceCard>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/40">
                <Bot className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Sin automatizaciones registradas
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Las automatizaciones aparecerán aquí cuando sean configuradas en el sistema.
                </p>
              </div>
            </div>
          </SurfaceCard>
        ) : (
          <div className="space-y-3">
            {automations.map((automation) => (
              <AutomationCard key={automation.id} automation={automation} />
            ))}
          </div>
        )}
      </div>

      {/* Nota informativa */}
      <SurfaceCard className="border-border/30 bg-muted/20">
        <div className="flex items-start gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-su-brand-soft mt-0.5">
            <Brain className="h-3 w-3 text-su-brand" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-foreground">
              Esta sección configura comportamiento, no ejecuta flujos
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
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
