/**
 * Cómo se ordena la pestaña «Primer contacto» (puro): las preparaciones de un
 * decisor, una pestaña por canal; y qué descartadas o fallidas vale la pena ver.
 */
import { FIRST_CALL_CHANNELS, type FirstCallChannel, type FirstCallPack } from '@/server/agents/first-call/types';

export interface ChannelTab {
  channel: FirstCallChannel;
  /** La más reciente primero: la primera es la que se muestra arriba. */
  packs: FirstCallPack[];
}

const newestFirst = (a: FirstCallPack, b: FirstCallPack) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

/** Una pestaña por canal con preparaciones, en el orden de siempre (Llamada, WhatsApp, Correo, LinkedIn). */
export function channelTabs(packs: readonly FirstCallPack[]): ChannelTab[] {
  return FIRST_CALL_CHANNELS.map((channel) => ({
    channel,
    packs: packs.filter((p) => p.channel === channel).sort(newestFirst),
  })).filter((tab) => tab.packs.length > 0);
}

const sameTarget = (a: FirstCallPack, b: FirstCallPack) => a.contactId === b.contactId && a.channel === b.channel;

/**
 * Las descartadas y fallidas que se muestran. Una fallida que ya tiene una
 * preparación más nueva para el mismo decisor y canal no se muestra: era el
 * intento que falló antes del bueno (Grupo Ciisa, 18-10: cuatro «Falló» viejas
 * debajo de las cuatro preparaciones que sí salieron).
 */
export function visibleClosedPacks(packs: readonly FirstCallPack[]): FirstCallPack[] {
  const usable = packs.filter((p) => p.status !== 'failed' && p.status !== 'discarded');
  return packs
    .filter((p) => p.status === 'discarded' || p.status === 'failed')
    .filter(
      (p) =>
        p.status !== 'failed' ||
        !usable.some((u) => sameTarget(u, p) && Date.parse(u.createdAt) > Date.parse(p.createdAt)),
    )
    .sort(newestFirst);
}
