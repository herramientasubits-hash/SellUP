'use client';

/**
 * Empleo actual, «Verificar correo» y «Cambió de empresa» en la ficha del contacto OFICIAL
 * (AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11).
 *
 * Presentacional + llamadas a las acciones: QUÉ se ofrece y qué se escribe lo decide el servidor
 * (`getOfficialContactChannelRevealOfferAction`, `verifyOfficialContactEmailAction`,
 * `confirmOfficialContactCompanyChangeAction`, `keepOfficialContactAtCompanyAction`). Tras cada
 * acción se relee la ficha y la oferta.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { Building2, Loader2, ShieldCheck } from '@/icons';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  keepOfficialContactAtCompanyAction,
  verifyOfficialContactEmailAction,
} from '@/modules/contact-enrichment/official-contact-identity-completion-actions';
import { confirmOfficialContactCompanyChangeAction } from '@/modules/contact-enrichment/contact-company-change-actions';
import {
  VERIFY_EMAIL_BUTTON_LABEL,
  VERIFY_EMAIL_HELPER,
  employmentLine,
  hubspotPrimaryEmailNote,
  lastVerificationLabel,
  verificationOutcomeText,
} from '@/modules/contact-enrichment/official-contact-email-check-view';
import { IDENTITY_COMPLETION_COPY } from '@/modules/contact-enrichment/candidate-identity-completion-core';
import type { useOfficialContactChannelReveal } from './official-contact-channel-reveal';

type RevealState = ReturnType<typeof useOfficialContactChannelReveal>;
type Note = { tone: 'success' | 'info' | 'error'; text: string };

const VERIFY_FAILURE_COPY: Record<string, string> = {
  not_offered: 'Ya no hay nada que verificar aquí. Vuelve a abrir la ficha.',
  unauthorized_role: IDENTITY_COMPLETION_COPY.unauthorized,
  identity_mismatch: IDENTITY_COMPLETION_COPY.mismatch,
  provider_unavailable: IDENTITY_COMPLETION_COPY.unavailable,
  provider_error: IDENTITY_COMPLETION_COPY.error,
  contact_not_saved: 'Encontramos un correo, pero no pudimos guardarlo en el contacto. No se cambió nada en HubSpot.',
};

export function OfficialContactEmailCheckPanel({
  contactId,
  state,
  onChanged,
}: {
  contactId: string;
  state: RevealState;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState<'verify' | 'confirm' | 'keep' | null>(null);
  const [note, setNote] = React.useState<{ contactId: string; note: Note } | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const offer = state.offer;
  const emailState = offer?.emailState ?? null;
  const shownNote = note?.contactId === contactId ? note.note : null;
  const line = employmentLine(emailState?.employment ?? null);
  const pending = emailState?.pendingCompanyChange === true;
  const conflicting = emailState?.check?.case === 'conflicting';
  const company = emailState?.newCompanyName ?? null;

  const finish = React.useCallback(
    (next: Note) => {
      setNote({ contactId, note: next });
      if (next.tone === 'success') toast.success(next.text);
      state.refresh();
      onChanged();
    },
    [contactId, onChanged, state],
  );

  const verify = async () => {
    if (busy) return;
    setBusy('verify');
    try {
      const result = await verifyOfficialContactEmailAction({ contactId });
      if (result.ok && result.case) {
        const changed = result.case === 'same_company_new_email' || result.case === 'personal_email';
        finish({ tone: changed ? 'success' : 'info', text: verificationOutcomeText(result.case, result.hubspot) });
      } else {
        finish({ tone: 'error', text: VERIFY_FAILURE_COPY[result.status] ?? IDENTITY_COMPLETION_COPY.error });
      }
    } catch {
      setNote({ contactId, note: { tone: 'error', text: IDENTITY_COMPLETION_COPY.error } });
    } finally {
      setBusy(null);
    }
  };

  const confirmChange = async () => {
    if (busy) return;
    setBusy('confirm');
    try {
      const result = await confirmOfficialContactCompanyChangeAction({ contactId });
      setConfirmOpen(false);
      finish({ tone: result.ok ? 'success' : 'error', text: result.message });
    } catch {
      setNote({ contactId, note: { tone: 'error', text: 'No pudimos completar el cambio de empresa.' } });
    } finally {
      setBusy(null);
    }
  };

  const keep = async () => {
    if (busy) return;
    setBusy('keep');
    try {
      const result = await keepOfficialContactAtCompanyAction({ contactId });
      finish(
        result.ok
          ? {
              tone: 'success',
              text: result.applied
                ? `Listo: el correo que encontramos quedó como principal en SellUp y el anterior como adicional. ${hubspotPrimaryEmailNote(result.hubspot)}`
                : 'Listo: se descartó el aviso.',
            }
          : { tone: 'error', text: 'No pudimos guardar la decisión. Vuelve a abrir la ficha.' },
      );
    } catch {
      setNote({ contactId, note: { tone: 'error', text: IDENTITY_COMPLETION_COPY.error } });
    } finally {
      setBusy(null);
    }
  };

  if (!offer || (!line && !offer.verifyEmail && !pending && !shownNote)) return null;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3" data-testid="official-contact-email-check">
      {line && !pending && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" />
          {line}
        </p>
      )}

      {pending && (
        <Alert variant="warning">
          <AlertTitle>{conflicting ? 'Posible cambio de empresa, sin confirmar' : 'Cambió de empresa'}</AlertTitle>
          <AlertDescription>
            <p>
              {conflicting
                ? 'El correo y el empleo que devolvió el proveedor no cuentan la misma historia. Decide tú.'
                : (line ?? `El correo que encontramos es de ${company ?? 'otra empresa'}.`)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="xs" disabled={busy !== null} onClick={() => setConfirmOpen(true)}>
                {conflicting ? 'Sí cambió' : `Enviar a revisión en ${company ?? 'la empresa nueva'}`}
              </Button>
              <Button type="button" size="xs" variant="outline" disabled={busy !== null} onClick={() => void keep()}>
                {busy === 'keep' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Sigue aquí
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {offer.verifyEmail && !pending && (
        <span className="flex flex-col items-start gap-1.5">
          <Button type="button" variant="outline" size="xs" className="gap-1.5" disabled={busy !== null} onClick={() => void verify()}>
            {busy === 'verify' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Verificando…
              </>
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5" />
                {VERIFY_EMAIL_BUTTON_LABEL}
              </>
            )}
          </Button>
          <span className="text-xs text-muted-foreground">
            {VERIFY_EMAIL_HELPER}
            {emailState && lastVerificationLabel(emailState) ? ` ${lastVerificationLabel(emailState)}` : ''}
          </span>
        </span>
      )}

      {shownNote && (
        <span className={shownNote.tone === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {shownNote.text}
        </span>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!next && busy !== 'confirm') setConfirmOpen(false);
        }}
        variant="warning"
        icon={Building2}
        title={`Enviar a revisión en ${company ?? 'la empresa nueva'}`}
        description="Esto es lo que va a pasar:"
        confirmLabel={busy === 'confirm' ? 'Enviando…' : 'Confirmar cambio'}
        loading={busy === 'confirm'}
        onConfirm={() => void confirmChange()}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Se crea un candidato en «Por revisar» en la empresa nueva, para su responsable, con el correo nuevo sugerido.</li>
          <li>Si el contacto está en HubSpot, recibe ya el correo nuevo como principal (el actual queda como adicional) y el cargo actual.</li>
          <li>Este contacto se archiva con su información de hoy. Se puede desarchivar.</li>
          <li>Si aprueban el candidato, en HubSpot pasa a la empresa nueva (las demás empresas se desasocian). Si lo rechazan, HubSpot conserva los datos nuevos y su empresa actual.</li>
        </ul>
      </ConfirmDialog>
    </div>
  );
}
