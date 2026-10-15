/**
 * Estados Unidos — consultas en vivo de «Proveedores de una empresa» con USAspending.gov
 * (POST con tiempo máximo, sin llave): agencia por nombre, proveedores de la industria,
 * contratos por proveedor y gobiernos fuera.
 *
 * Web y tamaño: el UEI no está en ninguna fuente cargada en SellUp, así que el cruce es
 * por NOMBRE normalizado (`normalizeUsCompanyCore`, el mismo de la carga) contra
 * `us_free_directory` (SEC, IRS 990 e IPEDS; ~6 mil con web, empleados del 990). Sólo un
 * nombre que coincide con UNA fila cuenta. Lo demás va a Descartadas «sin sitio» para que
 * el rescate de Claude busque su web.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWebsiteHost } from '@/server/source-catalog/connectors/co-public-entities/co-domain';
import { normalizeUsCompanyCore } from '@/server/source-catalog/connectors/us-ein/us-ein-registry-rows';
import type { PublicBuyerSupplier, PublicBuyerSuppliersResult, PublicEntityRow } from '../public-buyer-suppliers';
import {
  buildUsAwardsBody,
  buildUsRecipientsBody,
  decodeUsAgency,
  encodeUsAgency,
  normalizeUsAgencyName,
  parseUsAgencies,
  parseUsAwards,
  parseUsGovernmentUeis,
  parseUsRecipients,
  usTimePeriod,
  US_AGENCY_SEARCH_URL,
  US_AWARDS_URL,
  US_MIN_PAIR_AMOUNT_USD,
  US_RECIPIENTS_URL,
  US_SUPPLIER_LIMIT,
  US_USASPENDING_SOURCE_KEY,
  type UsAwardFacts,
  type UsRecipientRow,
} from './us';
import { US_NAICS_CLASSIFIER, US_NAICS_MACRO_TABLE_VERSION, usNaicsPrefixesForMacro } from './us-naics-macro-table';
import type { CountryLookups } from './loaded-lookups.server';

const REQUEST_TIMEOUT_MS = 12_000;
/** UEI por consulta de contratos (cada una trae hasta 100 contratos, de más monto). */
const AWARDS_CHUNK = 10;
const AGENCY_SEARCH_LIMIT = 10;
const DIRECTORY_SOURCE_KEY = 'us_free_directory';

/** POST JSON con tiempo máximo. */
export type UsPostJson = (url: string, body: Record<string, unknown>, timeoutMs: number) => Promise<unknown>;

