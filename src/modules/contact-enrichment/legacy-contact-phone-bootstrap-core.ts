// Agente 2A — El teléfono de un contacto «legacy» entra a su colección para que el número
// revelado DESPUÉS de aprobar llegue al contacto (AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE,
// Bryan 19-11). Ver la migración 169.
//
// Núcleo PURO: la base entra por `deps`. Reglas:
//   * La proyección 128/131 rechaza el contacto con `contacts.phone` lleno y la colección vacía
//     (`scalar_incumbent_unprojectable`) SIN escribir nada. En ese caso, y SÓLO en ése, el número
//     que ya tiene el contacto entra a la colección como PRINCIPAL con procedencia
//     `legacy_incumbent` (169) y la proyección se repite UNA vez: el revelado queda como
//     secundario y la fase 2 lo lleva a HubSpot al primer campo vacío, sin repetir.
//   * Se respeta la regla 164: el número de HubSpot / manual sigue siendo el principal en SellUp.
//     El nuevo se ve como «Teléfono Apollo / Lusha» (`metadata.provider_phone`).
//   * Mismo normalizador que el resto de la colección (`normalizeCandidatePhone`): otro algoritmo
//     haría que el mismo número tuviera dos claves y se duplicara.

import { normalizeCandidatePhone } from './phone-collection-core';
import type { ProjectApprovedCandidatePhonesOutcome } from './post-approval-reveal-core';

export const BOOTSTRAP_LEGACY_CONTACT_PHONE_FN = 'bootstrap_legacy_contact_phone_incumbent' as const;

const OFFICIAL_PHONE_TYPES: readonly string[] = ['personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'];

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export interface LegacyContactScalar {
  phone: string | null;
  phoneType: string | null;
  countryCode: string | null;
}

export interface BootstrapLegacyContactPhoneParams {
  p_contact_id: string;
  p_observed_phone: string;
  p_normalized_phone: string;
  p_display_phone: string;
  p_dedupe_key: string;
  p_phone_type: string | null;
  p_now: string;
}

/** Parámetros de la 169, o null si el número no deja una forma canónica utilizable. */
export function buildBootstrapLegacyContactPhoneParams(input: {
  contactId: string;
  scalar: LegacyContactScalar;
  nowIso: string;
}): BootstrapLegacyContactPhoneParams | null {
  const phone = clean(input.scalar.phone);
  if (!phone || !clean(input.contactId)) return null;
  const normalized = normalizeCandidatePhone({
    displayPhone: phone,
    sanitizedPhone: phone,
    countryCode: input.scalar.countryCode ?? null,
  });
  if (!normalized.normalizedPhone || !normalized.dedupeKey) return null;
  const type = clean(input.scalar.phoneType);
  return {
    p_contact_id: input.contactId,
    // El valor tal cual está en la fila: la 169 lo compara bajo el lock.
    p_observed_phone: phone,
    p_normalized_phone: normalized.normalizedPhone,
    p_display_phone: normalized.displayPhone ?? normalized.normalizedPhone,
    p_dedupe_key: normalized.dedupeKey,
    p_phone_type: type && OFFICIAL_PHONE_TYPES.includes(type) ? type : null,
    p_now: input.nowIso,
  };
}

export type BootstrapLegacyContactPhoneStatus =
  | 'bootstrapped'
  | 'collection_present'
  | 'stale'
  | 'tombstoned'
  | 'no_scalar'
  | 'contact_archived'
  | 'contact_not_found'
  | 'invalid_input'
  | 'unparseable';

const STATUSES: readonly BootstrapLegacyContactPhoneStatus[] = [
  'bootstrapped',
  'collection_present',
  'stale',
  'tombstoned',
  'no_scalar',
  'contact_archived',
  'contact_not_found',
  'invalid_input',
];

export function parseBootstrapLegacyContactPhoneEnvelope(data: unknown): BootstrapLegacyContactPhoneStatus {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'unparseable';
  const status = (data as Record<string, unknown>).status;
  return typeof status === 'string' && (STATUSES as readonly string[]).includes(status)
    ? (status as BootstrapLegacyContactPhoneStatus)
    : 'unparseable';
}

export interface LegacyBootstrapProjectionDeps {
  project: () => Promise<ProjectApprovedCandidatePhonesOutcome>;
  readContactScalar: () => Promise<LegacyContactScalar | null>;
  bootstrap: (params: BootstrapLegacyContactPhoneParams) => Promise<BootstrapLegacyContactPhoneStatus>;
  nowIso: () => string;
}

