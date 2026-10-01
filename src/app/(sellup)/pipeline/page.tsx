import { PageHeader } from "@/components/shared/page-header";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import type { KanbanItem } from "@/components/data-display";
import { PipelineBoard } from "./pipeline-board";

// El tablero todavía no recibe cuentas: los macroestados del pipeline no están
// conectados a los datos. Cuando lo estén, basta con cargar aquí las cuentas y
// pasarlas como `items` (una tarjeta por cuenta, en la columna de su etapa).
const PIPELINE_ITEMS: readonly KanbanItem[] = [];

export default function PipelinePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        className="pb-2"
        title="Pipeline SellUp"
        description="El avance de tus cuentas por las cuatro etapas del proceso comercial."
      />

      <PipelineBoard items={PIPELINE_ITEMS} />

      <ModulePlaceholder
        module="Tablero de pipeline"
        description="Aún estamos conectando las cuentas aprobadas con este tablero; mientras tanto, síguelas desde Empresas."
      />
    </div>
  );
}
