import { DataTablePage } from '@/components/shared/data-table-page';
import { MetricCard } from '@/components/shared/metric-card';
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

  return (
    <DataTablePage
      title="Catálogo de fuentes"
      description="Consulta el estado, cobertura y prioridad de las fuentes de datos usadas por SellUp para discovery, inventario, validación y señales comerciales."
      backHref="/settings"
      metrics={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            title="Total fuentes"
            description="Fuentes registradas en el catálogo"
            value={metrics.total}
          />
          <MetricCard
            title="Verificadas"
            description="Con conexión operativa confirmada"
            value={metrics.byOperationalStatus['operational_verified'] ?? 0}
          />
          <MetricCard
            title="Requieren conexión"
            description="Pendientes de prueba de conexión"
            value={metrics.byOperationalStatus['connection_required'] ?? 0}
          />
          <MetricCard
            title="Pendientes validación"
            description="Esperando primera validación"
            value={metrics.byOperationalStatus['pending_validation'] ?? 0}
          />
          <MetricCard
            title="Solo señal manual"
            description="Sin automatización habilitada"
            value={metrics.byOperationalStatus['manual_signal_only'] ?? 0}
          />
          <MetricCard
            title="Solo validación"
            description="Operación exclusivamente manual"
            value={metrics.byOperationalStatus['validation_only'] ?? 0}
          />
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
