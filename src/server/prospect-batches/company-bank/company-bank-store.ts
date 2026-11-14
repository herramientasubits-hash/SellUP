/**
 * company-bank-store.ts — el transporte hacia las tres funciones SQL del banco.
 *
 * AGENT1-COMPANY-BANK-FOUNDATION-1. Ver `docs/agent1/COMPANY_BANK_DESIGN.md`.
 *
 * ── Qué es y qué NO es ────────────────────────────────────────────────────────
 *
 * Un adaptador delgado sobre `agent1_bank_deposit`, `agent1_bank_draw` y
 * `agent1_bank_settle` (migración 142). La SEMÁNTICA —unicidad por señal, reservas,
 * caducidad, transiciones— vive en PostgreSQL, no aquí: igual que la memoria
 * provider-seen y los reclamos globales, partirla entre SQL y TypeScript acabaría
 * con dos ideas distintas de qué es «la misma empresa».
 *
 * ── 🔴 Ningún fallo del banco puede costar dinero ni romper una corrida ────────
 *
 * Nada de aquí LANZA. Un error (función ausente porque la migración aún no está
 * aplicada, red, permisos) vuelve como `{ status: 'unavailable', reason }` y el
 * llamador sigue como si el banco estuviera vacío: la corrida pide a los
 * proveedores lo de siempre. El banco es una optimización; una optimización que
 * puede tumbar la operación deja de serlo.
 *
 * El cliente se INYECTA y DEBE ser el administrativo (`service_role`): las tres
 * funciones y la tabla no admiten a `authenticated`.
 *
 * No llama a ningún proveedor, no lee un flag, no toca presupuesto.
 *
 * ── Única excepción de dedupe: la misma web con otra clave (dueña 14-11) ───────
 *
 * La 142 sólo ve choques de la MISMA clave. Una empresa guardada por su web
 * (`claim_domain`, sin RUT) y luego por su RUT (`claim_fiscal`, que no reclama la web)
 * entraba dos veces: Prod 14-11, Coca-Cola Embonor. Antes de enviar, se cruza la web
 * de cada fila con las activas del banco (`banked`/`reserved`) DEL MISMO PAÍS, con la
 * regla de los reclamos globales (152): misma web = misma empresa, SALVO que las dos
 * tengan RUT y sea distinto (filiales de un grupo). En otro país es otra empresa para
 * prospectar (AstraZeneca CO y MX, SoftwareOne CO, EC y RD). Las que chocan cuentan como `skippedInBank`.
 * Si la lectura falla, se deposita como antes (la 142 sigue cuidando cada clave).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import {
  COMPANY_BANK_DEFAULT_RESERVE_SECONDS,
  COMPANY_BANK_DEPOSIT_CHUNK,
  COMPANY_BANK_MAX_DRAW,
  COMPANY_BANK_MAX_PAYLOAD_BYTES,
  COMPANY_BANK_SETTLE_OUTCOMES,
  COMPANY_BANK_SOURCE_PROVIDERS,
  COMPANY_BANK_TIERS,
  type CompanyBankClaim,
  type CompanyBankDepositItem,
  type CompanyBankDepositResult,
  type CompanyBankDrawResult,
  type CompanyBankDrawnCompany,
  type CompanyBankSettleItem,
  type CompanyBankSettleResult,
  type CompanyBankSourceProvider,
  type CompanyBankTier,
} from './company-bank-types';

export const COMPANY_BANK_RPC_DEPOSIT = 'agent1_bank_deposit';
export const COMPANY_BANK_RPC_DRAW = 'agent1_bank_draw';
export const COMPANY_BANK_RPC_SETTLE = 'agent1_bank_settle';

const COUNTRY_RE = /^[A-Z]{2}$/;
const MACRO_RE = /^[a-z][a-z0-9_]{1,63}$/;
const CLAIM_TYPES = new Set(['fiscal', 'domain', 'provider_entity', 'linkedin']);
const TIERS = new Set<string>(COMPANY_BANK_TIERS);
const PROVIDERS = new Set<string>(COMPANY_BANK_SOURCE_PROVIDERS);
const OUTCOMES = new Set<string>(COMPANY_BANK_SETTLE_OUTCOMES);

export type CompanyBankStore = {
  deposit(items: readonly CompanyBankDepositItem[]): Promise<CompanyBankDepositResult>;
  draw(input: {
    countryCode: string;
    macroIndustryKey: string;
    limit: number;
    /** Por defecto, sólo las listas. */
    tiers?: readonly CompanyBankTier[];
    reserveSeconds?: number;
    /** Inyectable para pruebas; por defecto un UUID nuevo. */
    drawId?: string;
  }): Promise<CompanyBankDrawResult>;
  settle(drawId: string, outcomes: readonly CompanyBankSettleItem[]): Promise<CompanyBankSettleResult>;
};

function reasonOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    const code = typeof e.code === 'string' ? e.code : null;
    const message = typeof e.message === 'string' ? e.message.slice(0, 160) : null;
    return [code, message].filter(Boolean).join(': ') || 'unknown_error';
  }
  return typeof error === 'string' ? error.slice(0, 160) : 'unknown_error';
}

/**
 * ¿La fila cumple lo que la 142 exigirá? Se descarta ANTES de enviar lo que la base
 * de datos va a rechazar de todos modos: un envío con basura no gasta una ida y
 * vuelta ni ensucia el contador de la base.
 */
export function isDepositItemWellFormed(item: CompanyBankDepositItem): boolean {
  if (!COUNTRY_RE.test(item.countryCode)) return false;
  if (!MACRO_RE.test(item.macroIndustryKey)) return false;
  if (!TIERS.has(item.tier) || !PROVIDERS.has(item.sourceProvider)) return false;
  const hasSignal = item.claims.some(
    (c) => CLAIM_TYPES.has(c.type) && typeof c.key === 'string' && c.key.trim() !== '',
  );
  if (!hasSignal) return false;
  if ((item.tier === 'ready') !== (item.missingFields.length === 0)) return false;
  if (item.payload === null || typeof item.payload !== 'object' || Array.isArray(item.payload)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(item.payload), 'utf8') <= COMPANY_BANK_MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

function toWire(item: CompanyBankDepositItem): Record<string, unknown> {
  return {
    countryCode: item.countryCode,
    macroIndustryKey: item.macroIndustryKey,
    tier: item.tier,
    sourceProvider: item.sourceProvider,
    claims: item.claims.map((c) => ({ type: c.type, key: c.key.trim() })),
    payload: item.payload,
    missingFields: [...item.missingFields],
    ...(item.sourceBatchId ? { sourceBatchId: item.sourceBatchId } : {}),
    ...(typeof item.ttlDays === 'number' ? { ttlDays: Math.trunc(item.ttlDays) } : {}),
  };
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function parseClaims(value: unknown): CompanyBankClaim[] {
  if (!Array.isArray(value)) return [];
  const out: CompanyBankClaim[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const { type, key } = raw as { type?: unknown; key?: unknown };
    if (typeof type === 'string' && CLAIM_TYPES.has(type) && typeof key === 'string' && key !== '') {
      out.push({ type: type as CompanyBankClaim['type'], key });
    }
  }
  return out;
}

function parseDrawn(row: unknown): CompanyBankDrawnCompany | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.tier !== 'string' || !TIERS.has(r.tier)) return null;
  if (typeof r.source_provider !== 'string' || !PROVIDERS.has(r.source_provider)) return null;
  const payload =
    r.payload !== null && typeof r.payload === 'object' && !Array.isArray(r.payload)
      ? (r.payload as Record<string, unknown>)
      : null;
  if (payload === null) return null;
  const claims = parseClaims(r.claims);
  // Una fila sin señal no se puede reclamar al asignarla: no se entrega.
  if (claims.length === 0) return null;
  return {
    id: r.id,
    tier: r.tier as CompanyBankTier,
    sourceProvider: r.source_provider as CompanyBankSourceProvider,
    claims,
    payload,
    missingFields: Array.isArray(r.missing_fields) ? r.missing_fields.filter((m): m is string => typeof m === 'string') : [],
    sourceBatchId: typeof r.source_batch_id === 'string' ? r.source_batch_id : null,
    bankedAt: typeof r.banked_at === 'string' ? r.banked_at : '',
  };
}

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** La web y el RUT con que se identifica una fila del banco (claves o payload). */
export function bankItemIdentity(item: Pick<CompanyBankDepositItem, 'claims' | 'payload'>): {
  domain: string | null;
  fiscal: string | null;
} {
  const claim = (type: string) => asStr(item.claims.find((c) => c.type === type)?.key);
  const payload = asObj(item.payload);
  const domain =
    claim('domain') ?? asStr(asObj(payload?.candidate)?.domain) ?? asStr(asObj(payload?.evidence)?.domain);
  return { domain: domain ? domain.toLowerCase().replace(/^www\./, '') : null, fiscal: claim('fiscal') };
}

