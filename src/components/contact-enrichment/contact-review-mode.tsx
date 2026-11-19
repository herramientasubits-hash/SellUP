'use client';

/**
 * «Revisión» de un contacto APROBADO dentro de la ficha del candidato
 * (AGENT2A-CONTACT-APPROVED-REVIEW, Bryan 19-11): el banner del modo, «Verificar correo» / aviso
 * de cambio de empresa del contacto y la barra inferior con «Guardar» en lugar de «Aprobar».
 *
 * Presentacional + las acciones: QUÉ cambia y cómo se aplica lo decide el servidor
 * (`previewOfficialContactReviewSaveAction`, `saveOfficialContactReviewAction`).
 */

import * as React from 'react';
import { toast } from 'sonner';
import { ClipboardCheck, Loader2, Save } from '@/icons';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  previewOfficialContactReviewSaveAction,
  saveOfficialContactReviewAction,
} from '@/modules/contact-enrichment/official-contact-review-actions';
import { OFFICIAL_CONTACT_REVIEW_COPY } from '@/modules/contact-enrichment/official-contact-review-core';
import { OfficialContactEmailCheckPanel } from '@/components/contacts/official-contact-email-check-panel';
import { useOfficialContactChannelReveal } from '@/components/contacts/official-contact-channel-reveal';

/** Banner del modo + el empleo / «Verificar correo» / aviso de cambio de empresa del contacto. */
export function ContactReviewModeBanner({
  contactId,
  contactEmail,
  refreshKey,
  onChanged,
}: {
  contactId: string;
  contactEmail: string | null;
  refreshKey: unknown;
  onChanged: () => void;
}) {
  const reveal = useOfficialContactChannelReveal(contactId, refreshKey, onChanged);
  return (
    <div className="space-y-2" data-testid="contact-review-mode">
      <Alert variant="info" role="note" className="p-3">
        <span className="flex items-start gap-2 text-xs leading-relaxed">
          <ClipboardCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {OFFICIAL_CONTACT_REVIEW_COPY.banner}
        </span>
      </Alert>
      <OfficialContactEmailCheckPanel contactId={contactId} currentEmail={contactEmail} state={reveal} onChanged={onChanged} />
    </div>
  );
}

/** Barra inferior: «Guardar» con el resumen de cambios antes de aplicar. */
export function ContactReviewSaveActions({
  contactId,
  candidateId,
  onSaved,
}: {
  contactId: string;
  candidateId: string;
  onSaved: () => void;
}) {
  const [busy, setBusy] = React.useState<'preview' | 'save' | null>(null);
  const [summary, setSummary] = React.useState<string[] | null>(null);

  const preview = async () => {
    if (busy) return;
    setBusy('preview');
    try {
      const result = await previewOfficialContactReviewSaveAction({ contactId, candidateId });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      if (!result.hasChanges && result.lines.length === 0) {
        toast.info(OFFICIAL_CONTACT_REVIEW_COPY.nothingToSave);
        return;
      }
      setSummary(result.lines);
    } catch {
      toast.error(OFFICIAL_CONTACT_REVIEW_COPY.openFailed);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (busy === 'save') return;
    setBusy('save');
    try {
      const result = await saveOfficialContactReviewAction({ contactId, candidateId, trigger: 'save' });
      setSummary(null);
      if (result.failed.length > 0) toast.warning(result.message);
      else if (result.applied.length > 0) toast.success(result.message);
      else toast.info(result.message);
      for (const note of result.notes) toast.info(note);
      onSaved();
    } catch {
      toast.error('No pudimos guardar los cambios. Vuelve a intentarlo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button type="button" size="sm" onClick={() => void preview()} disabled={busy !== null}>
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
        {busy === 'save' ? OFFICIAL_CONTACT_REVIEW_COPY.saving : OFFICIAL_CONTACT_REVIEW_COPY.save}
      </Button>
      <ConfirmDialog
        open={summary !== null}
        onOpenChange={(next) => {
          if (!next && busy !== 'save') setSummary(null);
        }}
        icon={Save}
        title={OFFICIAL_CONTACT_REVIEW_COPY.summaryTitle}
        description={OFFICIAL_CONTACT_REVIEW_COPY.summaryDescription}
        confirmLabel={busy === 'save' ? OFFICIAL_CONTACT_REVIEW_COPY.saving : OFFICIAL_CONTACT_REVIEW_COPY.save}
        loading={busy === 'save'}
        onConfirm={() => void save()}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {(summary ?? []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
}

/**
 * Bryan 19-11: cerrar la revisión NO pierde lo revelado (ya se pagó): se guarda en el contacto y
 * en HubSpot sin preguntar. Silencioso si no había nada; avisa si aplicó algo.
 */
export async function saveContactReviewOnClose(contactId: string, candidateId: string): Promise<void> {
  try {
    const result = await saveOfficialContactReviewAction({ contactId, candidateId, trigger: 'close' });
    if (result.applied.length > 0) toast.success(result.message);
    else if (result.failed.length > 0) toast.warning(result.message);
  } catch {
    // Nada que decir: lo revelado sigue en el candidato y «Revisión» lo vuelve a ofrecer.
  }
}
