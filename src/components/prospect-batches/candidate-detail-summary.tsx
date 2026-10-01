import { BarChart3, CircleDashed, Target } from "@/icons";

import { Badge } from '@/components/ui/badge';
import { DrawerSection } from '@/components/shared/drawer-section';
import { MetricCard } from '@/components/shared/metric-card';

// El resumen que abre el detalle de un prospecto.
//
// Antes eran SIEMPRE tres tarjetas —Encaje, Completitud, Estado— y sin
// evaluación dos de ellas salían con rayas («— / 100», «—»): ocupaban la
// primera pantalla para no decir nada. Ahora:
//   - con evaluación, se pinta una tarjeta por cada dato que existe;
//   - sin evaluación, un solo bloque dice por qué no la hay y qué falta para
//     poder evaluarlo.
// El estado del prospecto subió a la cabecera del panel, junto al nombre.

export interface PendingEvaluationInput {
  /** `metadata.enrichment.status` del candidato. */
  enrichmentStatus?: string | null;
  /** `commercial_fit_status` o el `fit_status` de la evaluación. */
  fitStatus?: string | null;
  /** La evidencia web trae un identificador fiscal que no coincide. */
  hasTaxIdConflict: boolean;
  hasOfficialWebsite: boolean;
  hasLinkedin: boolean;
  hasSector: boolean;
  hasSize: boolean;
}

export interface PendingEvaluation {
  /** Por qué no hay evaluación, en una frase. */
  reason: string;
  /** Los datos cuya ausencia impide (o empobrece) la evaluación. */
  missing: string[];
}

/**
 * Explica por qué un prospecto no tiene evaluación de IA y qué le falta. No
 * promete nada: solo lee lo que ya dice el propio candidato.
 */
export function describePendingEvaluation(input: PendingEvaluationInput): PendingEvaluation {
  const missing = [
    input.hasOfficialWebsite ? null : 'Sitio web oficial',
    input.hasLinkedin ? null : 'LinkedIn de la empresa',
    input.hasSector ? null : 'Sector',
    input.hasSize ? null : 'Tamaño',
  ].filter((item): item is string => item !== null);

  if (input.enrichmentStatus === 'pending') {
    return { reason: 'La información de esta empresa está en cola para completarse; la evaluación llega después.', missing };
  }
  if (input.enrichmentStatus === 'enriching' || input.enrichmentStatus === 'processing') {
    return { reason: 'Estamos completando la información de esta empresa; la evaluación llega al terminar.', missing };
  }
  if (input.enrichmentStatus === 'failed') {
    return { reason: 'No se pudo completar la información de esta empresa, así que no hay con qué evaluarla.', missing };
  }
  if (input.fitStatus === 'tax_identifier_conflict' || input.hasTaxIdConflict) {
    return {
      reason: 'La evaluación está en pausa: el identificador fiscal que aparece en la web no coincide con el de la empresa.',
      missing,
    };
  }
  if (input.fitStatus === 'insufficient_evidence') {
    return { reason: 'No hay evidencia pública confiable suficiente para evaluar el encaje.', missing };
  }
  if (missing.length > 0) {
    return { reason: 'Faltan datos públicos para que la IA pueda evaluar el encaje.', missing };
  }
  return { reason: 'Esta empresa todavía no ha pasado por la evaluación de IA.', missing };
}

interface CandidateDetailSummaryProps {
  fitScore: number | null;
  /** Completitud de datos, en %. */
  completeness: number | null;
  pendingEvaluation: PendingEvaluation;
}

/**
 * El estado del prospecto ya va en la cabecera del panel, junto al nombre: aquí
 * solo se resume lo evaluado o, si no hay nada, por qué y qué falta.
 */
export function CandidateDetailSummary({
  fitScore,
  completeness,
  pendingEvaluation,
}: CandidateDetailSummaryProps) {
  const hasFit = fitScore !== null;
  const hasCompleteness = completeness !== null;

  if (!hasFit && !hasCompleteness) {
    return (
      <DrawerSection
        title="Sin evaluación de IA todavía"
        hint={pendingEvaluation.reason}
        icon={CircleDashed}
        tone="neutral"
      >
        {pendingEvaluation.missing.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Falta para evaluar</p>
            <ul className="flex flex-wrap gap-1.5">
              {pendingEvaluation.missing.map((item) => (
                <li key={item}>
                  <Badge variant="neutral">{item}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Mientras tanto puedes revisar los datos oficiales y la validación para decidir.
          </p>
        )}
      </DrawerSection>
    );
  }

  return (
    <div className={hasFit && hasCompleteness ? 'grid grid-cols-1 gap-4 sm:grid-cols-2' : 'grid grid-cols-1 gap-4'}>
      {hasFit && (
        <MetricCard
          title="Encaje"
          description="Evaluación comercial"
          value={fitScore.toFixed(0)}
          subtitle="/ 100"
          icon={<Target className="h-4 w-4" />}
          tone={fitScore >= 75 ? 'positive' : fitScore >= 50 ? 'warning' : 'brand'}
          valueClassName={fitScore >= 75 ? 'text-success' : fitScore >= 50 ? 'text-warning' : ''}
          compact
        />
      )}
      {hasCompleteness && (
        <MetricCard
          title="Completitud"
          description="Datos esenciales"
          value={completeness}
          subtitle="%"
          icon={<BarChart3 className="h-4 w-4" />}
          tone="brand"
          compact
        />
      )}
    </div>
  );
}
