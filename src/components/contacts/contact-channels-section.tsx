'use client';

/**
 * «Cómo contactarle» del contacto OFICIAL: correo, teléfonos, LinkedIn y todo lo que se puede
 * revelar o verificar desde la ficha (AGENT2A-CONTACT-PAGE-ACTIONS, Bryan 19-11).
 *
 * UNA sola pieza para el panel lateral (`contact-detail-sheet.tsx`) y la página
 * `/contacts/[contactId]`: lo que se arregla en uno aparece en el otro. Antes la página era de
 * sólo lectura y no ofrecía revelar nada.
 *
 * Presentacional + los controles de siempre: QUÉ se ofrece lo decide el servidor
 * (`getOfficialContactChannelRevealOfferAction`, la oferta de «Revelar teléfono», …). Tras cada
 * acción se avisa al dueño (`onChanged`) para que relea la ficha por su vía normal: el panel
 * vuelve a leer el contacto; la página hace `router.refresh()`.
 *
 * Variantes:
 *   * `drawer` (panel): una columna y sólo lo que existe, exactamente como antes.
 *   * `page` (página): dos columnas y cada dato con su «Sin …» cuando falta.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { ClipboardCheck, Link2, Loader2, Mail, Phone } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  openOfficialContactReviewAction,
  type OfficialContactReviewSheetFlags,
} from '@/modules/contact-enrichment/official-contact-review-actions';
import { OFFICIAL_CONTACT_REVIEW_COPY } from '@/modules/contact-enrichment/official-contact-review-core';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import type { Contact } from '@/modules/contacts/types';
import type { RecordCommentFieldKey } from '@/modules/record-comments/types';
import { PROVIDER_PHONE_LABEL, readProviderPhone } from '@/modules/contact-enrichment/provider-phone';
import { resolvePhoneSourceLabel } from '@/components/contact-enrichment/phone-display-labels';
import { OfficialContactStoredPhonesDisclosure } from './official-contact-stored-phones-disclosure';
import { OfficialContactPhoneRevealCta } from './post-approval-reveal-cta';
import { OfficialContactEmailCheckPanel } from './official-contact-email-check-panel';
import { OfficialContactHubSpotMergePanel } from './official-contact-hubspot-merge-panel';
import {
  OfficialContactChannelRevealControl,
  useOfficialContactChannelReveal,
} from './official-contact-channel-reveal';

// AGENT2A-CONTACT-APPROVED-REVIEW — la ficha del candidato es grande: sólo se carga al abrir «Revisión».
const ContactCandidateDetailSheet = React.lazy(() =>
  import('@/components/contact-enrichment/contact-candidate-detail-sheet').then((m) => ({
    default: m.ContactCandidateDetailSheet,
  })),
);

const INLINE_LINK =
  'rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40';
const PHONE_LINK =
  'tabular-nums hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40';

export type ContactChannelsSectionContact = Pick<
  Contact,
  'id' | 'email' | 'phone' | 'mobile_phone' | 'linkedin_url' | 'metadata' | 'updated_at'
>;

export interface ContactChannelsSectionProps {
  contact: ContactChannelsSectionContact;
  /** 4O-H4: CUÁNTOS números adicionales hay guardados (un entero; ningún número). */
  additionalPhoneCount: number;
  /** Algo cambió en el servidor: relee la ficha. */
  onChanged: () => void;
  variant?: 'drawer' | 'page';
  /** Comentarios y alertas por campo (sólo donde la ficha los ofrece). */
  renderFieldMarker?: (fieldKey: RecordCommentFieldKey, fieldValue?: string | null) => React.ReactNode;
  renderPhoneControl?: (phone: string) => React.ReactNode;
}

