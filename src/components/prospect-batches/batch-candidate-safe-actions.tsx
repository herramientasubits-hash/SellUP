'use client';

/**
 * batch-candidate-safe-actions.tsx — el menú de fila de la ficha del lote.
 *
 * AGENT1-CUT4-C (FULL BATCH VISIBILITY + SAFE ACTION PARITY).
 *
 * El defecto que cierra: la ficha del lote montaba `CandidateRowActions` SIN
 * los overrides seguros (`onApproveOverride` / `onDiscardOverride` /
 * `onMarkDuplicateOverride`), de modo que sus entradas llamaban directamente a
 * `approveAndConvertCandidateAction`, `discardCandidate` y
 * `markCandidateDuplicate` — la vía heredada, que no consulta `record_origin`
 * ni pasa por el gate de admin de Prospectos. Mientras la tabla sólo montaba el
 * subconjunto de `isUsefulReviewCandidate` el daño estaba acotado; hacer
 * visibles TODOS los candidatos durables sobre esa superficie la habría
 * ampliado. Por eso CUT4-C cambia las dos cosas a la vez.
 *
 * La invariante que se defiende:
 *
 *   VISIBILIDAD != ACCIONABILIDAD.
 *
 * Toda fila durable se ve. Estar visible no autoriza nada: qué entradas se
 * OFRECEN sale de `resolveRowActionAvailability`, la MISMA autoridad que usa el
 * menú de fila de Prospectos, y ninguna de ellas muta. Cada entrada abre el
 * drawer con la intención armada, donde `ProspectReviewActions` vuelve a
 * evaluar `resolveReviewDecisionView` y, si autoriza, llama a los wrappers
 * SEGUROS de servidor, que revalidan la fila contra la base.
 *
 * Este archivo por tanto:
 *  - no importa NINGUNA server action;
 *  - no define ninguna regla de elegibilidad propia;
 *  - no conoce `isUsefulReviewCandidate`.
 *
 * Si aquí apareciera una segunda política, habría dos verdades sobre quién
 * puede aprobar — que es exactamente el defecto que CUT4-C cierra.
 */

import * as React from 'react';
import { MoreHorizontal, Info, CheckCircle2, XCircle, GitMerge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { resolveRowActionAvailability } from '@/components/prospects/prospect-review-decision-utils';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';

/** Qué confirmación debe quedar armada al abrir el drawer. */
export type BatchCandidateActionIntent = 'detail' | 'approve' | 'discard' | 'duplicate';

interface BatchCandidateSafeActionsProps {
  candidate: ProspectCandidateWithReviewer;
  /** Abre el drawer del candidato con la intención indicada. NUNCA muta. */
  onOpenDetail: (
    candidate: ProspectCandidateWithReviewer,
    intent: BatchCandidateActionIntent,
  ) => void;
}

export function BatchCandidateSafeActions({
  candidate,
  onOpenDetail,
}: BatchCandidateSafeActionsProps) {
  const availability = resolveRowActionAvailability({
    status: candidate.status,
    recordOrigin: candidate.record_origin ?? null,
  });

  const hasReviewActions =
    availability.canOfferApprove ||
    availability.canOfferDiscard ||
    availability.canOfferMarkDuplicate;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label={`Acciones para ${candidate.name}`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        {/* Ver detalle está SIEMPRE: es lectura, no una acción de revisión. Es
            lo que garantiza que una fila visible pero no accionable siga siendo
            inspeccionable. */}
        <DropdownMenuItem onClick={() => onOpenDetail(candidate, 'detail')}>
          <Info className="mr-2 h-3.5 w-3.5" />
          Ver detalle
        </DropdownMenuItem>

        {hasReviewActions && <DropdownMenuSeparator />}

        {availability.canOfferApprove && (
          <DropdownMenuItem onClick={() => onOpenDetail(candidate, 'approve')}>
            <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-500" />
            Aprobar
          </DropdownMenuItem>
        )}

        {availability.canOfferDiscard && (
          <DropdownMenuItem onClick={() => onOpenDetail(candidate, 'discard')}>
            <XCircle className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
            Descartar
          </DropdownMenuItem>
        )}

        {availability.canOfferMarkDuplicate && (
          <DropdownMenuItem onClick={() => onOpenDetail(candidate, 'duplicate')}>
            <GitMerge className="mr-2 h-3.5 w-3.5 text-orange-500" />
            Marcar como duplicado
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
