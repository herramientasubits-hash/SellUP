import { redirect } from 'next/navigation';
import { BarChart2, Bot, Plug, Star, AlertCircle, Info } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getUsageSummary, getRecentUsageActivity } from '@/modules/usage-tracking/actions';
import type { AgentRun, ProviderUsageLog, ResultQualityEvent } from '@/modules/usage-tracking/types';

// ============================================================
// Helpers de presentación
// ============================================================

function formatRelativeTime(isoDate: string): string {
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `Hace ${Math.floor(diff / 86400)} días`;
  return new Date(isoDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string; dot: string }> = {
    completed: { label: 'Completado', classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500', dot: 'bg-emerald-500' },
    running:   { label: 'En curso',   classes: 'border-su-brand/30 bg-su-brand/10 text-su-brand',         dot: 'bg-su-brand' },
    failed:    { label: 'Error',      classes: 'border-destructive/30 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
    cancelled: { label: 'Cancelado',  classes: 'border-border/40 bg-muted/30 text-muted-foreground/60',   dot: 'bg-muted-foreground/25' },
    pending:   { label: 'Pendiente',  classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',       dot: 'bg-amber-500' },
    success:      { label: 'OK',            classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500', dot: 'bg-emerald-500' },
    error:        { label: 'Error',         classes: 'border-destructive/30 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
    rate_limited: { label: 'Rate limit',    classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',       dot: 'bg-amber-500' },
    quota_exceeded: { label: 'Cuota',       classes: 'border-destructive/30 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  };

  const config = map[status] ?? {
    label: status,
    classes: 'border-border/40 bg-muted/30 text-muted-foreground/60',
    dot: 'bg-muted-foreground/25',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${config.classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    generated:           'bg-su-brand/10 text-su-brand',
    normalized:          'bg-muted/40 text-muted-foreground',
    duplicate_detected:  'bg-amber-500/10 text-amber-500',
    discarded:           'bg-destructive/10 text-destructive',
    approved:            'bg-emerald-500/10 text-emerald-500',
    converted_to_account:'bg-emerald-500/10 text-emerald-600',
    sent_to_hubspot:     'bg-su-brand/10 text-su-brand',
    contact_useful:      'bg-emerald-500/10 text-emerald-500',
    contact_invalid:     'bg-destructive/10 text-destructive',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${map[type] ?? 'bg-muted/40 text-muted-foreground'}`}>
      {type.replace(/_/g, ' ')}
    </span>
  );
}

// ============================================================
// Sub-componentes de tabla
// ============================================================

function AgentRunsTable({ runs }: { runs: AgentRun[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        Sin ejecuciones de agentes todavía.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            <th className="pb-2 text-left font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Agente</th>
            <th className="pb-2 text-left font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Estado</th>
            <th className="pb-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Generados</th>
            <th className="pb-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Aprobados</th>
            <th className="pb-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Costo est.</th>
            <th className="pb-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Hace</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {runs.map((run) => (
            <tr key={run.id} className="group">
              <td className="py-2.5 pr-4">
                <span className="font-medium text-foreground">{run.agent_name ?? run.agent_key}</span>
              </td>
              <td className="py-2.5 pr-4">
                <StatusBadge status={run.status} />
              </td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{run.results_generated}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{run.results_approved}</td>
              <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground">
                {formatCost(Number(run.estimated_cost_usd))}
              </td>
              <td className="py-2.5 text-right text-muted-foreground">
                {run.created_at ? formatRelativeTime(run.created_at) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProviderLogsTable({ logs }: { logs: ProviderUsageLog[] }) {
  if (logs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        Sin llamadas a proveedores todavía.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            <th className="pb-2 text-left font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Proveedor</th>
            <th className="pb-2 text-left font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Operación</th>
            <th className="pb-2 text-left font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Estado</th>
            <th className="pb-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Resultados</th>
            <th className="pb-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Costo est.</th>
            <th className="pb-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Hace</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {logs.map((log) => (
            <tr key={log.id}>
              <td className="py-2.5 pr-4">
                <span className="font-medium text-foreground capitalize">{log.provider_key}</span>
                {log.model && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground font-mono">{log.model}</span>
                )}
              </td>
              <td className="py-2.5 pr-4 text-muted-foreground">{log.operation_key.replace(/_/g, ' ')}</td>
              <td className="py-2.5 pr-4">
                <StatusBadge status={log.status} />
              </td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{log.results_returned}</td>
              <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground">
                {formatCost(Number(log.estimated_cost_usd))}
              </td>
              <td className="py-2.5 text-right text-muted-foreground">
                {formatRelativeTime(log.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualityEventsTable({ events }: { events: ResultQualityEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        Sin eventos de calidad todavía.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            <th className="pb-2 text-left font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Tipo</th>
            <th className="pb-2 text-left font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Evento</th>
            <th className="pb-2 text-left font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Fuente</th>
            <th className="pb-2 text-left font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Notas</th>
            <th className="pb-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Hace</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {events.map((ev) => (
            <tr key={ev.id}>
              <td className="py-2.5 pr-4 text-muted-foreground capitalize">{ev.result_type}</td>
              <td className="py-2.5 pr-4">
                <EventTypeBadge type={ev.event_type} />
              </td>
              <td className="py-2.5 pr-4 text-muted-foreground">{ev.source_key ?? '—'}</td>
              <td className="py-2.5 pr-4 text-muted-foreground max-w-[200px] truncate">{ev.notes ?? '—'}</td>
              <td className="py-2.5 text-right text-muted-foreground">
                {formatRelativeTime(ev.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

  return (
    <div className="space-y-8">
      <PageHeader
        title="Uso, costos y efectividad"
        description="Foundation operativa para monitorear ejecuciones de agentes, llamadas a proveedores y calidad de resultados."
        backHref="/settings"
      />

      {/* ── Nota informativa ─────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-xl border border-su-brand/20 bg-su-brand/5 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Esta vista es una <strong className="text-foreground font-medium">foundation operativa</strong>.
          Los dashboards avanzados de costos y efectividad se construirán cuando existan datos
          históricos suficientes generados por los agentes en producción.
        </p>
      </div>

      {/* ── Summary cards ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <SurfaceCard>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Ejecuciones
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            {summary.total_agent_runs}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">de agentes</p>
        </SurfaceCard>

        <SurfaceCard>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            En curso
          </p>
          <p className={`mt-2 text-3xl font-semibold tracking-tight ${summary.running_agent_runs > 0 ? 'text-su-brand' : 'text-muted-foreground'}`}>
            {summary.running_agent_runs}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">agentes activos</p>
        </SurfaceCard>

        <SurfaceCard>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Fallidas
          </p>
          <p className={`mt-2 text-3xl font-semibold tracking-tight ${summary.failed_agent_runs > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {summary.failed_agent_runs}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">ejecuciones con error</p>
        </SurfaceCard>

        <SurfaceCard>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Llamadas
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            {summary.total_provider_calls}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">a proveedores</p>
        </SurfaceCard>

        <SurfaceCard>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Errores API
          </p>
          <p className={`mt-2 text-3xl font-semibold tracking-tight ${summary.error_calls > 0 ? 'text-amber-500' : 'text-muted-foreground'}`}>
            {summary.error_calls}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">errores o rate limits</p>
        </SurfaceCard>

        <SurfaceCard>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Costo est.
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground font-mono text-2xl">
            {formatCost(summary.total_estimated_cost_usd)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">USD estimados</p>
        </SurfaceCard>
      </div>

      {/* ── Estado vacío ─────────────────────────────────────── */}
      {isEmpty && (
        <SurfaceCard>
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/40">
              <BarChart2 className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Todavía no hay ejecuciones registradas
              </p>
              <p className="text-xs text-muted-foreground max-w-md">
                Los datos aparecerán aquí cuando los agentes o proveedores comiencen a registrar
                actividad. Esta foundation está lista para recibir los primeros eventos del Agente 1.
              </p>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* ── Actividad reciente ───────────────────────────────── */}
      {!isEmpty && (
        <div className="space-y-6">
          {/* Ejecuciones de agentes */}
          {activity.agent_runs.length > 0 && (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Ejecuciones de agentes"
                description={`Últimas ${activity.agent_runs.length} ejecuciones`}
                actions={
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft">
                    <Bot className="h-4 w-4 text-su-brand" />
                  </div>
                }
              />
              <AgentRunsTable runs={activity.agent_runs} />
            </SurfaceCard>
          )}

          {/* Llamadas a proveedores */}
          {activity.provider_logs.length > 0 && (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Llamadas a proveedores"
                description={`Últimas ${activity.provider_logs.length} llamadas`}
                actions={
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft">
                    <Plug className="h-4 w-4 text-su-brand" />
                  </div>
                }
              />
              <ProviderLogsTable logs={activity.provider_logs} />
            </SurfaceCard>
          )}

          {/* Eventos de calidad */}
          {activity.quality_events.length > 0 && (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Eventos de calidad de resultados"
                description={`Últimos ${activity.quality_events.length} eventos`}
                actions={
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft">
                    <Star className="h-4 w-4 text-su-brand" />
                  </div>
                }
              />
              <QualityEventsTable events={activity.quality_events} />
            </SurfaceCard>
          )}
        </div>
      )}

      {/* ── Advertencia de precios sin configurar ───────────── */}
      <SurfaceCard>
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">
              Precios de proveedores sin configurar
            </p>
            <p className="text-xs text-muted-foreground">
              Los costos estimados de Apollo, Lusha y modelos de IA aparecen en{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">provider_pricing_config</code>{' '}
              con valor <strong>$0.00</strong> hasta que un administrador configure los valores
              reales según el plan y contrato vigente. Los costos mostrados arriba reflejan este estado.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