function logError(step: string, error: unknown): void {
  console.error(`[supplier-public-buyer:US] ${step}:`, (error as { message?: string })?.message ?? String(error));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function defaultPostJson(url: string, body: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'SellUp/0.1 supplier-search' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** Industria por lo que le vende a la agencia; la prueba es su contrato más grande. */
export function classifyUsSuppliers(
  recipients: readonly UsRecipientRow[],
  facts: ReadonlyMap<string, UsAwardFacts>,
  macroIndustryKey: string,
): PublicBuyerSupplier[] {
  const out: PublicBuyerSupplier[] = [];
  for (const recipient of recipients) {
    const fact = facts.get(recipient.uei);
    const macro = fact ? US_NAICS_CLASSIFIER.classify(fact.amountByNaics) : null;
    if (!fact || !macro || macro.macroIndustryKey !== macroIndustryKey) continue;
    const topNaics = Object.entries(fact.amountByNaics).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    out.push({
      taxId: recipient.uei,
      name: recipient.name,
      totalAmount: Math.round(recipient.amount),
      contractCount: Math.max(1, fact.contractCount),
      lastSignedAt: fact.lastStartDate,
      macroIndustryKey: macro.macroIndustryKey,
      macroShare: macro.share,
      rubro: US_NAICS_CLASSIFIER.rubroOf(topNaics),
      evidenceUrl: fact.topAward?.url ?? null,
    });
  }
  return out;
}

type DirectoryHit = { website: string | null; workers: number | null; year: number | null; kind: string | null };

/** Fila única de `us_free_directory` por nombre normalizado (dos filas con el mismo nombre ⇒ nada). */
async function directoryByName(serviceClient: SupabaseClient, names: readonly string[]): Promise<Map<string, DirectoryHit>> {
  const out = new Map<string, DirectoryHit>();
  const cores = [...new Set(names.map((n) => normalizeUsCompanyCore(n)).filter((c) => c.length >= 3))];
  if (cores.length === 0) return out;
  const { data, error } = await serviceClient
    .from('source_company_snapshots')
    .select('normalized_legal_name, source_year, website:raw_data->>website_domain, workers:raw_data->>workers, kind:raw_data->>directory_kind')
    .eq('source_key', DIRECTORY_SOURCE_KEY)
    .in('normalized_legal_name', cores);
  if (error) {
    logError('directory', error);
    return out;
  }
  const byCore = new Map<string, Array<Record<string, unknown>>>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const core = text(row.normalized_legal_name);
    if (core) byCore.set(core, [...(byCore.get(core) ?? []), row]);
  }
  for (const [core, rows] of byCore) {
    if (rows.length !== 1) continue;
    const row = rows[0];
    const workers = Number(row.workers);
    const year = Number(row.source_year);
    out.set(core, {
      website: normalizeWebsiteHost(text(row.website)),
      workers: Number.isInteger(workers) && workers > 0 ? workers : null,
      year: Number.isInteger(year) ? year : null,
      kind: text(row.kind),
    });
  }
  return out;
}

/** Estados Unidos: USAspending en vivo; web y empleados por nombre en `us_free_directory`. */
export function buildUsLookups(serviceClient: SupabaseClient, options: { postJson?: UsPostJson } = {}): CountryLookups {
  const postJson = options.postJson ?? defaultPostJson;
  // Lo que `listSuppliers` ya vio sirve a los pasos siguientes del mismo paso.
  const governmentUeis = new Set<string>();
  const nameByUei = new Map<string, string>();
  const directoryByUei = new Map<string, DirectoryHit>();

  return {
    sourceKey: US_USASPENDING_SOURCE_KEY,
    taxIdentifierType: 'other',
    normalizeName: normalizeUsAgencyName,

    findPublicEntities: async (normalizedName) => {
      try {
        const payload = await postJson(US_AGENCY_SEARCH_URL, { search_text: normalizedName, limit: AGENCY_SEARCH_LIMIT }, REQUEST_TIMEOUT_MS);
        return parseUsAgencies(payload).map(
          (agency): PublicEntityRow => ({
            taxId: encodeUsAgency(agency),
            normalizedLegalName: normalizeUsAgencyName(agency.name),
            shortName: agency.abbreviation,
            isHead: agency.tier === 'toptier',
          }),
        );
      } catch (error) {
        logError('find agencies', error);
        return [];
      }
    },

    listSuppliers: async ({ buyerTaxId, macroIndustryKey, nowIso }): Promise<PublicBuyerSuppliersResult> => {
      const agency = decodeUsAgency(buyerTaxId);
      const naicsPrefixes = usNaicsPrefixesForMacro(macroIndustryKey);
      if (!agency || naicsPrefixes.length === 0) return { ok: false, reason: 'industry_without_unspsc' };
      const period = usTimePeriod(nowIso);
      const sinceYear = period.start_date.slice(0, 4);
      let recipients: UsRecipientRow[];
      try {
        const [all, governments] = await Promise.all([
          postJson(US_RECIPIENTS_URL, buildUsRecipientsBody({ agency, period, naicsPrefixes }), REQUEST_TIMEOUT_MS),
          // Los gobiernos son un extra: si falla, se sigue sin sacarlos.
          postJson(US_RECIPIENTS_URL, buildUsRecipientsBody({ agency, period, naicsPrefixes, onlyGovernment: true }), REQUEST_TIMEOUT_MS).catch(() => null),
        ]);
        recipients = parseUsRecipients(all, US_MIN_PAIR_AMOUNT_USD).slice(0, US_SUPPLIER_LIMIT);
        for (const uei of parseUsGovernmentUeis(governments)) governmentUeis.add(uei);
      } catch (error) {
        logError('recipients', error);
        return { ok: false, reason: 'source_unavailable' };
      }
      if (recipients.length === 0) {
        return { ok: true, suppliers: [], read: 0, outsideIndustry: 0, tableVersion: US_NAICS_MACRO_TABLE_VERSION, sinceYear };
      }
      for (const r of recipients) nameByUei.set(r.uei, r.name);

      const chunks: string[][] = [];
      for (let i = 0; i < recipients.length; i += AWARDS_CHUNK) chunks.push(recipients.slice(i, i + AWARDS_CHUNK).map((r) => r.uei));
      const facts = new Map<string, UsAwardFacts>();
      const [awardPages, directory] = await Promise.all([
        Promise.all(
          chunks.map((ueis) =>
            postJson(US_AWARDS_URL, buildUsAwardsBody({ agency, period, ueis }), REQUEST_TIMEOUT_MS)
              .then((payload) => parseUsAwards(payload, new Set(ueis)))
              .catch((error) => (logError('awards', error), new Map<string, UsAwardFacts>())),
          ),
        ),
        directoryByName(serviceClient, recipients.map((r) => r.name)),
      ]);
      for (const page of awardPages) for (const [uei, fact] of page) facts.set(uei, fact);
      for (const r of recipients) {
        const hit = directory.get(normalizeUsCompanyCore(r.name));
        if (hit) directoryByUei.set(r.uei, hit);
      }

      const suppliers = classifyUsSuppliers(recipients, facts, macroIndustryKey).map((s): PublicBuyerSupplier => {
        const hit = directoryByUei.get(s.taxId);
        return hit?.workers
          ? { ...s, officialWorkers: { workers: hit.workers, year: hit.year, sourceLabel: hit.kind === 'ipeds' ? 'IPEDS' : 'IRS 990' } }
          : s;
      });
      return {
        ok: true,
        suppliers,
        read: recipients.length,
        outsideIndustry: recipients.length - suppliers.length,
        tableVersion: US_NAICS_MACRO_TABLE_VERSION,
        sinceYear,
      };
    },

    listPublicOnlyTaxIds: async (taxIds) => new Set(taxIds.filter((uei) => governmentUeis.has(uei))),

    findDomainsByTaxId: async (taxIds) => {
      const domains = new Map<string, string>();
      const missing = taxIds.filter((uei) => !directoryByUei.has(uei) && nameByUei.has(uei));
      if (missing.length > 0) {
        const directory = await directoryByName(serviceClient, missing.map((uei) => nameByUei.get(uei) ?? ''));
        for (const uei of missing) {
          const hit = directory.get(normalizeUsCompanyCore(nameByUei.get(uei) ?? ''));
          if (hit) directoryByUei.set(uei, hit);
        }
      }
      for (const uei of taxIds) {
        const website = directoryByUei.get(uei)?.website;
        if (website) domains.set(uei, website);
      }
      return domains;
    },
  };
}