/** Misma web ⇒ misma empresa, salvo dos RUT distintos (filiales de un grupo). */
export function isSameCompanyByDomain(fiscalA: string | null, fiscalB: string | null): boolean {
  return !(fiscalA && fiscalB && fiscalA !== fiscalB);
}

/** País + web → RUTs de las filas activas con esa web en ese país. */
type ActiveByDomain = Map<string, Array<string | null>>;

const countryDomainKey = (countryCode: string, domain: string) => `${countryCode}|${domain}`;

/** Las filas activas del banco con alguna de estas webs: país|web → RUTs. `null` si falla la lectura. */
async function loadActiveByDomain(client: SupabaseClient, domains: readonly string[]): Promise<ActiveByDomain | null> {
  if (domains.length === 0) return new Map();
  const list = domains.map((d) => `"${d.replace(/"/g, '')}"`).join(',');
  try {
    const { data, error } = await client
      .from('agent1_company_bank')
      .select('country_code, claim_fiscal, claim_domain, cd:payload->candidate->>domain, ed:payload->evidence->>domain')
      .in('status', ['banked', 'reserved'])
      .or(`claim_domain.in.(${list}),payload->candidate->>domain.in.(${list}),payload->evidence->>domain.in.(${list})`);
    if (error) {
      console.error('[company-bank] domain cross-check skipped:', reasonOf(error));
      return null;
    }
    const byDomain: ActiveByDomain = new Map();
    for (const row of (data ?? []) as Obj[]) {
      const fiscal = asStr(row.claim_fiscal);
      const country = asStr(row.country_code);
      if (!country) continue;
      const domains = new Set(
        [row.claim_domain, row.cd, row.ed]
          .map((raw) => asStr(raw)?.toLowerCase().replace(/^www\./, ''))
          .filter((d): d is string => !!d),
      );
      for (const domain of domains) {
        const key = countryDomainKey(country, domain);
        byDomain.set(key, [...(byDomain.get(key) ?? []), fiscal]);
      }
    }
    return byDomain;
  } catch (error) {
    console.error('[company-bank] domain cross-check skipped:', reasonOf(error));
    return null;
  }
}

/**
 * Separa lo que ya está en el banco con OTRA clave (misma web) de lo que se envía.
 * También dentro del mismo depósito: la segunda fila de la misma empresa no se envía.
 */
export function splitSameDomainDuplicates(
  items: readonly CompanyBankDepositItem[],
  active: ActiveByDomain,
): { send: CompanyBankDepositItem[]; duplicates: number } {
  const seen: ActiveByDomain = new Map(active);
  const send: CompanyBankDepositItem[] = [];
  let duplicates = 0;
  for (const item of items) {
    const { domain, fiscal } = bankItemIdentity(item);
    const key = domain ? countryDomainKey(item.countryCode, domain) : null;
    if (key && (seen.get(key) ?? []).some((other) => isSameCompanyByDomain(fiscal, other))) {
      duplicates++;
      continue;
    }
    if (key) seen.set(key, [...(seen.get(key) ?? []), fiscal]);
    send.push(item);
  }
  return { send, duplicates };
}

