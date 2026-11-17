/**
 * Lo que la «Lista de empresas» muestra de cada empresa además de sus datos
 * (dueño 17-11): contactos aprobados / por revisar / rechazados, última y
 * próxima actividad, estado comercial en HubSpot, la última búsqueda de
 * contactos y los comentarios. Puro: sin red ni base.
 *
 * «Última actividad» es la más reciente entre la de HubSpot (lo que registra el
 * vendedor: llamadas, correos, reuniones, notas) y la de SellUp (lo que hace
 * una persona o un agente sobre la empresa).
 */

import type { HubSpotAvailability } from '@/server/integrations/hubspot-free-company-policy';

/** Estado comercial de la empresa en HubSpot, en lo que le sirve al vendedor. */
export type HubSpotCommercialStatus =
  | 'customer'
  | 'open_deal'
  | 'recent_activity'
  | 'scheduled_activity'
  | 'taken'
  | 'free'
  | 'not_found'
  | 'not_linked'
  | 'unavailable';

export const HUBSPOT_COMMERCIAL_STATUS_LABELS: Readonly<Record<HubSpotCommercialStatus, string>> = {
  customer: 'Cliente',
  open_deal: 'Negocio abierto',
  recent_activity: 'Actividad reciente',
  scheduled_activity: 'Actividad agendada',
  taken: 'Con dueño',
  free: 'Libre',
  not_found: 'No encontrada en HubSpot',
  not_linked: 'No está en HubSpot',
  unavailable: 'Sin lectura de HubSpot',
};

/** Orden en el embudo: de «no la toques» a «tómala», y al final lo que no se sabe. */
export const HUBSPOT_COMMERCIAL_STATUS_ORDER: readonly HubSpotCommercialStatus[] = [
  'customer',
  'open_deal',
  'recent_activity',
  'scheduled_activity',
  'taken',
  'free',
  'not_found',
  'not_linked',
  'unavailable',
];

export type HubSpotCommercialTone = 'positive' | 'warning' | 'info' | 'neutral' | 'brand';

export const HUBSPOT_COMMERCIAL_STATUS_TONE: Readonly<Record<HubSpotCommercialStatus, HubSpotCommercialTone>> = {
  customer: 'positive',
  open_deal: 'warning',
  recent_activity: 'warning',
  scheduled_activity: 'info',
  taken: 'neutral',
  free: 'brand',
  not_found: 'neutral',
  not_linked: 'neutral',
  unavailable: 'neutral',
};

/** La regla de «empresa libre» (`hubspot-free-company-policy`) dicha como estado comercial. */
export function commercialStatusFromAvailability(availability: HubSpotAvailability): HubSpotCommercialStatus {
  if (availability.free) return 'free';
  switch (availability.reason) {
    case 'customer':
      return 'customer';
    case 'open_deal':
      return 'open_deal';
    case 'recent_sales_activity':
      return 'recent_activity';
    case 'scheduled_activity':
      return 'scheduled_activity';
    default:
      return 'taken';
  }
}

/** Lo que HubSpot dice de una empresa enlazada. */
export interface HubSpotAccountSignal {
  status: HubSpotCommercialStatus;
  /** La más reciente de «Fecha de última actividad», «último contacto» y «última actividad de venta». */
  lastActivityAt: string | null;
  /** «Fecha de la siguiente actividad» (`notes_next_activity_date`). */
  nextActivityAt: string | null;
}

/** ¿El responsable de SellUp es el dueño en HubSpot? (lectura guardada al enlazar la empresa). */
export type HubSpotOwnerCheck = 'match' | 'other_sellup_user' | 'not_in_sellup' | 'unknown';

export const HUBSPOT_OWNER_CHECK_LABELS: Readonly<Record<HubSpotOwnerCheck, string>> = {
  match: 'Coincide',
  other_sellup_user: 'Es otra persona',
  not_in_sellup: 'Sin usuario en SellUp',
  unknown: 'Sin dato',
};

/** Etiqueta corta del resultado de la última búsqueda de contactos (Agente 2). */
export const ENRICHMENT_RUN_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'En cola',
  resolving: 'Buscando',
  ready_to_enrich: 'Buscando',
  enriching: 'Buscando',
  ready_for_review: 'Para revisar',
  completed: 'Terminada',
  failed: 'Falló',
  superseded: 'Reemplazada',
};

export function enrichmentRunStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return ENRICHMENT_RUN_STATUS_LABELS[status] ?? status;
}

/** Las cifras y fechas de una empresa en la lista. */
export interface AccountListSignals {
  contactsApproved: number;
  contactsPending: number;
  contactsRejected: number;
  comments: number;
  lastEnrichmentAt: string | null;
  lastEnrichmentStatus: string | null;
  /** Lo último que pasó en SellUp: edición, contacto aprobado, búsqueda o revisión de contactos, primer contacto, comentario. */
  sellupLastActivityAt: string | null;
  hubspotLastActivityAt: string | null;
  hubspotNextActivityAt: string | null;
  hubspotStatus: HubSpotCommercialStatus;
}

