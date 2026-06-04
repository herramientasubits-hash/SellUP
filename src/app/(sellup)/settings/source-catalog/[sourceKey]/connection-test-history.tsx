import { CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { SurfaceCard } from '@/components/shared/surface-card';
import {
  CONNECTION_TEST_STATUS_LABELS,
  CONNECTION_TEST_STRATEGY_LABELS,
  connectionTestStatusBadgeClass,
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
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'failed':
    case 'blocked':
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case 'requires_credentials':
    case 'input_required':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    case 'not_supported':
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SourceConnectionTestStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${connectionTestStatusBadgeClass(status)}`}
    >
      <StatusIcon status={status} />
      {CONNECTION_TEST_STATUS_LABELS[status]}
    </span>
  );
}

// ─── Meta row ─────────────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

// ─── Latest test block ────────────────────────────────────────────────────────

function LatestTestBlock({ item }: { item: SourceConnectionTestHistoryItem }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Resultado
        </span>
        <StatusBadge status={item.status} />
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border/60">
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
                className="pb-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground last:pr-0"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border/30 last:border-0">
              <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                {formatDateTime(item.checkedAt)}
              </td>
              <td className="py-2.5 pr-4">
                <StatusBadge status={item.status} />
              </td>
              <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                {CONNECTION_TEST_STRATEGY_LABELS[item.strategy]}
              </td>
              <td className="py-2.5 pr-4 text-xs text-foreground font-mono">
                {dash(item.httpStatus)}
              </td>
              <td className="py-2.5 pr-4 text-xs text-foreground whitespace-nowrap">
                {item.responseTimeMs !== null ? `${item.responseTimeMs} ms` : '—'}
              </td>
              <td className="py-2.5 pr-4 text-xs font-mono text-muted-foreground">
                {item.errorCode === 'OK' ? '—' : item.errorCode}
              </td>
              <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                {dash(item.testedByEmailSnapshot)}
              </td>
              <td className="py-2.5 text-xs text-muted-foreground">
                {truncate(item.recommendation)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="py-6 text-center space-y-1">
      <p className="text-sm font-medium text-foreground">
        Aún no hay pruebas registradas para esta fuente.
      </p>
      <p className="text-sm text-muted-foreground">
        Ejecuta{' '}
        <span className="font-medium text-foreground">Probar conexión</span>{' '}
        para crear el primer registro.
      </p>
    </div>
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
        <h2 className="text-[0.8125rem] font-semibold text-foreground  mb-4">
          Última prueba de conexión
        </h2>
        {latest ? <LatestTestBlock item={latest} /> : <EmptyState />}
      </SurfaceCard>

      {/* History table */}
      {totalShown > 0 && (
        <SurfaceCard>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[0.8125rem] font-semibold text-foreground ">
              Historial reciente
            </h2>
            <span className="text-xs text-muted-foreground">
              {totalShown} registro{totalShown !== 1 ? 's' : ''}
            </span>
          </div>
          <HistoryTable items={items} />
        </SurfaceCard>
      )}
    </div>
  );
}
