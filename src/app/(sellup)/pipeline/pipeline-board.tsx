import Link from "next/link";
import { ArrowRight, LayoutDashboard } from "@/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Kanban, type KanbanColumn, type KanbanItem } from "@/components/data-display";

/**
 * Los cuatro macroestados del proceso comercial, en orden, con lo que significa
 * cada uno para quien mira el tablero.
 */
export const PIPELINE_STAGES: readonly KanbanColumn[] = [
  {
    id: "preparacion",
    title: "Preparación inicial",
    description: "Cuentas recién aprobadas, con sus datos básicos por completar.",
    tone: "default",
  },
  {
    id: "profundizar",
    title: "Listos para profundizar",
    description: "Ya tienen lo básico; toca investigarlas a fondo.",
    tone: "primary",
  },
  {
    id: "inteligencia",
    title: "Inteligencia lista",
    description: "Investigación comercial terminada y lista para usar.",
    tone: "primary",
  },
  {
    id: "contacto",
    title: "Preparados para contacto",
    description: "Con contactos y mensaje listos para el primer acercamiento.",
    tone: "positive",
  },
];

/** A dónde va quien todavía no tiene cuentas en el tablero. */
export const PROSPECTS_HREF = "/accounts?tab=prospectos";

const STAGE_DOT: Record<NonNullable<KanbanColumn["tone"]>, string> = {
  default: "bg-text-muted",
  primary: "bg-primary",
  positive: "bg-success",
  warning: "bg-warning",
  negative: "bg-destructive",
};

interface PipelineBoardProps {
  /** Las cuentas del tablero, cada una en la columna de su macroestado. */
  items: readonly KanbanItem[];
}

/**
 * PipelineBoard — el tablero del pipeline.
 *
 * Con cuentas, pinta el `Kanban` del sistema con una tarjeta por cuenta. Sin
 * cuentas no repite «vacío» en cada columna: enseña las cuatro etapas como una
 * guía de lo que significa cada una y un único estado vacío con el siguiente
 * paso.
 */
export function PipelineBoard({ items }: PipelineBoardProps) {
  if (items.length > 0) {
    return <Kanban columns={[...PIPELINE_STAGES]} items={[...items]} className="min-h-0 flex-1" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ol
        aria-label="Etapas del pipeline"
        className="grid shrink-0 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 shadow-card sm:grid-cols-2 xl:grid-cols-4"
      >
        {PIPELINE_STAGES.map((stage, index) => (
          <li
            key={stage.id}
            className="flex flex-col gap-1 bg-card px-5 py-4"
          >
            <div className="flex items-center gap-2">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${STAGE_DOT[stage.tone ?? "default"]}`} />
              <span className="text-xs font-medium tabular-nums text-text-muted">{index + 1}</span>
              <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{stage.title}</h2>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{stage.description}</p>
          </li>
        ))}
      </ol>

      <EmptyState
        className="min-h-64 flex-1"
        icon={LayoutDashboard}
        title="El pipeline aún no muestra cuentas"
        description="Esta vista está en preparación. Mientras tanto, revisa y aprueba prospectos en Empresas: ahí sigue su avance."
        action={
          <Button asChild>
            <Link href={PROSPECTS_HREF}>
              Ir a prospectos
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />
    </div>
  );
}
