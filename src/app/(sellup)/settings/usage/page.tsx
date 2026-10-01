import { redirect } from 'next/navigation';
import { Bot, Plug, FlaskConical, DollarSign, Zap, CheckCircle2 } from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { LegacyCompatBanner } from '../legacy-compat-banner';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  StatusBadge as SystemStatusBadge,
  TableShell,
  Timeline,
  TimelineItem,
  type StatusType,
  type TimelineTone,
} from '@/components/data-display';
import { BarList } from '@/components/charts/BarList';
import { DistributionBar } from '@/components/charts/DistributionBar';
import { DonutChart } from '@/components/charts/DonutChart';
import { EffectivenessMeter } from '../../ai-usage/effectiveness-meter';
import {
  agentRunSegments,
  mockAgentCostItems,
  mockProviderCostData,
  providerCallSegments,
} from './usage-chart-data';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getUsageSummary, getRecentUsageActivity } from '@/modules/usage-tracking/actions';
import { AgentRunsTable, ProviderLogsTable, QualityEventsTable } from './usage-activity-tables';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';
import { CostValue } from '@/components/shared/cost-value';
import {
  MOCK_SUMMARY,
  MOCK_AGENTS,
  MOCK_PROVIDERS,
  MOCK_ACTIVITY,
} from '@/modules/usage-tracking/mock-data';
import type { MockAgentStat, MockProviderStat, MockActivityItem } from '@/modules/usage-tracking/mock-data';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// ============================================================
// Helpers
// ============================================================

