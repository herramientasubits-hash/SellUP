import { History } from "@/icons";
import { EmptyState } from '@/components/ui/empty-state';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { CONNECTION_TEST_STRATEGY_LABELS } from '@/modules/source-catalog/labels';
import type {
  SourceConnectionTestHistoryViewModel,
  SourceConnectionTestHistoryItem,
} from '@/modules/source-catalog/history-queries';
import { formatAppDateTime } from '@/lib/format-date';
import { ConnectionTestHistoryTable } from './connection-test-history-table';
import { ConnectionTestStatusBadge } from './connection-test-status';
import { PanelSummary, PanelSummaryItem } from './source-panel-parts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

// ─── Latest test block ────────────────────────────────────────────────────────

function LatestTestBlock({ item }: { item: SourceConnectionTestHistoryItem }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Resultado</span>
        <ConnectionTestStatusBadge status={item.status} />
      </div>

      <PanelSummary columns={3}>
        <PanelSummaryItem label="Tipo de prueba" value={CONNECTION_TEST_STRATEGY_LABELS[item.strategy]} />
        <PanelSummaryItem
          label="Código de respuesta"
          value={item.httpStatus !== null ? String(item.httpStatus) : '—'}
        />
        <PanelSummaryItem
          label="Tiempo de respuesta"
          value={item.responseTimeMs !== null ? `${item.responseTimeMs} ms` : '—'}
        />
        {item.errorCode && item.errorCode !== 'OK' && (
          <PanelSummaryItem label="Código de error" value={item.errorCode} />
        )}
        <PanelSummaryItem label="Probado por" value={dash(item.testedByEmailSnapshot)} />
        <PanelSummaryItem label="Cuándo" value={formatAppDateTime(item.checkedAt)} />
        {item.recommendation && (
          <PanelSummaryItem wide label="Recomendación" value={item.recommendation} />
        )}
      </PanelSummary>
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