export interface LegacyBootstrapProjectionResult {
  outcome: ProjectApprovedCandidatePhonesOutcome;
  /** null = no hizo falta (la proyección no topó con la forma legacy). */
  bootstrap: BootstrapLegacyContactPhoneStatus | 'not_buildable' | null;
}

/**
 * Proyecta; si la base rechaza la forma legacy, mete el número del contacto a su colección y
 * proyecta UNA vez más. `project` puede LANZAR (el llamador ya lo trata como proyección fallida).
 */
export async function projectWithLegacyContactBootstrap(
  contactId: string,
  deps: LegacyBootstrapProjectionDeps,
): Promise<LegacyBootstrapProjectionResult> {
  const first = await deps.project();
  if (first.status !== 'scalar_incumbent_unprojectable') return { outcome: first, bootstrap: null };

  const scalar = await deps.readContactScalar().catch(() => null);
  const params = scalar ? buildBootstrapLegacyContactPhoneParams({ contactId, scalar, nowIso: deps.nowIso() }) : null;
  if (!params) return { outcome: first, bootstrap: 'not_buildable' };

  const status = await deps.bootstrap(params).catch(() => 'unparseable' as const);
  // `collection_present`: otra llamada concurrente ya la creó; reproyectar es igual de seguro.
  if (status !== 'bootstrapped' && status !== 'collection_present') return { outcome: first, bootstrap: status };
  return { outcome: await deps.project(), bootstrap: status };
}

// ── «Teléfono Apollo / Lusha» en la ficha ──────────────────────────

export interface ProviderPhoneRow {
  number: string;
  type: string | null;
  /** Procedencia en el vocabulario del escalar (`apollo_reveal`, `lusha_reveal`, …). */
  source: string | null;
  observedAt: string | null;
}

/**
 * Tras proyectar números NUEVOS en un contacto cuyo principal es de HubSpot / manual (regla 164),
 * el más reciente de proveedor se muestra como «Teléfono Apollo / Lusha». Devuelve el bloque
 * `metadata.provider_phone` a escribir, o null si no hay nada que mostrar o ya está.
 */
export function planProviderPhoneNotice(input: {
  phonesInserted: number;
  contactPhone: string | null;
  current: unknown;
  newest: ProviderPhoneRow | null;
}): Record<string, string> | null {
  if (input.phonesInserted <= 0 || !input.newest) return null;
  const digits = (value: string | null | undefined) => (typeof value === 'string' ? value.replace(/\D+/g, '') : '');
  const number = clean(input.newest.number);
  if (!number) return null;
  if (digits(number) && digits(number) === digits(input.contactPhone)) return null;
  const current = input.current && typeof input.current === 'object' ? (input.current as Record<string, unknown>) : null;
  if (current && digits(clean(current.number)) === digits(number)) return null;
  const block: Record<string, string> = { number };
  if (input.newest.type) block.type = input.newest.type;
  if (input.newest.source) block.source = input.newest.source;
  if (input.newest.observedAt) block.observed_at = input.newest.observedAt;
  return block;
}

/** Procedencia de la colección → vocabulario del escalar (112, el mismo mapeo de la 115). */
export function legacyPhoneSourceFromPair(provider: string | null, mode: string | null): string | null {
  if (provider === 'apollo_cache') return 'apollo_cache';
  if (provider === 'lusha') return 'lusha_reveal';
  if (provider === 'apollo' && (mode === 'reveal' || mode === 'waterfall')) return 'apollo_reveal';
  if (provider === 'apollo' && mode === 'search') return 'apollo_search';
  return null;
}

// ── HubSpot: el número nuevo llega aunque el principal no cambie ───

/**
 * La fase 2 de la proyección (128/131) sólo corre cuando cambió el teléfono SALIENTE
 * (`hubspot_sync_transition = 'marked'`). Un número que entra como SECUNDARIO en un contacto que ya
 * tenía principal (el de HubSpot, regla 164) no cambia el saliente, así que nunca viajaba. En ese
 * caso, y sólo en ése, se envían los números del contacto al primer campo vacío de HubSpot, sin
 * repetir (`planRevealedPhonesForHubSpot`).
 */
export function shouldPushProjectedPhonesToHubSpot(outcome: ProjectApprovedCandidatePhonesOutcome): boolean {
  return outcome.status === 'projected' && outcome.phonesInserted > 0 && outcome.hubspotSyncTransition !== 'marked';
}
