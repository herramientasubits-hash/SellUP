import { LayoutDashboard } from "@/icons";
import { PageHeader } from "@/components/shared/page-header";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { Kanban, type KanbanColumn } from "@/components/data-display";

// Los cuatro macroestados del proceso comercial, como columnas del tablero
// (Thema, `data-display/Kanban`). Todavía sin cuentas: el módulo está en
// construcción y cada columna muestra su estado vacío.
const PIPELINE_COLUMNS: KanbanColumn[] = [
  { id: "preparacion", title: "Preparación inicial", tone: "default" },
  { id: "profundizar", title: "Listos para profundizar", tone: "primary" },
  { id: "inteligencia", title: "Inteligencia lista", tone: "primary" },
  { id: "contacto", title: "Preparados para contacto", tone: "positive" },
];

export default function PipelinePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline SellUp"
        description="Vista operativa del avance de cuentas en los macroestados del proceso comercial."
      />

      <Kanban
        columns={PIPELINE_COLUMNS}
        items={[]}
        emptyColumnLabel="Sin cuentas todavía"
      />

      {/* Module placeholder */}
      <ModulePlaceholder
        icon={LayoutDashboard}
        module="Pipeline SellUp — Módulo en construcción"
        description="El Pipeline será la entrada operativa principal del MVP. Aquí vivirá el avance de cuentas a través de los cuatro macroestados del proceso comercial asistido por IA."
        features={[
          { label: "Vista kanban por macroestado" },
          { label: "Tarjetas de cuenta con estado y señales" },
          { label: "Acceso directo al expediente" },
          { label: "Filtros por industria, tamaño y estado" },
          { label: "Indicadores de progreso de agentes IA" },
          { label: "Acciones rápidas por cuenta" },
        ]}
      />
    </div>
  );
}
