import { formatInAppZone } from '@/lib/format-date';
import { redirect } from 'next/navigation';
import { Bot, Plug, Info, FlaskConical, DollarSign, Zap, CheckCircle2 } from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { LegacyCompatBanner } from '../legacy-compat-banner';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TableShell, Timeline, TimelineItem, type TimelineTone } from '@/components/data-display';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getUsageSummary, getRecentUsageActivity } from '@/modules/usage-tracking/actions';
import type { AgentRun, ProviderUsageLog, ResultQualityEvent } from '@/modules/usage-tracking/types';
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

function formatRelativeTime(isoDate: string): string {
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `Hace ${Math.floor(diff / 86400)} días`;
  return formatInAppZone(isoDate, { day: 'numeric', month: 'short' }, 'es-ES');
}

function formatCost(usd: number, decimals = 4): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(decimals)}`;
}

type BadgeTone = 'positive' | 'warning' | 'negative' | 'neutral' | 'brand';

const BADGE_DOT: Record<BadgeTone, string> = {
  positive: 'bg-success',
  warning: 'bg-warning',
  negative: 'bg-destructive',
  neutral: 'bg-muted-foreground',
  brand: 'bg-primary',
};

const STATUS_BADGE: Record<string, { label: string; variant: BadgeTone }> = {
  completed:      { label: 'Completado',  variant: 'positive' },
  running:        { label: 'En curso',    variant: 'brand' },
  failed:         { label: 'Error',       variant: 'negative' },
  cancelled:      { label: 'Cancelado',   variant: 'neutral' },
  pending:        { label: 'Pendiente',   variant: 'warning' },
  success:        { label: 'OK',          variant: 'positive' },
  error:          { label: 'Error',       variant: 'negative' },
  rate_limited:   { label: 'Rate limit',  variant: 'warning' },
  quota_exceeded: { label: 'Cuota',       variant: 'negative' },
  active:         { label: 'Activo',      variant: 'positive' },
  idle:           { label: 'Inactivo',    variant: 'neutral' },
  planned:        { label: 'Planificado', variant: 'warning' },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_BADGE[status] ?? { label: status, variant: 'neutral' as const };
  return (
    <Badge variant={config.variant}>
      <span className={`h-1.5 w-1.5 rounded-full ${BADGE_DOT[config.variant]}`} aria-hidden="true" />
      {config.label}
    </Badge>
  );
}

const EVENT_TYPE_VARIANT: Record<string, BadgeTone> = {
  generated:            'brand',
  normalized:           'neutral',
  duplicate_detected:   'warning',
  discarded:            'negative',
  approved:             'positive',
  converted_to_account: 'positive',
  sent_to_hubspot:      'brand',
  contact_useful:       'positive',
  contact_invalid:      'negative',
};

function EventTypeBadge({ type }: { type: string }) {
  return (
    <Badge variant={EVENT_TYPE_VARIANT[type] ?? 'neutral'}>
      {type.replace(/_/g, ' ')}
    </Badge>
  );
}

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
// Tablas — datos reales
// ============================================================

function AgentRunsTable({ runs }: { runs: AgentRun[] }) {
  return (
    <UsageTable
      title="Ejecuciones de agentes"
      description={`Últimas ${runs.length} ejecuciones`}
      count={runs.length}
      columns={['Agente', 'Estado', 'Generados', 'Aprobados', 'Costo est.', 'Hace']}
      leftAligned={2}
      emptyLabel="Sin ejecuciones de agentes todavía."
    >
      {runs.map((run) => (
        <TableRow key={run.id}>
          <TableCell className="font-medium text-foreground">{run.agent_name ?? run.agent_key}</TableCell>
          <TableCell><StatusBadge status={run.status} /></TableCell>
          <TableCell className="text-right text-muted-foreground">{run.results_generated}</TableCell>
          <TableCell className="text-right text-muted-foreground">{run.results_approved}</TableCell>
          <TableCell className="text-right font-mono text-muted-foreground">{formatCost(Number(run.estimated_cost_usd), 2)}</TableCell>
          <TableCell className="text-right text-muted-foreground">{run.created_at ? formatRelativeTime(run.created_at) : '—'}</TableCell>
        </TableRow>
      ))}
    </UsageTable>
  );
}

function ProviderLogsTable({ logs }: { logs: ProviderUsageLog[] }) {
  return (
    <UsageTable
      title="Llamadas a proveedores"
      description={`Últimas ${logs.length} llamadas`}
      count={logs.length}
      columns={['Proveedor', 'Operación', 'Estado', 'Resultados', 'Costo est.', 'Hace']}
      leftAligned={3}
      emptyLabel="Sin llamadas a proveedores todavía."
    >
      {logs.map((log) => (
        <TableRow key={log.id}>
          <TableCell className="font-medium capitalize text-foreground">{log.provider_key}</TableCell>
          <TableCell className="text-muted-foreground">{log.operation_key.replace(/_/g, ' ')}</TableCell>
          <TableCell><StatusBadge status={log.status} /></TableCell>
          <TableCell className="text-right text-muted-foreground">{log.results_returned}</TableCell>
          <TableCell className="text-right font-mono text-muted-foreground">
            <CostValue
              display={resolveCostDisplay({
                valueUsd: log.estimated_cost_usd ?? 0,
                costTruth: toCostTruth(log.estimated_cost_usd == null),
                formatUsd: (v) => formatCost(v, 2),
              })}
            />
          </TableCell>
          <TableCell className="text-right text-muted-foreground">{formatRelativeTime(log.created_at)}</TableCell>
        </TableRow>
      ))}
    </UsageTable>
  );
}

function QualityEventsTable({ events }: { events: ResultQualityEvent[] }) {
  return (
    <UsageTable
      title="Eventos de calidad de resultados"
      description={`Últimos ${events.length} eventos`}
      count={events.length}
      columns={['Tipo', 'Evento', 'Fuente', 'Notas', 'Hace']}
      leftAligned={4}
      emptyLabel="Sin eventos de calidad todavía."
    >
      {events.map((ev) => (
        <TableRow key={ev.id}>
          <TableCell className="text-muted-foreground capitalize">{ev.result_type}</TableCell>
          <TableCell><EventTypeBadge type={ev.event_type} /></TableCell>
          <TableCell className="text-muted-foreground">{ev.source_key ?? '—'}</TableCell>
          <TableCell className="max-w-52 truncate text-muted-foreground" title={ev.notes ?? undefined}>{ev.notes ?? '—'}</TableCell>
          <TableCell className="text-right text-muted-foreground">{formatRelativeTime(ev.created_at)}</TableCell>
        </TableRow>
      ))}
    </UsageTable>
  );
}

// ============================================================
// Tablas — datos demo (mock)
// ============================================================

function MockAgentsTable({ agents }: { agents: MockAgentStat[] }) {
  return (
    <UsageTable
      title="Efectividad por agente"
      description="Ejecuciones, costo y tasa de aprobación por agente — datos ilustrativos."
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
          <TableCell className="text-right text-muted-foreground">{a.effectivenessRate.toFixed(1)}%</TableCell>
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
      description="Llamadas, resultados útiles y costo por proveedor — datos ilustrativos."
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
          <TableCell className="text-right text-muted-foreground">{p.effectivenessRate.toFixed(1)}%</TableCell>
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
        message="Esta vista sigue disponible como base interna. La lectura operativa principal de proveedores y consumo vive en Proveedores y consumo."
        ctaLabel="Ir a Proveedores y consumo"
        ctaHref="/settings/providers?tab=consumo"
      />
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Configuración', href: '/settings' },
              'Uso, costos y efectividad',
            ]}
          />
        }
        title="Uso, costos y efectividad"
        description="Foundation operativa para monitorear ejecuciones de agentes, llamadas a proveedores y calidad de resultados."
        backHref="/settings"
        actions={isEmpty ? (
          <Badge variant="warning">
            <FlaskConical aria-hidden="true" />
            Datos demo
          </Badge>
        ) : undefined}
      />

      {/* ── Aviso contextual ─────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/10 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          {isEmpty ? (
            <>
              La BD aún no tiene ejecuciones registradas.{' '}
              <strong className="font-medium text-foreground">Los datos que ves son ilustrativos</strong>{' '}
              y desaparecerán automáticamente cuando los agentes comiencen a registrar actividad en producción.
            </>
          ) : (
            <>
              Esta vista es la <strong className="font-medium text-foreground">foundation operativa</strong>.
              Los dashboards avanzados se construirán cuando existan datos históricos suficientes.
            </>
          )}
        </p>
      </div>

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
          <MockAgentsTable agents={MOCK_AGENTS} />

          <MockProvidersTable providers={MOCK_PROVIDERS} />

          <SurfaceCard>
            <SurfaceCardHeader
              title="Actividad reciente"
              description="Últimas ejecuciones de agentes y llamadas a proveedores — datos ilustrativos."
            />
            <MockActivityTable items={MOCK_ACTIVITY} />
          </SurfaceCard>
        </div>
      )}

      {/* ── Tablas reales (cuando hay datos) ────────────────── */}
      {!isEmpty && (
        <div className="space-y-6">
          {activity.agent_runs.length > 0 && <AgentRunsTable runs={activity.agent_runs} />}
          {activity.provider_logs.length > 0 && <ProviderLogsTable logs={activity.provider_logs} />}
          {activity.quality_events.length > 0 && <QualityEventsTable events={activity.quality_events} />}
        </div>
      )}

      {/* ── Estado de configuración de precios ──────────────── */}
      <SurfaceCard className="bg-surface-subtle shadow-none">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold text-foreground">Configuración de costos por proveedor</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Los costos dependen de{' '}
              <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">provider_pricing_config</code>.{' '}
              Apollo y Lusha ya cuentan con costo estimado por crédito según los contratos vigentes.
              Otros proveedores (Anthropic, OpenAI) pueden requerir configuración adicional según el modelo activo.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
