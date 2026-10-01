'use client';

/**
 * Las piezas de la REVISIÓN HUMANA de un candidato (Agente 2A): la barra de
 * acciones del pie, el aviso duradero de duplicado, el paso final del cuerpo
 * (motivo de rechazo, override de identidad o el aviso de qué pasa al aprobar)
 * y la decisión sobre un duplicado recién detectado.
 *
 * Solo presentación: el estado y las reglas llegan de
 * `useCandidateReviewDecision`. Los textos son, al pie de la letra, los que
 * tenía el drawer.
 */

import * as React from 'react';
import { AlertTriangle, Ban, Check, Loader2, X } from '@/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldLabel } from '@/components/forms/field';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DrawerSection } from '@/components/shared/drawer-section';
import type { ExistingContactMergeOffer } from '@/modules/contact-enrichment/candidate-review-core';
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';
import { REJECTION_REASONS } from './contact-candidate-detail-format';
import type { CandidateReviewDecision } from './use-candidate-review-decision';

/**
 * Trae a la vista el paso que acaba de aparecer. El motivo de rechazo y el
 * override de identidad se abren desde la barra del pie, y el cuerpo del drawer
 * puede estar desplazado: sin esto el paso nacía fuera de pantalla.
 */
function useRevealOnMount<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, []);
  return ref;
}

// ── Barra de acciones del pie ────────────────────────────────────────────────

interface CandidateReviewActionsProps {
  candidate: PendingContactCandidate;
  review: CandidateReviewDecision;
  /** `identity_consistency === 'mismatch'`: aprobar exige el paso de override. */
  isIdentityMismatch: boolean;
  /**
   * Copy que explica por qué aprobar está bloqueado (una revelación de teléfono
   * sigue viva). `null` cuando nada lo bloquea. Lo decide el drawer.
   */
  approveBlockedCopy: string | null;
}

/**
 * Aprobar / Rechazar y sus dos pasos de confirmación. Una barra a la vez: la
 * normal, la del rechazo o la del override de identidad.
 */
export function CandidateReviewActions({
  candidate,
  review,
  isIdentityMismatch,
  approveBlockedCopy,
}: CandidateReviewActionsProps) {
  const { busy } = review;

  if (review.showIdentityOverride) {
    return (
      <>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          Confirma que revisaste la discrepancia e indica el motivo para aprobar.
        </p>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={review.cancelIdentityOverride}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              busy || !review.overrideAcknowledged || review.overrideReason.trim().length === 0
            }
            onClick={review.handleConfirmIdentityOverride}
          >
            {review.approving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Aprobando…
              </>
            ) : (
              'Aprobar de todas formas'
            )}
          </Button>
        </div>
      </>
    );
  }

  if (review.showRejectForm) {
    return (
      <>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          Indica el motivo del rechazo.
        </p>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => review.setShowRejectForm(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={review.handleReject}
          >
            {review.rejecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Rechazando…
              </>
            ) : (
              <>
                <X className="h-4 w-4" />
                Confirmar rechazo
              </>
            )}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
        {approveBlockedCopy
          ? approveBlockedCopy
          : candidate.account_id
            ? 'Al aprobar se creará un contacto oficial en SellUp.'
            : candidate.hubspot_company_id
              ? 'Al aprobar, SellUp creará o vinculará la cuenta automáticamente.'
              : 'Sin cuenta SellUp asociada: no se puede aprobar.'}
      </p>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => review.setShowRejectForm(true)}
        >
          <Ban className="h-4 w-4" />
          Rechazar
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={
            busy ||
            (!candidate.account_id && !candidate.hubspot_company_id) ||
            // Waterfall en curso: aprobar ahora crearía el contacto oficial
            // sin el teléfono que se está pagando por conseguir.
            approveBlockedCopy !== null
          }
          onClick={() =>
            isIdentityMismatch ? review.openIdentityOverride() : review.handleApprove()
          }
        >
          {review.approving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Aprobando…
            </>
          ) : isIdentityMismatch ? (
            <>
              <AlertTriangle className="h-4 w-4" />
              Revisar y aprobar de todas formas
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Aprobar candidato
            </>
          )}
        </Button>
      </div>
    </>
  );
}

// ── Aviso duradero de duplicado ──────────────────────────────────────────────