function formatCost(usd: number, decimals = 4): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(decimals)}`;
}

type BadgeTone = 'positive' | 'warning' | 'negative' | 'neutral' | 'brand';

const STATUS_BADGE: Record<string, { label: string; variant: BadgeTone }> = {
  completed:      { label: 'Completado',  variant: 'positive' },
  running:        { label: 'En curso',    variant: 'brand' },
  failed:         { label: 'Error',       variant: 'negative' },
  cancelled:      { label: 'Cancelado',   variant: 'neutral' },
  pending:        { label: 'Pendiente',   variant: 'warning' },
  success:        { label: 'Correcta',    variant: 'positive' },
  error:          { label: 'Error',       variant: 'negative' },
  rate_limited:   { label: 'Demasiadas seguidas', variant: 'warning' },
  quota_exceeded: { label: 'Cuota agotada', variant: 'negative' },
  active:         { label: 'Activo',      variant: 'positive' },
  idle:           { label: 'Inactivo',    variant: 'neutral' },
  planned:        { label: 'Planificado', variant: 'warning' },
};

/** El chip de estado del sistema (`StatusBadge` de Thema) para cada tono. */
const BADGE_STATUS: Record<BadgeTone, StatusType> = {
  positive: 'completed',
  warning: 'warning',
  negative: 'error',
  neutral: 'neutral',
  brand: 'info',
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_BADGE[status] ?? { label: status, variant: 'neutral' as const };
  return <SystemStatusBadge status={BADGE_STATUS[config.variant]} label={config.label} />;
}

const CHART_ROW = 'grid gap-4 lg:grid-cols-2';
const DONUT_HEIGHT = 260;
const formatRuns = (value: number) => value.toLocaleString('es-ES');

/** Tono del punto del feed según el estado de la ejecución. */
const STATUS_TIMELINE_TONE: Record<BadgeTone, TimelineTone> = {
  positive: 'positive',
  warning: 'warning',
  negative: 'negative',
  neutral: 'default',
  brand: 'primary',
};

// ============================================================
// Tablas — marco compartido
// ============================================================

function headCell(isLeft: boolean): string {
  return isLeft ? 'text-left' : 'text-right';
}

interface UsageTableProps {
  title: string;
  description: string;
  count: number;
  /** Cabeceras, y cuántas de ellas (desde la izquierda) se alinean a la izquierda. */
  columns: string[];
  leftAligned: number;
  emptyLabel: string;
  children: React.ReactNode;
}

function UsageTable({ title, description, count, columns, leftAligned, emptyLabel, children }: UsageTableProps) {
  return (
    <TableShell
      title={
        <>
          {title}
          <Badge variant="neutral" className="tabular-nums">{count}</Badge>
        </>
      }
      description={description}
      empty={count === 0}
      emptyState={<EmptyState variant="plain" title={emptyLabel} />}
    >
      <Table className="text-xs tabular-nums">
        <TableHeader>
          <TableRow>
            {columns.map((h, i) => (
              <TableHead key={h} scope="col" className={headCell(i < leftAligned)}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </TableShell>
  );
}

// ============================================================
// Tablas — datos demo (mock)
// ============================================================

function MockAgentsTable({ agents }: { agents: MockAgentStat[] }) {
  return (
    <UsageTable
      title="Efectividad por agente"
      description="Ejecuciones, costo y tasa de aprobación por agente — datos de ejemplo."
      count={agents.length}
      columns={['Agente', 'Estado', 'Ejec.', 'Generados', 'Aprobados', 'Efectividad', 'Costo est.', 'Costo / aprobado']}
      leftAligned={2}
      emptyLabel="Sin ejecuciones de agentes todavía."
    >
      {agents.map((a) => (
        <TableRow key={a.key}>
          <TableCell className="font-medium text-foreground">{a.name}</TableCell>
          <TableCell><StatusBadge status={a.status} /></TableCell>
          <TableCell className="text-right text-muted-foreground">{a.executions}</TableCell>
          <TableCell className="text-right text-muted-foreground">{a.resultsGenerated}</TableCell>
          <TableCell className="text-right font-medium text-foreground">{a.resultsApproved}</TableCell>
          <TableCell>
            <EffectivenessMeter pct={a.effectivenessRate} label={`Efectividad de ${a.name}`} />
          </TableCell>
          <TableCell className="text-right font-mono text-muted-foreground">{formatCost(a.estimatedCostUsd, 2)}</TableCell>
          <TableCell className="text-right font-mono text-muted-foreground">{formatCost(a.avgCostPerApproved)}</TableCell>
        </TableRow>
      ))}
    </UsageTable>
  );
}

function MockProvidersTable({ providers }: { providers: MockProviderStat[] }) {
  return (
    <UsageTable
      title="Efectividad por proveedor"
      description="Llamadas, resultados útiles y costo por proveedor — datos de ejemplo."
      count={providers.length}
      columns={['Proveedor', 'Operación', 'Llamadas', 'Devueltos', 'Útiles', 'Efectividad', 'Costo est.', 'Costo / útil']}
      leftAligned={2}
      emptyLabel="Sin llamadas a proveedores todavía."
    >
      {providers.map((p) => (
        <TableRow key={p.key}>
          <TableCell className="font-medium text-foreground">{p.name}</TableCell>
          <TableCell className="text-muted-foreground">{p.operation}</TableCell>
          <TableCell className="text-right text-muted-foreground">{p.calls}</TableCell>
          <TableCell className="text-right text-muted-foreground">{p.resultsReturned}</TableCell>
          <TableCell className="text-right font-medium text-foreground">{p.usefulResults}</TableCell>
          <TableCell>
            <EffectivenessMeter pct={p.effectivenessRate} label={`Efectividad de ${p.name}`} />
          </TableCell>
          <TableCell className="text-right font-mono text-muted-foreground">
            {p.estimatedCostUsd === 0 ? <span className="text-text-muted">—</span> : formatCost(p.estimatedCostUsd, 2)}
          </TableCell>
          <TableCell className="text-right font-mono text-muted-foreground">
            {p.avgCostPerUsefulResult === 0 ? <span className="text-text-muted">—</span> : formatCost(p.avgCostPerUsefulResult)}
          </TableCell>
        </TableRow>
      ))}
    </UsageTable>
  );
}

function MockActivityTable({ items }: { items: MockActivityItem[] }) {
  const typeLabel: Record<MockActivityItem['type'], string> = {
    agent: 'Agente', provider: 'Proveedor', quality: 'Calidad',
  };
  return (
    <Timeline>
      {items.map((item) => (
        <TimelineItem
          key={item.id}
          tone={STATUS_TIMELINE_TONE[STATUS_BADGE[item.status]?.variant ?? 'neutral']}
          title={item.providerOrAgent}
          time={item.relativeTime}
          description={item.operation}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="neutral">{typeLabel[item.type]}</Badge>
            <StatusBadge status={item.status} />
            <span className="font-mono tabular-nums text-muted-foreground">
              {item.estimatedCostUsd > 0 ? formatCost(item.estimatedCostUsd, 2) : '—'}
            </span>
          </div>
        </TimelineItem>
      ))}
    </Timeline>
  );
}

// ============================================================
// Page
// ============================================================

export default async function UsagePage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [summary, activity] = await Promise.all([
    getUsageSummary(),
    getRecentUsageActivity(15),
  ]);

  const isEmpty =
    activity.agent_runs.length === 0 &&
    activity.provider_logs.length === 0 &&
    activity.quality_events.length === 0;

  const mockProviderCost = mockProviderCostData(MOCK_PROVIDERS);
  const mockProviderCostBreakdown = mockProviderCost
    .map((part) => `${part.label}: ${formatCost(part.value, 2)}`)
    .join(' · ');

  const summaryCards = [
    { label: 'Ejecuciones',  value: isEmpty ? String(MOCK_SUMMARY.totalExecutions)   : String(summary.total_agent_runs),      sub: 'de agentes',           icon: Bot,          accent: 'text-foreground' },
    { label: 'En curso',     value: isEmpty ? '0'                                     : String(summary.running_agent_runs),    sub: 'agentes activos',      icon: Zap,          accent: summary.running_agent_runs > 0 ? 'text-primary' : 'text-muted-foreground' },
    { label: 'Fallidas',     value: isEmpty ? '0'                                     : String(summary.failed_agent_runs),     sub: 'con error',            icon: Bot,          accent: summary.failed_agent_runs > 0 ? 'text-destructive' : 'text-muted-foreground' },
    { label: 'Llamadas API', value: isEmpty ? String(MOCK_SUMMARY.totalProviderCalls) : String(summary.total_provider_calls), sub: 'a proveedores',        icon: Plug,         accent: 'text-foreground' },
    { label: 'Aprobados',    value: isEmpty ? String(MOCK_SUMMARY.totalApproved)      : '—',                                  sub: 'resultados aprobados', icon: CheckCircle2, accent: 'text-success' },
    {
      label: 'Costo est.',
      value: isEmpty
        ? `$${MOCK_SUMMARY.totalCostUsd.toFixed(2)}`
        : (
          <CostValue
            display={resolveCostDisplay({
              valueUsd: summary.total_estimated_cost_usd,
              costTruth: toCostTruth(summary.has_unknown_cost),
              formatUsd: (v) => formatCost(v, 2),
            })}
          />
        ),
      sub: 'USD estimados', icon: DollarSign, accent: 'text-primary',
    },
  ];

  return (
    <div className="space-y-6">
      <LegacyCompatBanner
        message="El consumo de cada proveedor se revisa ahora en Proveedores y consumo. Esta vista se conserva para ver el detalle de la actividad."
        ctaLabel="Ir a Proveedores y consumo"
        ctaHref="/settings/providers?tab=consumo"
      />
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Proveedores y consumo', href: '/settings/providers' },
              'Uso, costos y efectividad',
            ]}
          />
        }
        title="Uso, costos y efectividad"
        description="Qué hicieron los agentes, qué se consultó a los proveedores y qué pasó con cada resultado."
        actions={isEmpty ? (
          <Badge variant="warning">
            <FlaskConical aria-hidden="true" />
            Datos de ejemplo
          </Badge>
        ) : undefined}
      />

      {/* ── Aviso contextual ─────────────────────────────────── */}
      <Alert variant="info" role="note">
        <AlertDescription>
          {isEmpty ? (
            <>
              Todavía no hay actividad registrada.{' '}
              <strong className="font-medium text-foreground">Los datos que ves son de ejemplo</strong> y desaparecerán
              en cuanto los agentes empiecen a trabajar.
            </>
          ) : (
            <>
              Aquí ves <strong className="font-medium text-foreground">la actividad más reciente</strong>. Los análisis
              por periodo llegarán cuando haya suficiente historial.
            </>
          )}
        </AlertDescription>
      </Alert>

      {/* ── Summary cards ────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaryCards.map((card) => (
          <MetricCard
            key={card.label}
            title={card.label}
            description={card.sub}
            value={card.value}
            icon={<card.icon className={card.accent} aria-hidden="true" />}
          />
        ))}
      </div>

      {/* ── Tablas demo (cuando BD vacía) ───────────────────── */}
      {isEmpty && (
        <div className="space-y-6">
          <section aria-label="Gráficos de ejemplo" className={CHART_ROW}>
            <BarList
              title="Costo por agente"
              description="Costo estimado en USD, con los resultados aprobados — datos de ejemplo."
              count={MOCK_AGENTS.length}
              items={mockAgentCostItems(MOCK_AGENTS)}
              formatValue={(value) => formatCost(value, 2)}
            />
            <DonutChart
              title="De qué está hecho el costo"
              description="Reparto del costo estimado (USD) entre proveedores — datos de ejemplo."
              seriesName="Costo estimado (USD)"
              data={mockProviderCost}
              height={DONUT_HEIGHT}
              ariaLabel="Reparto del costo estimado entre proveedores, con datos de ejemplo"
              summary={`Costo estimado por proveedor (datos de ejemplo). ${mockProviderCostBreakdown}.`}
              footer={<span className="tabular-nums">{mockProviderCostBreakdown}</span>}
            />
          </section>

          <MockAgentsTable agents={MOCK_AGENTS} />

          <MockProvidersTable providers={MOCK_PROVIDERS} />

          <SurfaceCard>
            <SurfaceCardHeader
              title="Actividad reciente"
              description="Últimas ejecuciones de agentes y llamadas a proveedores — datos de ejemplo."
            />
            <MockActivityTable items={MOCK_ACTIVITY} />
          </SurfaceCard>
        </div>
      )}

      {/* ── Tablas reales (cuando hay datos) ────────────────── */}
      {!isEmpty && (
        <div className="space-y-6">
          <section aria-label="Cómo salió la actividad" className={CHART_ROW}>
            <DistributionBar
              title="Cómo van las ejecuciones"
              description="Todas las ejecuciones de agentes registradas."
              unit="ejecuciones"
              segments={agentRunSegments(summary)}
              formatValue={formatRuns}
              emptyLabel="Todavía no hay ejecuciones de agentes."
            />
            <DistributionBar
              title="Cómo salieron las consultas"
              description="Todas las consultas a proveedores registradas."
              unit="consultas"
              segments={providerCallSegments(summary)}
              formatValue={formatRuns}
              emptyLabel="Todavía no hay consultas a proveedores."
            />
          </section>

          {activity.agent_runs.length > 0 && <AgentRunsTable runs={activity.agent_runs} />}
          {activity.provider_logs.length > 0 && <ProviderLogsTable logs={activity.provider_logs} />}
          {activity.quality_events.length > 0 && <QualityEventsTable events={activity.quality_events} />}
        </div>
      )}

      {/* ── Estado de configuración de precios ──────────────── */}
      <Alert role="note">
        <AlertTitle>De dónde salen los costos</AlertTitle>
        <AlertDescription>
          Los costos son estimados a partir del precio configurado para cada proveedor. Apollo y Lusha
          ya tienen su precio por crédito según el contrato vigente; los proveedores de IA pueden
          necesitar que se configure el precio del modelo en uso.
        </AlertDescription>
      </Alert>
    </div>
  );
}