export function createCompanyBankStore(client: SupabaseClient): CompanyBankStore {
  return {
    async deposit(items) {
      const formed = items.filter(isDepositItemWellFormed);
      const dropped = items.length - formed.length;
      const domains = [...new Set(formed.map((i) => bankItemIdentity(i).domain).filter((d): d is string => !!d))];
      const active = await loadActiveByDomain(client, domains);
      const { send: wellFormed, duplicates } = active
        ? splitSameDomainDuplicates(formed, active)
        : { send: formed, duplicates: 0 };
      const total = { deposited: 0, skippedClaimed: 0, skippedInBank: duplicates, skippedInvalid: dropped };
      if (wellFormed.length === 0) return { status: 'ok', ...total };

      for (let i = 0; i < wellFormed.length; i += COMPANY_BANK_DEPOSIT_CHUNK) {
        const chunk = wellFormed.slice(i, i + COMPANY_BANK_DEPOSIT_CHUNK);
        try {
          const { data, error } = await client.rpc(COMPANY_BANK_RPC_DEPOSIT, {
            p_items: chunk.map(toWire),
          });
          if (error) {
            // Un trozo ya depositado no se pierde; el resto se informa como no disponible.
            return total.deposited > 0
              ? { status: 'ok', ...total }
              : { status: 'unavailable', reason: reasonOf(error) };
          }
          const out = (data ?? {}) as Record<string, unknown>;
          if (out.status !== 'ok') {
            return total.deposited > 0
              ? { status: 'ok', ...total }
              : { status: 'unavailable', reason: `deposit_status_${String(out.status ?? 'missing')}` };
          }
          total.deposited += asCount(out.deposited);
          total.skippedClaimed += asCount(out.skipped_claimed);
          total.skippedInBank += asCount(out.skipped_in_bank);
          total.skippedInvalid += asCount(out.skipped_invalid);
        } catch (error) {
          return total.deposited > 0
            ? { status: 'ok', ...total }
            : { status: 'unavailable', reason: reasonOf(error) };
        }
      }
      return { status: 'ok', ...total };
    },

    async draw(input) {
      if (!COUNTRY_RE.test(input.countryCode) || !MACRO_RE.test(input.macroIndustryKey)) {
        return { status: 'unavailable', reason: 'invalid_scope' };
      }
      const limit = Math.min(Math.max(Math.trunc(input.limit), 0), COMPANY_BANK_MAX_DRAW);
      const drawId = input.drawId ?? randomUUID();
      if (limit === 0) return { status: 'ok', drawId, companies: [] };
      const tiers = (input.tiers ?? ['ready']).filter((t) => TIERS.has(t));
      if (tiers.length === 0) return { status: 'ok', drawId, companies: [] };

      try {
        const { data, error } = await client.rpc(COMPANY_BANK_RPC_DRAW, {
          p_country_code: input.countryCode,
          p_macro_industry_key: input.macroIndustryKey,
          p_limit: limit,
          p_draw_id: drawId,
          p_reserve_seconds: input.reserveSeconds ?? COMPANY_BANK_DEFAULT_RESERVE_SECONDS,
          p_tiers: [...tiers],
        });
        if (error) return { status: 'unavailable', reason: reasonOf(error) };
        const rows = Array.isArray(data) ? data : [];
        const companies = rows.map(parseDrawn).filter((c): c is CompanyBankDrawnCompany => c !== null);
        return { status: 'ok', drawId, companies };
      } catch (error) {
        return { status: 'unavailable', reason: reasonOf(error) };
      }
    },

    async settle(drawId, outcomes) {
      const valid = outcomes.filter((o) => OUTCOMES.has(o.outcome));
      if (valid.length === 0) return { status: 'ok', assigned: 0, invalidated: 0, released: 0, ignored: 0 };
      try {
        const { data, error } = await client.rpc(COMPANY_BANK_RPC_SETTLE, {
          p_draw_id: drawId,
          p_outcomes: valid.map((o) =>
            o.outcome === 'assigned'
              ? { id: o.id, outcome: o.outcome, batchId: o.batchId, candidateId: o.candidateId }
              : o.outcome === 'invalidated'
                ? { id: o.id, outcome: o.outcome, reason: o.reason }
                : { id: o.id, outcome: o.outcome },
          ),
        });
        if (error) return { status: 'unavailable', reason: reasonOf(error) };
        const out = (data ?? {}) as Record<string, unknown>;
        if (out.status !== 'ok') {
          return { status: 'unavailable', reason: `settle_status_${String(out.status ?? 'missing')}` };
        }
        return {
          status: 'ok',
          assigned: asCount(out.assigned),
          invalidated: asCount(out.invalidated),
          released: asCount(out.released),
          ignored: asCount(out.ignored),
        };
      } catch (error) {
        return { status: 'unavailable', reason: reasonOf(error) };
      }
    },
  };
}