interface CandidateDuplicateNoticeProps {
  /** La oferta que el SERVIDOR resolvió al abrir el candidato; `null` si no hay. */
  mergeOffer: ExistingContactMergeOffer | null;
  merging: boolean;
  onMerge: (contactId: string | undefined) => void;
}

/**
 * 4O-H3-B-R1 — aviso DURADERO de duplicado.
 *
 * Vive en el cuerpo del drawer, no en un diálogo, y por eso sigue ahí después de
 * cerrar, refrescar o navegar. Con una identidad exacta confirmada por el
 * servidor ofrece la fusión; sin ella lo dice con claridad y NO ofrece ningún
 * CTA. No expone internals: ni ids, ni nombres de columnas, ni evidencia cruda.
 */
export function CandidateDuplicateNotice({
  mergeOffer,
  merging,
  onMerge,
}: CandidateDuplicateNoticeProps) {
  return (
    <Alert variant="info" role="note">
      <AlertTitle className="text-sm text-foreground">
        Este candidato coincide con un contacto existente.
      </AlertTitle>
      {mergeOffer?.offered ? (
        <>
          <AlertDescription className="text-xs leading-relaxed">
            {mergeOffer.signal === 'email'
              ? 'Tiene el mismo correo electrónico que un contacto que ya está en SellUp.'
              : 'Tiene el mismo perfil de LinkedIn que un contacto que ya está en SellUp.'}{' '}
            Puedes agregarle la información de este candidato. No se reemplaza nada de lo que
            ya tiene: su teléfono principal y los datos cargados a mano se conservan tal como
            están.
          </AlertDescription>
          <div className="pt-1.5">
            <Button
              type="button"
              size="sm"
              disabled={merging}
              onClick={() => onMerge(mergeOffer.offered ? mergeOffer.contactId : undefined)}
            >
              {merging ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Agregando…
                </>
              ) : (
                'Agregar información al contacto existente'
              )}
            </Button>
          </div>
        </>
      ) : (
        <AlertDescription className="text-xs leading-relaxed">
          No podemos confirmar que sea la misma persona con suficiente certeza, así que no
          ofrecemos asociarlo automáticamente. Queda registrado como duplicado para que puedas
          revisarlo cuando quieras.
        </AlertDescription>
      )}
    </Alert>
  );
}

// ── Paso final del cuerpo ────────────────────────────────────────────────────

interface CandidateReviewStepProps {
  candidate: PendingContactCandidate;
  review: CandidateReviewDecision;
}

/**
 * 5. Revisión humana (Hito 17A.4B). Lo que cierra el cuerpo del drawer:
 *
 *   * el override de identidad (Hito 17B.4W.8), cuando aprobar lo exige;
 *   * el motivo de rechazo, cuando se pidió rechazar;
 *   * y, en reposo, el aviso de qué va a pasar al aprobar.
 */