export function ContactChannelsSection({
  contact,
  additionalPhoneCount,
  onChanged,
  variant = 'drawer',
  renderFieldMarker,
  renderPhoneControl,
}: ContactChannelsSectionProps) {
  const page = variant === 'page';
  // AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE — «Revelar correo» / «Revelar LinkedIn». La oferta
  // se relee cada vez que la ficha cambia (`updated_at`) y, tras revelar, se relee la ficha. Al
  // ganar el LinkedIn, la oferta releída trae «Verificar correo» (correo + LinkedIn).
  const channelReveal = useOfficialContactChannelReveal(contact.id, contact.updated_at, onChanged);
  // 164: el número de Apollo / Lusha, aparte del de HubSpot (que no se reemplaza).
  const providerPhone = readProviderPhone(contact.metadata, contact.phone);
  const marker = (fieldKey: RecordCommentFieldKey, fieldValue?: string | null) =>
    renderFieldMarker ? renderFieldMarker(fieldKey, fieldValue) : null;
  const phoneControl = (phone: string) => (renderPhoneControl ? renderPhoneControl(phone) : null);

  // AGENT2A-CONTACT-APPROVED-REVIEW (Bryan 19-11) — «Revisión»: la MISMA ficha del candidato que
  // «Por revisar», sobre su candidato de origen (se crea si no tiene). Lo ve quien ve el contacto.
  const [review, setReview] = React.useState<{ candidateId: string; flags: OfficialContactReviewSheetFlags } | null>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [openingReview, setOpeningReview] = React.useState(false);
  const openReview = async () => {
    if (openingReview) return;
    setOpeningReview(true);
    try {
      const result = await openOfficialContactReviewAction({ contactId: contact.id });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setReview({ candidateId: result.candidateId, flags: result.flags });
      setReviewOpen(true);
    } catch {
      toast.error(OFFICIAL_CONTACT_REVIEW_COPY.openFailed);
    } finally {
      setOpeningReview(false);
    }
  };

  const emailOffered = channelReveal.offer?.email || channelReveal.message?.channel === 'email';
  const linkedinOffered = channelReveal.offer?.linkedin || channelReveal.message?.channel === 'linkedin';

  return (
    <>
      <DetailList columns={page ? 2 : undefined} className={page ? undefined : 'gap-y-3 sm:grid-cols-1'}>
        <DetailItem icon={Mail} label={page ? 'Correo' : 'Email'}>
          {contact.email ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              <a href={`mailto:${contact.email}`} className={`break-all ${INLINE_LINK}`}>
                {contact.email}
              </a>
              {marker('email')}
            </span>
          ) : emailOffered ? (
            <OfficialContactChannelRevealControl channel="email" state={channelReveal} />
          ) : (
            <span className="text-text-muted">
              {page ? 'Sin correo. Añádelo con «Editar».' : 'Sin email. Añádelo con «Editar contacto».'}
            </span>
          )}
        </DetailItem>

        {(contact.mobile_phone || page) && (
          <DetailItem icon={Phone} label="Celular" emptyLabel="Sin celular">
            {contact.mobile_phone ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                <a href={`tel:${contact.mobile_phone}`} className={PHONE_LINK}>
                  {contact.mobile_phone}
                </a>
                {phoneControl(contact.mobile_phone)}
              </span>
            ) : null}
          </DetailItem>
        )}

        {(contact.phone || page) && (
          <DetailItem icon={Phone} label="Teléfono" emptyLabel="Sin teléfono">
            {contact.phone ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                <a href={`tel:${contact.phone}`} className={PHONE_LINK}>
                  {contact.phone}
                </a>
                {phoneControl(contact.phone)}
              </span>
            ) : null}
          </DetailItem>
        )}

        {providerPhone && (
          <DetailItem icon={Phone} label={PROVIDER_PHONE_LABEL}>
            <span className="inline-flex flex-wrap items-center gap-2">
              <a href={`tel:${providerPhone.number}`} className={PHONE_LINK}>
                {providerPhone.number}
              </a>
              {resolvePhoneSourceLabel(providerPhone.source) ? (
                <Badge variant="neutral">{resolvePhoneSourceLabel(providerPhone.source)}</Badge>
              ) : null}
              {phoneControl(providerPhone.number)}
            </span>
          </DetailItem>
        )}

        {/*
          4O-H4 — «Ver N números más». El CTA existe SÓLO si el servidor contó extras, y los
          escalares de arriba siguen visibles exactamente como estaban: esto AÑADE una superficie
          de lectura, no reemplaza ninguna.
        */}
        {additionalPhoneCount > 0 && (
          <OfficialContactStoredPhonesDisclosure contactId={contact.id} additionalCount={additionalPhoneCount} />
        )}
        {/*
          POST-APPROVAL REVEAL — «Revelar teléfono» desde el contacto oficial, reutilizando el
          pipeline del candidato tal cual. Se pinta debajo de los escalares y no reemplaza nada.
          La AUTORIDAD de lo que se muestra es la ficha, no la respuesta del reveal: ningún
          teléfono viaja en ese resultado. Se relee por la vía normal.
        */}
        <OfficialContactPhoneRevealCta contactId={contact.id} onPhoneProjected={onChanged} />

        {contact.linkedin_url ? (
          <DetailItem icon={Link2} label="LinkedIn">
            <a
              href={contact.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className={`break-all ${INLINE_LINK}`}
            >
              {page ? contact.linkedin_url.replace(/^https?:\/\/(www\.)?/i, '') : contact.linkedin_url}
            </a>
            {marker('linkedin')}
          </DetailItem>
        ) : linkedinOffered ? (
          // Sin LinkedIn: con el correo se busca por él.
          <DetailItem icon={Link2} label="LinkedIn">
            <OfficialContactChannelRevealControl channel="linkedin" state={channelReveal} />
          </DetailItem>
        ) : page ? (
          <DetailItem icon={Link2} label="LinkedIn" emptyLabel="Sin perfil">
            {null}
          </DetailItem>
        ) : null}
      </DetailList>

      {/* AGENT2A-CONTACT-APPROVED-REVIEW — «Revisión»: revelar / verificar como en «Por revisar»
          (incluida la búsqueda de más números), cambiar la empresa y «Guardar». */}
      <div className="mt-3 flex flex-col items-start gap-1.5 border-t border-border/50 pt-3">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="gap-1.5"
          disabled={openingReview}
          onClick={() => void openReview()}
        >
          {openingReview ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
          {OFFICIAL_CONTACT_REVIEW_COPY.button}
        </Button>
        <span className="text-xs text-muted-foreground">{OFFICIAL_CONTACT_REVIEW_COPY.buttonHelper}</span>
      </div>
      {review && (
        <React.Suspense fallback={null}>
          <ContactCandidateDetailSheet
            candidateId={review.candidateId}
            open={reviewOpen}
            onClose={() => setReviewOpen(false)}
            variant="contact_review"
            reviewContactId={contact.id}
            reviewContactEmail={contact.email}
            onContactReviewSaved={onChanged}
            {...review.flags}
          />
        </React.Suspense>
      )}

      {/* AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE — dónde trabaja hoy, «Verificar correo» y el
          aviso de cambio de empresa. */}
      <OfficialContactEmailCheckPanel
        contactId={contact.id}
        currentEmail={contact.email}
        state={channelReveal}
        onChanged={onChanged}
      />
      {/* AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE — el correo correcto ya lo tiene otro
          contacto de HubSpot: fusionar (con confirmación). */}
      <OfficialContactHubSpotMergePanel
        contactId={contact.id}
        refreshKey={channelReveal.offer}
        onChanged={onChanged}
      />
    </>
  );
}
