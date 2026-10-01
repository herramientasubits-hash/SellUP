import { XCircle, CheckCircle2, FlaskConical, Layers } from "@/icons";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPage } from '@/components/settings/settings-page';
import { MetricCard } from '@/components/shared/metric-card';
import { getSocrataPreviewBatches } from '@/modules/source-catalog/socrata-batches-queries';
import { CreateSocrataBatchButton } from './create-socrata-batch-button';
import { SocrataBatchesTable } from './socrata-batches-table';

export const metadata = {
  title: 'Lotes de datos abiertos — Catálogo de fuentes',
};

export default async function SocrataBatchesPage() {
  const { batches, totalCount, readyForReview, cancelled, smokeTests } =
    await getSocrataPreviewBatches();

  return (
    <SettingsPage
      title="Lotes de datos abiertos"
      description="Lotes de empresas candidatas traídas de registros públicos, para revisar cómo llegan antes de usarlos."
      trail={[{ label: 'Catálogo de fuentes', href: '/settings/source-catalog' }]}
      actions={<CreateSocrataBatchButton />}
    >
      {/* Qué no hace esta pantalla */}
      <Alert variant="info">
        <AlertTitle>Solo consulta</AlertTitle>
        <AlertDescription className="text-xs">
          Desde aquí no se aprueban, asignan ni descartan candidatos, y nada se envía a HubSpot. Un lote de prueba
          trae como máximo 3 candidatos.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Lotes"
          description="Creados hasta hoy"
          value={totalCount}
          icon={<Layers className="text-primary" aria-hidden="true" />}
        />
        <MetricCard
          title="Por revisar"
          description="Listos para revisión"
          value={readyForReview}
          icon={<CheckCircle2 className="text-warning" aria-hidden="true" />}
        />
        <MetricCard
          title="Cancelados"
          description="Lotes descartados"
          value={cancelled}
          icon={<XCircle className="text-muted-foreground" aria-hidden="true" />}
        />
        <MetricCard
          title="De prueba"
          description="Creados para probar la fuente"
          value={smokeTests}
          icon={<FlaskConical className="text-info" aria-hidden="true" />}
        />
      </div>

      <SocrataBatchesTable batches={batches} />
    </SettingsPage>
  );
}
