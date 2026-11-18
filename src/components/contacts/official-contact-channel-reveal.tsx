'use client';

/**
 * «Revelar correo» / «Revelar LinkedIn» en la ficha del contacto OFICIAL
 * (AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE, Bryan 17-11).
 *
 * Aparece en los contactos que nacieron de un candidato de HubSpot (traídos con «Traer» o
 * aprobados desde «Primero HubSpot») cuando les falta el correo o el LinkedIn. Que se pinte NO es
 * la protección: la acción vuelve a decidir todo en el servidor. El dato no viaja en la
 * respuesta: la ficha se relee (`onRevealed`).
 */

import * as React from 'react';
import { toast } from 'sonner';
import { Link2, Mail } from '@/icons';
import { ChannelRevealControl } from '@/components/contact-enrichment/channel-reveal-control';
import {
  getOfficialContactChannelRevealOfferAction,
  revealOfficialContactChannelAction,
  type OfficialContactChannelRevealOfferView,
} from '@/modules/contact-enrichment/official-contact-identity-completion-actions';
import {
  IDENTITY_COMPLETION_COPY,
  identityCompletionMessage,
  REVEAL_EMAIL_BUTTON_LABEL,
  REVEAL_LINKEDIN_BUTTON_LABEL,
} from '@/modules/contact-enrichment/candidate-identity-completion-core';
import {
  OFFICIAL_CHANNEL_REVEAL_COPY,
  type OfficialContactChannel,
} from '@/modules/contact-enrichment/official-contact-identity-completion-core';

type Message = { channel: OfficialContactChannel; tone: 'success' | 'info' | 'error'; text: string };

/** La oferta del contacto (una lectura por contacto y por recarga de la ficha). */
export function useOfficialContactChannelReveal(contactId: string | null, refreshKey: unknown, onRevealed: () => void) {
  // Cada dato va con el contacto al que pertenece: al cambiar de contacto, lo del anterior no aplica.
  const [loaded, setLoaded] = React.useState<{ contactId: string; offer: OfficialContactChannelRevealOfferView } | null>(null);
  const [running, setRunning] = React.useState<OfficialContactChannel | null>(null);
  const [said, setSaid] = React.useState<{ contactId: string; message: Message } | null>(null);
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    getOfficialContactChannelRevealOfferAction({ contactId })
      .then((offer) => {
        if (!cancelled) setLoaded({ contactId, offer });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [contactId, refreshKey]);

  const offer = contactId && loaded?.contactId === contactId ? loaded.offer : null;
  const message = contactId && said?.contactId === contactId ? said.message : null;

  const reveal = React.useCallback(
    async (channel: OfficialContactChannel) => {
      if (!contactId || inFlight.current) return;
      inFlight.current = true;
      setRunning(channel);
      setSaid(null);
      try {
        const result = await revealOfficialContactChannelAction({ contactId, channel });
        const text =
          result.ok && result.contactUpdated
            ? channel === 'email'
              ? OFFICIAL_CHANNEL_REVEAL_COPY.emailCompleted
              : OFFICIAL_CHANNEL_REVEAL_COPY.linkedinCompleted
            : null;
        const next: Message = text
          ? { channel, tone: 'success', text }
          : result.status === 'not_offered'
            ? { channel, tone: 'info', text: 'Ya no hay nada que revelar aquí. Vuelve a abrir la ficha.' }
            : { channel, ...identityCompletionMessage(result.status, channel) };
        setSaid({ contactId, message: next });
        if (next.tone === 'success') toast.success(next.text);
        onRevealed();
      } catch {
        setSaid({ contactId, message: { channel, tone: 'error', text: IDENTITY_COMPLETION_COPY.error } });
      } finally {
        inFlight.current = false;
        setRunning(null);
      }
    },
    [contactId, onRevealed],
  );

  return { offer, running, message, reveal };
}

export function OfficialContactChannelRevealControl({
  channel,
  state,
}: {
  channel: OfficialContactChannel;
  state: ReturnType<typeof useOfficialContactChannelReveal>;
}) {
  const offered = state.offer?.[channel] === true;
  const message = state.message?.channel === channel ? state.message : null;
  if (!offered && !message) return null;
  return (
    <ChannelRevealControl
      offer={offered}
      label={channel === 'email' ? REVEAL_EMAIL_BUTTON_LABEL : REVEAL_LINKEDIN_BUTTON_LABEL}
      helper={channel === 'email' ? IDENTITY_COMPLETION_COPY.emailHelper : IDENTITY_COMPLETION_COPY.linkedinHelper}
      icon={channel === 'email' ? Mail : Link2}
      running={state.running === channel}
      disabled={state.running !== null}
      message={message}
      onReveal={() => void state.reveal(channel)}
    />
  );
}