export function CandidateReviewStep({ candidate, review }: CandidateReviewStepProps) {
  if (review.showIdentityOverride) {
    return <IdentityOverrideStep review={review} />;
  }

  if (review.showRejectForm) {
    return <RejectReasonStep review={review} />;
  }

  if (!candidate.account_id && candidate.hubspot_company_id) {
    return (
      <Alert variant="info" role="note">
        <AlertTitle className="text-sm text-foreground">Empresa vinculada vía HubSpot</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          Al aprobar, SellUp creará o vinculará la cuenta automáticamente y asociará este
          contacto. No se realizarán acciones hasta hacer clic en Aprobar.
        </AlertDescription>
      </Alert>
    );
  }

  if (!candidate.account_id) {
    return (
      <Alert variant="warning" role="note">
        <AlertTitle className="text-sm text-foreground">Sin cuenta SellUp asociada</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          No se puede aprobar porque la empresa no existe en SellUp ni está vinculada a HubSpot.
          Puedes rechazarlo indicando un motivo.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert role="note">
      <AlertTitle className="text-sm">Revisión humana</AlertTitle>
      <AlertDescription className="text-xs leading-relaxed">
        Aprueba para crear el contacto oficial en SellUp, o recházalo indicando un motivo.
      </AlertDescription>
    </Alert>
  );
}

function RejectReasonStep({ review }: { review: CandidateReviewDecision }) {
  const ref = useRevealOnMount<HTMLDivElement>();

  return (
    <div ref={ref}>
      <DrawerSection
        icon={Ban}
        tone="negative"
        title="Motivo de rechazo"
        hint="Quedará registrado en la trazabilidad del candidato."
      >
        <div className="space-y-3">
          <Select
            value={review.reason}
            onValueChange={(v) => review.setReason(v ?? REJECTION_REASONS[0])}
          >
            <SelectTrigger className="w-full" aria-label="Motivo de rechazo">
              <SelectValue placeholder="Selecciona un motivo" />
            </SelectTrigger>
            <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
              {REJECTION_REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {review.reason === 'Otro' && (
            <Textarea
              value={review.otherComment}
              onChange={(e) => review.setOtherComment(e.target.value)}
              rows={3}
              aria-label="Comentario del rechazo"
              placeholder="Comentario opcional…"
            />
          )}
        </div>
      </DrawerSection>
    </div>
  );
}

/**
 * Override de discrepancia de identidad (Hito 17B.4W.8), como PASO dentro del
 * drawer. Antes era un modal apilado sobre el panel; el contenido, la regla
 * (casilla + motivo obligatorios) y los textos son los mismos. Confirmar y
 * cancelar viven en la barra del pie, igual que en el rechazo.
 */
function IdentityOverrideStep({ review }: { review: CandidateReviewDecision }) {
  const ref = useRevealOnMount<HTMLDivElement>();

  return (
    <div ref={ref}>
      <DrawerSection
        icon={AlertTriangle}
        tone="warning"
        title="Revisar discrepancia de identidad"
        hint="La identidad encontrada inicialmente y la identidad devuelta por el enriquecimiento no coinciden completamente. Esto no demuestra que el correo sea incorrecto, pero debes revisar la información antes de crear el contacto."
      >
        <div className="space-y-4">
          <FieldLabel className="flex items-start gap-2.5 font-normal">
            <Checkbox
              checked={review.overrideAcknowledged}
              onCheckedChange={(v) => review.changeOverrideAcknowledged(v === true)}
              disabled={review.busy}
              className="mt-0.5"
            />
            <span className="text-foreground">
              He revisado la discrepancia de identidad y decido continuar.
            </span>
          </FieldLabel>
          <Field
            label="Motivo de aprobación"
            error={review.overrideValidationError ?? undefined}
          >
            <Textarea
              value={review.overrideReason}
              onChange={(e) => review.changeOverrideReason(e.target.value)}
              rows={3}
              placeholder="Describe brevemente qué verificaste antes de continuar."
              disabled={review.busy}
            />
          </Field>
        </div>
      </DrawerSection>
    </div>
  );
}

// ── Decisión sobre un duplicado recién detectado ─────────────────────────────

/**
 * AGENT2A-PHONE-REVEAL-4O-H3-B — decisión humana sobre un duplicado con identidad exacta.
 *
 * Sólo se abre cuando el SERVIDOR confirmó que el contacto existente es la misma persona
 * por email o LinkedIn exactos; con identidad ambigua, por nombre o sin señal exacta, este
 * diálogo no aparece y el flujo es el de siempre. No muestra internals: ni ids, ni el
 * nombre de la columna, ni la evidencia cruda.
 *
 * Es un `ConfirmDialog` (diálogo de alerta): exige una de las dos respuestas, sin X ni
 * cierre por clic afuera. Salir con Escape equivale a «Descartar como duplicado», que no
 * escribe nada.
 */
export function CandidateDuplicateDecisionDialog({
  review,
}: {
  review: CandidateReviewDecision;
}) {
  const { duplicateDecision, mergingIntoExisting } = review;

  return (
    <ConfirmDialog
      open={duplicateDecision !== null}
      onOpenChange={(v) => {
        if (mergingIntoExisting) return;
        if (!v) review.handleDiscardDuplicate();
      }}
      title="Candidato duplicado"
      description={
        <>
          Este candidato coincide con un contacto que ya existe en SellUp
          {duplicateDecision?.signal === 'email'
            ? ', con el mismo correo electrónico.'
            : ', con el mismo perfil de LinkedIn.'}
        </>
      }
      cancelLabel="Descartar como duplicado"
      confirmLabel="Agregar información al contacto existente"
      loading={mergingIntoExisting}
      onConfirm={() => void review.handleMergeIntoExistingContact()}
      className="sm:max-w-md"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Puedes agregarle la información de este candidato al contacto existente. No se reemplaza
        nada de lo que ya tiene: su teléfono principal y los datos cargados a mano se conservan
        tal como están.
      </p>
    </ConfirmDialog>
  );
}
