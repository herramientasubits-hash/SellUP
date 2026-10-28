import { redirect } from 'next/navigation';
import { MetricStrip } from "@/components/shared/metric-strip";
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { PageHeader } from '@/components/shared/page-header';
import { SOURCE_CATALOG_ROUTE } from '@/config/navigation';
import { getSocrataPreviewBatches } from '@/modules/source-catalog/socrata-batches-queries';
import { CreateSocrataBatchButton } from './create-socrata-batch-button';
import { SocrataBatchesTable } from './socrata-batches-table';

export const metadata = {
  title: 'Lotes de datos abiertos — Catálogo de fuentes',
};

export default async function SocrataBatchesPage() {
  // Herramienta de datos sólo para admin (igual que el menú y las acciones de estos lotes):
  // la lectura muestra lotes de todos los usuarios.
  if (!(await isCurrentUserAdmin())) redirect(SOURCE_CATALOG_ROUTE);
  const { batches, totalCount, readyForReview, cancelled, smokeTests } =
    await getSocrataPreviewBatches();

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Lotes de datos abiertos"
        description="Lotes de empresas candidatas traídas de registros públicos, para revisar cómo llegan antes de usarlos."
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: 'Catálogo de fuentes', href: SOURCE_CATALOG_ROUTE }, 'Lotes de datos abiertos']}
          />
        }
        actions={<CreateSocrataBatchButton />}
      />
      {/* Qué no hace esta pantalla */}
      <Alert variant="info">
        <AlertTitle>Solo consulta</AlertTitle>
        <AlertDescription className="text-xs">
          Desde aquí no se aprueban, asignan ni descartan candidatos, y nada se envía a HubSpot. Un lote de prueba
          trae como máximo 3 candidatos.
        </AlertDescription>
      </Alert>

      <MetricStrip
        aria-label="Resumen de los lotes"
        items={[
          { label: "Lotes", value: totalCount, description: "Creados hasta hoy" },
          { label: "Por revisar", value: readyForReview, description: "Listos para revisión" },
          { label: "Cancelados", value: cancelled, description: "Lotes descartados" },
          { label: "De prueba", value: smokeTests, description: "Creados para probar la fuente" },
        ]}
      />

      <SocrataBatchesTable batches={batches} />
    </div>
  );
}
