'use client';

/**
 * Decisión HUMANA sobre un candidato del Agente 2A: aprobar (con o sin override
 * de identidad), rechazar con motivo y resolver un duplicado.
 *
 * Es el estado y los handlers que vivían en línea en
 * `contact-candidate-detail-sheet.tsx`, movidos sin cambiar una sola regla: el
 * servidor sigue siendo la autoridad de todas ellas y este hook sólo traduce sus
 * respuestas a estado de pantalla. NO toca el teléfono: el revelado, sus
 * créditos y su supresión siguen en el drawer.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  approveContactCandidate,
  discardContactCandidate,
  mergeContactCandidateIntoExistingContactAction,
} from '@/modules/contact-enrichment/actions';
import type { ExistingContactMergeOffer } from '@/modules/contact-enrichment/candidate-review-core';
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';
import { REJECTION_REASONS } from './contact-candidate-detail-format';

export interface CandidateDuplicateDecision {
  contactId: string;
  signal: 'email' | 'linkedin';
}

interface UseCandidateReviewDecisionInput {
  candidate: PendingContactCandidate | null;
  onClose: () => void;
}

export function useCandidateReviewDecision({
  candidate,
  onClose,
}: UseCandidateReviewDecisionInput) {
  const router = useRouter();

  // Estado de revisión humana (Hito 17A.4B)
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [showRejectForm, setShowRejectForm] = React.useState(false);
  const [reason, setReason] = React.useState<string>(REJECTION_REASONS[0]);
  const [otherComment, setOtherComment] = React.useState('');

  // Override de discrepancia de identidad (Hito 17B.4W.8) — solo aplica cuando
  // identity_consistency === 'mismatch'. El servidor sigue siendo la autoridad;
  // este estado solo controla el paso de confirmación humana, que ahora vive
  // DENTRO del drawer (antes era un modal apilado encima).
  const [showIdentityOverride, setShowIdentityOverride] = React.useState(false);
  const [overrideAcknowledged, setOverrideAcknowledged] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState('');
  const [overrideValidationError, setOverrideValidationError] = React.useState<string | null>(
    null,
  );

  // Duplicado con contacto existente (AGENT2A-PHONE-REVEAL-4O-H3-B). El veredicto no cambia —
  // el candidato pasa a `duplicate` igual que antes de este hito —, pero cuando la identidad del
  // contacto existente es exacta e inequívoca el humano puede además AGREGARLE la información en
  // vez de limitarse a descartar. Este estado sólo controla el diálogo: la decisión de si la
  // acción es siquiera ofrecible la toma el servidor, y volverá a tomarla al ejecutarla.
  const [duplicateDecision, setDuplicateDecision] =
    React.useState<CandidateDuplicateDecision | null>(null);
  const [mergingIntoExisting, setMergingIntoExisting] = React.useState(false);
  const mergeInFlightRef = React.useRef(false);

  /**
   * 4O-H3-B-R1 — la oferta DURADERA, releída del servidor cada vez que se abre un candidato ya
   * marcado como `duplicate`.
   *
   * `duplicateDecision` (arriba) sólo vive el instante posterior a la detección; si el operador
   * cerraba el drawer, la decisión desaparecía. Esta es la que sobrevive a un refresh y a navegar
   * a otra parte: el servidor vuelve a resolver la identidad con las mismas reglas exactas y la
   * UI sólo pinta lo que él autoriza.
   */
  const [durableMergeOffer, setDurableMergeOffer] =
    React.useState<ExistingContactMergeOffer | null>(null);

  const busy = approving || rejecting;

  /**
   * Descarta el estado de la decisión. SOLO estado de React, deliberadamente:
   * el drawer lo invoca durante el render al cambiar de candidato, y en esa fase
   * no se pueden tocar refs.
   */
  const resetReviewState = React.useCallback(() => {
    setApproving(false);
    setRejecting(false);
    setShowRejectForm(false);
    setReason(REJECTION_REASONS[0]);
    setOtherComment('');
    setShowIdentityOverride(false);
    setOverrideAcknowledged(false);
    setOverrideReason('');
    setOverrideValidationError(null);
    // 4O-H3-B: la decisión de duplicado pertenece al candidato que la produjo. Arrastrarla al
    // siguiente sería ofrecerle al operador fusionar a OTRA persona en el mismo contacto.
    setDuplicateDecision(null);
    setMergingIntoExisting(false);
    // 4O-H3-B-R1: por la misma razón, la oferta duradera tampoco se hereda. Se vuelve a pedir al
    // servidor para el candidato que se está abriendo.
    setDurableMergeOffer(null);
  }, []);

  async function handleApprove(identityOverride?: { acknowledged: boolean; reason: string }) {
    if (!candidate || busy) return;
    setApproving(true);
    if (identityOverride) setOverrideValidationError(null);
    try {
      const result = await approveContactCandidate(candidate.id, identityOverride);
      if (result.ok) {
        toast.success(result.message ?? 'Contacto aprobado y creado en SellUp.');
        setShowIdentityOverride(false);
        router.refresh();
        onClose();
      } else if (result.duplicate) {
        // El candidato pasó a `duplicate` y sale de revisión — eso no ha cambiado. Lo que cambia
        // (4O-H3-B) es que, si el servidor confirma que el contacto existente es la MISMA persona
        // por una señal exacta, no cerramos sin preguntar: se le muestra la decisión. Sin oferta,
        // el comportamiento es exactamente el de antes.
        if (result.mergeOffer?.offered && result.contactId) {
          setDuplicateDecision({
            contactId: result.contactId,
            signal: result.mergeOffer.signal,
          });
          router.refresh();
          return;
        }
        toast.warning(result.error ?? 'Este candidato parece estar duplicado.');
        router.refresh();
        onClose();
      } else if (result.code === 'IDENTITY_MISMATCH_REQUIRES_REVIEW') {
        // El estado en pantalla quedó obsoleto respecto al servidor (autoridad
        // real): abrimos el paso de revisión en vez de mostrar un error genérico.
        setShowIdentityOverride(true);
        toast.warning(
          result.error ??
            'Este candidato requiere revisar la discrepancia de identidad antes de aprobar.',
        );
      } else if (result.code === 'IDENTITY_OVERRIDE_REASON_REQUIRED') {
        setShowIdentityOverride(true);
        setOverrideValidationError(
          result.error ?? 'Debes confirmar que revisaste la discrepancia e indicar un motivo.',
        );
      } else {
        toast.error(result.error ?? 'No fue posible aprobar el candidato.');
      }
    } catch {
      toast.error('No fue posible aprobar el candidato.');
    } finally {
      setApproving(false);
    }
  }

  /**
   * 4O-H3-B — «Descartar como duplicado». No escribe NADA: el veredicto duplicado ya
   * terminalizó al candidato cuando se detectó. Cerrar es exactamente el comportamiento que
   * existía antes de este hito, y por eso este camino no llama a ninguna acción.
   */
  function handleDiscardDuplicate() {
    if (mergingIntoExisting) return;
    setDuplicateDecision(null);
    toast.warning('Candidato marcado como duplicado.');
    router.refresh();
    onClose();
  }

  /**
   * 4O-H3-B — «Agregar información al contacto existente». La decisión humana explícita.
   *
   * El id del contacto viaja como CONFIRMACIÓN, no como instrucción: el servidor lo revalida
   * contra el `matched_contacts_id` que él mismo escribió y la transacción lo vuelve a
   * comprobar bajo el lock. Un doble clic queda cortado aquí por el ref y, si aun así llegaran
   * dos peticiones, la transacción devuelve `already_merged` sin escribir por segunda vez.
   */
  async function handleMergeIntoExistingContact(targetContactId?: string) {
    // 4O-H3-B-R1: el destino puede venir de la decisión recién detectada (el diálogo) o de la
    // oferta DURADERA releída al reabrir un duplicado. Son dos caminos hacia la misma acción, y
    // el servidor revalida el id en los dos casos por igual.
    const contactId = targetContactId ?? duplicateDecision?.contactId;
    if (!candidate || !contactId) return;
    if (mergeInFlightRef.current) return;
    mergeInFlightRef.current = true;
    setMergingIntoExisting(true);
    try {
      const result = await mergeContactCandidateIntoExistingContactAction(
        candidate.id,
        contactId,
      );
      if (result.ok) {
        toast.success(result.message ?? 'Información agregada al contacto existente.');
        setDuplicateDecision(null);
        setDurableMergeOffer(null);
        router.refresh();
        onClose();
      } else {
        toast.error(
          result.error ?? 'No fue posible agregar la información al contacto existente.',
        );
      }
    } catch {
      toast.error('No fue posible agregar la información al contacto existente.');
    } finally {
      mergeInFlightRef.current = false;
      setMergingIntoExisting(false);
    }
  }

  /** Abre el paso de override de identidad dentro del drawer. */
  function openIdentityOverride() {
    setShowIdentityOverride(true);
  }

  /**
   * Cierra el paso de override y descarta lo escrito. Con una aprobación en
   * vuelo no hace nada: el paso no puede desaparecer bajo una petición viva.
   */
  function cancelIdentityOverride() {
    if (busy) return;
    setShowIdentityOverride(false);
    setOverrideAcknowledged(false);
    setOverrideReason('');
    setOverrideValidationError(null);
  }

  function changeOverrideAcknowledged(value: boolean) {
    setOverrideAcknowledged(value);
    setOverrideValidationError(null);
  }

  function changeOverrideReason(value: string) {
    setOverrideReason(value);
    setOverrideValidationError(null);
  }

  function handleConfirmIdentityOverride() {
    const trimmedReason = overrideReason.trim();
    if (!overrideAcknowledged || trimmedReason.length === 0) {
      setOverrideValidationError(
        'Debes confirmar que revisaste la discrepancia e indicar un motivo.',
      );
      return;
    }
    void handleApprove({ acknowledged: overrideAcknowledged, reason: trimmedReason });
  }

  async function handleReject() {
    if (!candidate || busy) return;
    const finalReason =
      reason === 'Otro' && otherComment.trim() ? `Otro: ${otherComment.trim()}` : reason;
    setRejecting(true);
    try {
      const result = await discardContactCandidate(candidate.id, finalReason);
      if (result.ok) {
        toast.success(result.message ?? 'Candidato rechazado.');
        router.refresh();
        onClose();
      } else {
        toast.error(result.error ?? 'No fue posible rechazar el candidato.');
      }
    } catch {
      toast.error('No fue posible rechazar el candidato.');
    } finally {
      setRejecting(false);
    }
  }

  return {
    approving,
    rejecting,
    busy,
    showRejectForm,
    setShowRejectForm,
    reason,
    setReason,
    otherComment,
    setOtherComment,
    showIdentityOverride,
    overrideAcknowledged,
    overrideReason,
    overrideValidationError,
    duplicateDecision,
    mergingIntoExisting,
    durableMergeOffer,
    setDurableMergeOffer,
    resetReviewState,
    handleApprove,
    handleReject,
    handleDiscardDuplicate,
    handleMergeIntoExistingContact,
    openIdentityOverride,
    cancelIdentityOverride,
    changeOverrideAcknowledged,
    changeOverrideReason,
    handleConfirmIdentityOverride,
  };
}

export type CandidateReviewDecision = ReturnType<typeof useCandidateReviewDecision>;
