import { DataTablePage } from '@/components/shared/data-table-page';
import { getSourceCatalogViewModel } from '@/modules/source-catalog/queries';
import { getLatestConnectionTestsBySource } from '@/modules/source-catalog/history-queries';
import { getSocrataPreviewBatches } from '@/modules/source-catalog/socrata-batches-queries';
import { SourceCatalogClient } from './source-catalog-client';

export const metadata = {
  title: 'Catálogo de fuentes — Configuración',
};

export default async function SourceCatalogPage() {
  const viewModel = getSourceCatalogViewModel();
  const [latestTests, socrataBatches] = await Promise.all([
    getLatestConnectionTestsBySource(),
    getSocrataPreviewBatches(),
  ]);
  const { metrics } = viewModel;

  const metricCards = [
    { label: 'Total fuentes', value: metrics.total, highlight: false },
    { label: 'Verificadas', value: metrics.byOperationalStatus['operational_verified'] ?? 0, highlight: true, color: 'emerald' },
    { label: 'Requieren conexión', value: metrics.byOperationalStatus['connection_required'] ?? 0, highlight: false, color: 'amber' },
    { label: 'Pendientes validación', value: metrics.byOperationalStatus['pending_validation'] ?? 0, highlight: false, color: 'brand' },
    { label: 'Solo señal manual', value: metrics.byOperationalStatus['manual_signal_only'] ?? 0, highlight: false, color: 'muted' },
    { label: 'Solo validación', value: metrics.byOperationalStatus['validation_only'] ?? 0, highlight: false, color: 'muted' },
  ];

  return (
    <DataTablePage
      title="Catálogo de fuentes"
      description="Consulta el estado, cobertura y prioridad de las fuentes de datos usadas por SellUp para discovery, inventario, validación y señales comerciales."
      backHref="/settings"
      metrics={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {metricCards.map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-border/50 bg-card p-4 space-y-1"
            >
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {card.value}
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight">{card.label}</p>
            </div>
          ))}
        </div>
      }
    >
      <SourceCatalogClient
        viewModel={viewModel}
        latestTests={latestTests}
        socrataBatches={socrataBatches}
      />
    </DataTablePage>
  );
}
