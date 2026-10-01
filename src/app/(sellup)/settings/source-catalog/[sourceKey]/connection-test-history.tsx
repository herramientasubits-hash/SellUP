import { CheckCircle2, XCircle, AlertTriangle, Clock, History } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TableShell } from '@/components/data-display';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  CONNECTION_TEST_STATUS_LABELS,
  CONNECTION_TEST_STRATEGY_LABELS,
} from '@/modules/source-catalog/labels';
import type {
  SourceConnectionTestHistoryViewModel,
  SourceConnectionTestHistoryItem,
} from '@/modules/source-catalog/history-queries';
import type { SourceConnectionTestStatus } from '@/server/source-catalog/connection-test/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string, style: 'short' | 'medium' = 'short'): string {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'short',
    timeStyle: style,
    timeZone: 'America/Bogota',
  }).format(new Date(iso));
}

function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function truncate(text: string | null, maxLen = 60): string {
  if (!text) return '—';
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

// ─── Status icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: SourceConnectionTestStatus }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
    case 'failed':
    case 'blocked':
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case 'requires_credentials':
    case 'input_required':
      return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
    case 'not_supported':
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_BADGE_VARIANT: Record<
  SourceConnectionTestStatus,
  'positive' | 'negative' | 'warning' | 'neutral'
> = {
  success: 'positive',
  failed: 'negative',
  blocked: 'negative',
  requires_credentials: 'warning',
  input_required: 'warning',
  not_supported: 'neutral',
};

function StatusBadge({ status }: { status: SourceConnectionTestStatus }) {
  return (
    <Badge variant={STATUS_BADGE_VARIANT[status]}>
      <StatusIcon status={status} />
      {CONNECTION_TEST_STATUS_LABELS[status]}
    </Badge>
  );
}

// ─── Meta row ─────────────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words text-sm tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

// ─── Latest test block ────────────────────────────────────────────────────────

function LatestTestBlock({ item }: { item: SourceConnectionTestHistoryItem }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Resultado
        </span>
        <StatusBadge status={item.status} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 sm:grid-cols-3">
        <MetaRow
          label="Estrategia"
          value={CONNECTION_TEST_STRATEGY_LABELS[item.strategy]}
        />
        <MetaRow
          label="HTTP status"
          value={item.httpStatus !== null ? String(item.httpStatus) : '—'}
        />
        <MetaRow
          label="Tiempo de respuesta"
          value={item.responseTimeMs !== null ? `${item.responseTimeMs} ms` : '—'}
        />
        {item.errorCode && item.errorCode !== 'OK' && (
          <MetaRow label="Código de error" value={item.errorCode} />
        )}
        <MetaRow
          label="Probado por"
          value={dash(item.testedByEmailSnapshot)}
        />
        <MetaRow
          label="Fecha / hora"
          value={formatDateTime(item.checkedAt, 'medium')}
        />
        {item.recommendation && (
          <div className="col-span-2 sm:col-span-3">
            <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
              Recomendación
            </dt>
            <dd className="text-sm text-muted-foreground">{item.recommendation}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ─── History table ────────────────────────────────────────────────────────────

function HistoryTable({ items }: { items: SourceConnectionTestHistoryItem[] }) {
  return (
    <table className="w-full min-w-160 text-sm">
        <thead>
          <tr className="border-b border-border/50 bg-surface-subtle">
            {[
              'Fecha',
              'Resultado',
              'Estrategia',
              'HTTP',
              'Tiempo',
              'Código',
              'Probado por',
              'Recomendación',
            ].map((col) => (
              <th
                key={col}
                scope="col"
                className="py-2.5 pr-4 text-left text-xs font-semibold text-muted-foreground"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border/50 transition-colors last:border-0 hover:bg-surface-muted">
              <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                {formatDateTime(item.checkedAt)}
              </td>
              <td className="py-2.5 pr-4">
                <StatusBadge status={item.status} />
              </td>
              <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                {CONNECTION_TEST_STRATEGY_LABELS[item.strategy]}
              </td>
              <td className="py-2.5 pr-4 font-mono text-xs tabular-nums text-foreground">
                {dash(item.httpStatus)}
              </td>
              <td className="whitespace-nowrap py-2.5 pr-4 text-xs tabular-nums text-foreground">
                {item.responseTimeMs !== null ? `${item.responseTimeMs} ms` : '—'}
              </td>
              <td className="py-2.5 pr-4 text-xs font-mono text-muted-foreground">
                {item.errorCode === 'OK' ? '—' : item.errorCode}
              </td>
              <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                {dash(item.testedByEmailSnapshot)}
              </td>
              <td className="py-2.5 text-xs text-muted-foreground" title={item.recommendation ?? undefined}>
                {truncate(item.recommendation)}
              </td>
            </tr>
          ))}
        </tbody>
    </table>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function NoTestsState() {
  return (
    <EmptyState
      variant="plain"
      icon={History}
      title="Aún no hay pruebas registradas para esta fuente."
      description="Ejecuta Probar conexión para crear el primer registro."
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  history: SourceConnectionTestHistoryViewModel;
}

export function ConnectionTestHistory({ history }: Props) {
  const { latest, items, totalShown } = history;

  return (
    <div className="space-y-4">
      {/* Latest test */}
      <SurfaceCard>
        <SurfaceCardHeader title="Última prueba de conexión" />
        {latest ? <LatestTestBlock item={latest} /> : <NoTestsState />}
      </SurfaceCard>

      {/* History table */}
      {totalShown > 0 && (
        <TableShell
          title={
            <>
              Historial reciente
              <Badge variant="neutral" className="tabular-nums">
                {totalShown} registro{totalShown !== 1 ? 's' : ''}
              </Badge>
            </>
          }
        >
          <HistoryTable items={items} />
        </TableShell>
      )}
    </div>
  );
}
