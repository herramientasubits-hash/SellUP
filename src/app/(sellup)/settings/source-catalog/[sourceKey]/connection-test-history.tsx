import { CheckCircle2, XCircle, AlertTriangle, Clock, History } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
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
import { formatAppDateTime } from '@/lib/format-date';
import { ConnectionTestHistoryTable } from './connection-test-history-table';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
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
          label="Tipo de prueba"
          value={CONNECTION_TEST_STRATEGY_LABELS[item.strategy]}
        />
        <MetaRow
          label="Código de respuesta"
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
          label="Cuándo"
          value={formatAppDateTime(item.checkedAt)}
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

// ─── Empty state ──────────────────────────────────────────────────────────────

function NoTestsState() {
  return (
    <EmptyState
      variant="plain"
      icon={History}
      title="Esta fuente aún no se ha probado"
      description="Usa «Probar conexión» para comprobar que responde. El resultado quedará guardado aquí."
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

      {/* Historial: una lista que se recorre, se ordena y se filtra */}
      {totalShown > 0 && <ConnectionTestHistoryTable items={items} />}
    </div>
  );
}
