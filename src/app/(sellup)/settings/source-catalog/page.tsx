import {
  getSourceCatalogViewModel,
  getSourceConnectionStatusOverrides,
} from '@/modules/source-catalog/queries';
import { getLatestConnectionTestsBySource } from '@/modules/source-catalog/history-queries';
import { getSocrataPreviewBatches } from '@/modules/source-catalog/socrata-batches-queries';
import { SourceCatalogClient } from './source-catalog-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Catálogo de fuentes — Configuración',
};

export default async function SourceCatalogPage() {
  const viewModel = getSourceCatalogViewModel();
  const [latestTests, socrataBatches, statusOverrides] = await Promise.all([
    getLatestConnectionTestsBySource(),
    getSocrataPreviewBatches(),
    getSourceConnectionStatusOverrides(),
  ]);

  // La cabecera, las pestañas y los filtros rápidos viven en el cliente: los
  // tres dependen de lo que se está viendo en la tabla.
  return (
    <SourceCatalogClient
      viewModel={viewModel}
      latestTests={latestTests}
      socrataBatches={socrataBatches}
      statusOverrides={statusOverrides}
    />
  );
}