export const EMPTY_ACCOUNT_LIST_SIGNALS: AccountListSignals = {
  contactsApproved: 0,
  contactsPending: 0,
  contactsRejected: 0,
  comments: 0,
  lastEnrichmentAt: null,
  lastEnrichmentStatus: null,
  sellupLastActivityAt: null,
  hubspotLastActivityAt: null,
  hubspotNextActivityAt: null,
  hubspotStatus: 'not_linked',
};

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/** La fecha ISO más reciente de las que llegan (las ilegibles o vacías no cuentan). */
export function latestIso(...values: ReadonlyArray<string | null | undefined>): string | null {
  let best: { iso: string; at: number } | null = null;
  for (const value of values) {
    const at = toTime(value);
    if (at === null || !value) continue;
    if (!best || at > best.at) best = { iso: value, at };
  }
  return best?.iso ?? null;
}

export type LastActivitySource = 'hubspot' | 'sellup';

/** La última actividad entre HubSpot y SellUp, y de dónde salió. */
export function lastActivityOf(
  signals: Pick<AccountListSignals, 'hubspotLastActivityAt' | 'sellupLastActivityAt'>,
): { at: string; source: LastActivitySource } | null {
  const hubspot = toTime(signals.hubspotLastActivityAt);
  const sellup = toTime(signals.sellupLastActivityAt);
  if (hubspot === null && sellup === null) return null;
  if (sellup === null || (hubspot !== null && hubspot >= sellup)) {
    return { at: signals.hubspotLastActivityAt!, source: 'hubspot' };
  }
  return { at: signals.sellupLastActivityAt!, source: 'sellup' };
}

/** Un candidato de contacto leído para contarlo en su empresa. */
export interface CandidateForCount {
  id: string;
  status: string;
  reviewedAt: string | null;
  /** La empresa de la corrida que lo trajo. */
  runAccountId: string | null;
  /** La empresa a la que se reasignó (manda sobre la de la corrida). */
  reassignedAccountId: string | null;
}

/** La empresa de un candidato: la reasignada, si la hay; si no, la de la corrida. */
export function candidateAccountId(candidate: CandidateForCount): string | null {
  return candidate.reassignedAccountId ?? candidate.runAccountId;
}

/** Los datos crudos de las empresas de la lista, ya leídos de la base. */
export interface AccountActivityRows {
  accounts: ReadonlyArray<{ id: string; created_at: string }>;
  contacts: ReadonlyArray<{ account_id: string; created_at: string | null }>;
  runs: ReadonlyArray<{ account_id: string; status: string; created_at: string }>;
  candidates: ReadonlyArray<CandidateForCount>;
  packs: ReadonlyArray<{ account_id: string; created_at: string | null }>;
  comments: ReadonlyArray<{ account_id: string; created_at: string | null }>;
  audit: ReadonlyArray<{ account_id: string; created_at: string | null }>;
}

/** Junta lo leído en las cifras de cada empresa (sin HubSpot). */
export function buildAccountListSignals(
  rows: AccountActivityRows,
  hubspot: ReadonlyMap<string, HubSpotAccountSignal | 'not_linked'> = new Map(),
): Record<string, AccountListSignals> {
  const out: Record<string, AccountListSignals> = {};
  const ids = new Set(rows.accounts.map((account) => account.id));
  const touch = (accountId: string | null, at: string | null | undefined) => {
    if (!accountId || !ids.has(accountId) || !at) return;
    const signals = out[accountId];
    signals.sellupLastActivityAt = latestIso(signals.sellupLastActivityAt, at);
  };

  for (const account of rows.accounts) {
    const hs = hubspot.get(account.id);
    out[account.id] = {
      ...EMPTY_ACCOUNT_LIST_SIGNALS,
      // La creación cuenta: una empresa recién aprobada tiene actividad de hoy.
      sellupLastActivityAt: account.created_at ?? null,
      hubspotStatus: hs === undefined ? 'unavailable' : hs === 'not_linked' ? 'not_linked' : hs.status,
      hubspotLastActivityAt: hs && hs !== 'not_linked' ? hs.lastActivityAt : null,
      hubspotNextActivityAt: hs && hs !== 'not_linked' ? hs.nextActivityAt : null,
    };
  }

  for (const contact of rows.contacts) {
    if (!ids.has(contact.account_id)) continue;
    out[contact.account_id].contactsApproved += 1;
    touch(contact.account_id, contact.created_at);
  }

  // Las corridas llegan de la más reciente a la más antigua: la primera por empresa manda.
  for (const run of rows.runs) {
    if (!ids.has(run.account_id)) continue;
    const signals = out[run.account_id];
    if (!signals.lastEnrichmentAt || (toTime(run.created_at) ?? 0) > (toTime(signals.lastEnrichmentAt) ?? 0)) {
      signals.lastEnrichmentAt = run.created_at;
      signals.lastEnrichmentStatus = run.status;
    }
    touch(run.account_id, run.created_at);
  }

  const seen = new Set<string>();
  for (const candidate of rows.candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const accountId = candidateAccountId(candidate);
    if (!accountId || !ids.has(accountId)) continue;
    if (candidate.status === 'pending_review') out[accountId].contactsPending += 1;
    if (candidate.status === 'discarded') out[accountId].contactsRejected += 1;
    touch(accountId, candidate.reviewedAt);
  }

  for (const pack of rows.packs) touch(pack.account_id, pack.created_at);
  for (const entry of rows.audit) touch(entry.account_id, entry.created_at);
  for (const comment of rows.comments) {
    if (!ids.has(comment.account_id)) continue;
    out[comment.account_id].comments += 1;
    touch(comment.account_id, comment.created_at);
  }

  return out;
}
