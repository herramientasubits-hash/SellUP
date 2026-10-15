/**
 * República Dominicana — DGCP en vivo (API de datos abiertos, sin llave; exige
 * `User-Agent`). Por cada corrida, sólo lectura:
 *
 *  1. La entidad: `/unidades_compra` (766 unidades, una página) por nombre o acrónimo.
 *  2. Sus contratos de los últimos 12 meses: `/contratos?unidad_compra={código}`
 *     (vienen del más nuevo al más viejo; 1–3 páginas de 1.000, con tiempo máximo).
 *     Sin cancelados; agrupados por proveedor (rpe) con piso de DOP 600 mil (~US$10 mil).
 *  3. El RNC del proveedor sale de `do_dgcp` (fuente ya cargada, rpe → RNC de 9
 *     dígitos): quien no tiene RNC de sociedad (persona física con cédula) no entra.
 *  4. Su industria, por las familias UNSPSC que el proveedor declara en el Registro de
 *     Proveedores (`/proveedores/rubro?rpe=`), con la tabla UNSPSC aprobada y la regla
 *     del 50 % (cada familia pesa igual). La API no deja filtrar los artículos por
 *     contrato ni por entidad (`/contratos/articulos` sólo por familia, 2,9 M líneas),
 *     así que lo que le vendió a ESA entidad no se puede leer en vivo. Se clasifica por
 *     tandas, de más a menos monto, hasta llenar la meta, agotar el tiempo o el
 *     presupuesto de llamadas, o al primer error (la API corta con 429 a las 60/min).
 *
 * Puro: la llamada HTTP, el cruce rpe → RNC y el reloj se inyectan.
 */

import { unspscPrefixesForMacro } from '../co-secop-suppliers';
import { httpsUrl } from '../procurement-links';
import {
  normalizePublicEntityName,
  PUBLIC_BUYER_MAX_SUPPLIERS,
  type PublicBuyerSupplier,
  type PublicBuyerSuppliersResult,
  type PublicEntityRow,
} from '../public-buyer-suppliers';
import { UNSPSC_CLASSIFIER, unspscFamily } from '../unspsc-classifier';
import type { LiveCountrySource } from './types';

export const DO_DGCP_API_URL = 'https://datosabiertos.dgcp.gob.do/api-dgcp/v1';
export const DO_DGCP_SUPPLIERS_SOURCE_KEY = 'do_dgcp_buyer_suppliers';
/** Piso acumulado entidad × proveedor en la ventana (~US$10 mil a 60 DOP/US$). */
export const DO_DGCP_MIN_PAIR_AMOUNT_DOP = 600_000;
/** Contratos en dólares se pasan a pesos con esta tasa (la misma de la Fase 0). */
export const DO_DOP_PER_USD = 60;
export const DO_DGCP_LOOKBACK_MONTHS = 12;
export const DO_DGCP_CONTRACTS_PAGE_SIZE = 1000;
/** Páginas de contratos como mucho (el Ministerio de Salud usa 2 para 12 meses). */
export const DO_DGCP_MAX_CONTRACT_PAGES = 3;
/**
 * La API permite 60 peticiones por minuto por IP (`x-ratelimit-limit: 60`, medido
 * 15-10). Presupuesto por corrida: ≤ 3 páginas de contratos + ≤ 40 rubros (los ya
 * consultados se guardan en memoria del proceso y no cuentan).
 */
export const DO_DGCP_MAX_CLASSIFIED = 40;
/** Llamadas de rubro simultáneas. */
export const DO_DGCP_RUBRO_CONCURRENCY = 4;
/** Tiempo máximo para clasificar (después se responde con lo que haya). */
export const DO_DGCP_CLASSIFY_BUDGET_MS = 12_000;

export const DO_COUNTRY: LiveCountrySource = {
  kind: 'live',
  countryCode: 'DO',
  sourceKey: DO_DGCP_SUPPLIERS_SOURCE_KEY,
  taxIdentifierType: 'RNC',
  normalizeBuyerName: normalizePublicEntityName,
};

type Json = Record<string, unknown>;

function rec(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

/** `payload.content` de una respuesta de la API (lista vacía si no lo es). */
export function doContent(body: unknown): Json[] {
  const content = rec(rec(body)?.payload)?.content;
  return Array.isArray(content) ? content.flatMap((c) => (rec(c) ? [c as Json] : [])) : [];
}

/** RNC de sociedad o asociación: 9 dígitos (la cédula de una persona física tiene 11). */
export function isDoCompanyRnc(raw: string | null | undefined): boolean {
  return /^\d{9}$/.test((raw ?? '').trim());
}

/** Primer día de la ventana (12 meses antes de hoy, AAAA-MM-DD). */
export function doSinceDate(nowIso: string): string {
  const year = Number(nowIso.slice(0, 4));
  const month = Number(nowIso.slice(5, 7));
  const index = year * 12 + (month - 1) - DO_DGCP_LOOKBACK_MONTHS;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-${nowIso.slice(8, 10)}`;
}

export const doUrls = {
  units: () => `${DO_DGCP_API_URL}/unidades_compra?limit=1000&page=1`,
  contracts: (unit: string, page: number) =>
    `${DO_DGCP_API_URL}/contratos?unidad_compra=${encodeURIComponent(unit)}&limit=${DO_DGCP_CONTRACTS_PAGE_SIZE}&page=${page}`,
  rubro: (rpe: string) => `${DO_DGCP_API_URL}/proveedores/rubro?rpe=${encodeURIComponent(rpe)}&limit=500`,
};

/** Unidades de compra activas como entidades candidatas (código = `codigo_unidad_compra`). */
export function parseDoBuyingUnits(body: unknown): PublicEntityRow[] {
  return doContent(body).flatMap((u): PublicEntityRow[] => {
    const code = str(u.codigo_unidad_compra);
    const name = str(u.unidad_compra);
    if (!code || !name || str(u.estado).toUpperCase() !== 'ACTIVA') return [];
    return [{ taxId: code, normalizedLegalName: normalizePublicEntityName(name), shortName: str(u.acronimo) || null, isHead: str(u.tipo) === 'Institución' }];
  });
}

/** Las que el nombre normalizado nombra: su nombre empieza por él, o es su acrónimo. */
export function matchDoBuyingUnits(units: readonly PublicEntityRow[], normalizedName: string): PublicEntityRow[] {
  if (!normalizedName) return [];
  return units.filter(
    (u) => u.normalizedLegalName.startsWith(normalizedName) || (u.shortName !== null && normalizePublicEntityName(u.shortName) === normalizedName),
  );
}

/** Un proveedor de la entidad en la ventana (por rpe, antes de saber su RNC). */
export type DoContractSupplier = {
  rpe: string;
  name: string;
  totalAmount: number;
  contractCount: number;
  lastSignedAt: string | null;
  evidenceUrl: string | null;
};

type SupplierState = DoContractSupplier & { contracts: Set<string>; topAmount: number };

function amountInDop(contract: Json): number {
  const value = Number(contract.valor_contratado);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const currency = str(contract.divisa).toUpperCase();
  if (currency === 'DOP' || currency === '') return value;
  return currency === 'USD' ? value * DO_DOP_PER_USD : 0;
}

function isCancelled(contract: Json): boolean {
  return /cancelad/i.test(`${str(contract.estado_contrato)} ${str(contract.estado_adjudicacion)}`);
}

/**
 * Proveedores con contratos vigentes desde `since`, de más a menos monto, con el piso
 * aplicado. La prueba es la página del contrato más grande en Compras Dominicana.
 */
export function aggregateDoContracts(contracts: readonly Json[], since: string, minAmount = DO_DGCP_MIN_PAIR_AMOUNT_DOP): DoContractSupplier[] {
  const byRpe = new Map<string, SupplierState>();
  for (const c of contracts) {
    const date = str(c.fecha_adjudicacion).slice(0, 10);
    const rpe = str(c.rpe);
    const amount = amountInDop(c);
    if (!rpe || !date || date < since || isCancelled(c) || amount <= 0) continue;
    const state = byRpe.get(rpe) ?? { rpe, name: str(c.razon_social) || rpe, totalAmount: 0, contractCount: 0, lastSignedAt: null, evidenceUrl: null, contracts: new Set<string>(), topAmount: 0 };
    state.totalAmount += amount;
    state.contracts.add(str(c.codigo_contrato) || `${date}|${amount}`);
    if (state.lastSignedAt === null || date > state.lastSignedAt) state.lastSignedAt = date;
    const url = httpsUrl(str(c.url_contrato));
    if (url && amount > state.topAmount) {
      state.topAmount = amount;
      state.evidenceUrl = url;
    }
    byRpe.set(rpe, state);
  }
  return [...byRpe.values()]
    .filter((s) => s.totalAmount >= minAmount)
    .map(({ rpe, name, totalAmount, contracts, lastSignedAt, evidenceUrl }) => ({ rpe, name, totalAmount: Math.round(totalAmount), contractCount: contracts.size, lastSignedAt, evidenceUrl }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

/** Familias UNSPSC (4 dígitos) que el proveedor declara en su rubro. */
export function parseDoRubroFamilies(body: unknown): string[] {
  return [...new Set(doContent(body).flatMap((r) => unspscFamily(str(r.familia_unspsc)) ?? []))];
}

/**
 * Industria por las familias declaradas, cada una con el mismo peso (tabla UNSPSC
 * aprobada, regla del 50 %). Un proveedor «de todo» (GTG Industrial declara 84
 * familias) no se clasifica.
 */
export function classifyDoRubro(families: readonly string[]): { macroIndustryKey: string; share: number; rubro: string | null } | null {
  const weights: Record<string, number> = {};
  for (const family of families) weights[family] = 1;
  const macro = UNSPSC_CLASSIFIER.classify(weights);
  if (!macro) return null;
  // Rubro en palabras: una familia del segmento con más familias declaradas de esa industria.
  const own = families.filter((f) => UNSPSC_CLASSIFIER.classify({ [f]: 1 })?.macroIndustryKey === macro.macroIndustryKey);
  const bySegment = new Map<string, string[]>();
  for (const f of own) bySegment.set(f.slice(0, 2), [...(bySegment.get(f.slice(0, 2)) ?? []), f]);
  const top = [...bySegment.values()].sort((a, b) => b.length - a.length)[0]?.[0] ?? null;
  return { ...macro, rubro: UNSPSC_CLASSIFIER.rubroOf(top) };
}

export type DoSupplierDeps = {
  fetchJson: (url: string) => Promise<unknown>;
  /** rpe → RNC de las fuentes cargadas (`do_dgcp`). */
  rncByRpe: (rpes: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /** Nombres normalizados de las unidades de compra (otras entidades públicas). */
  publicEntityNames: () => Promise<ReadonlySet<string>>;
  /** Familias declaradas ya conocidas (caché del proceso). */
  cachedRubro?: (rpe: string) => string[] | undefined;
  rememberRubro?: (rpe: string, families: string[]) => void;
  nowMs: () => number;
};

async function fetchContracts(unit: string, since: string, fetchJson: DoSupplierDeps['fetchJson']): Promise<Json[]> {
  const all: Json[] = [];
  for (let page = 1; page <= DO_DGCP_MAX_CONTRACT_PAGES; page++) {
    const rows = doContent(await fetchJson(doUrls.contracts(unit, page)));
    all.push(...rows);
    const oldest = str(rows[rows.length - 1]?.fecha_adjudicacion).slice(0, 10);
    if (rows.length < DO_DGCP_CONTRACTS_PAGE_SIZE || (oldest && oldest < since)) break;
  }
  return all;
}

/** Proveedores de la unidad de compra en la industria pedida, de más a menos monto. */
export async function fetchDoSuppliers(
  input: { buyerTaxId: string; macroIndustryKey: string; nowIso: string },
  deps: DoSupplierDeps,
): Promise<PublicBuyerSuppliersResult> {
  if (unspscPrefixesForMacro(input.macroIndustryKey).length === 0) return { ok: false, reason: 'industry_without_unspsc' };
  const since = doSinceDate(input.nowIso);
  let contracts: Json[];
  try {
    contracts = await fetchContracts(input.buyerTaxId, since, deps.fetchJson);
  } catch {
    return { ok: false, reason: 'source_unavailable' };
  }
  const bySpend = aggregateDoContracts(contracts, since);
  const base = { tableVersion: UNSPSC_CLASSIFIER.tableVersion, sinceYear: since.slice(0, 4) };
  if (bySpend.length === 0) return { ok: true, suppliers: [], read: 0, outsideIndustry: 0, ...base };

  const [rnc, publicNames] = await Promise.all([deps.rncByRpe(bySpend.map((s) => s.rpe)), deps.publicEntityNames().catch(() => new Set<string>())]);
  const companies = bySpend.filter((s) => isDoCompanyRnc(rnc.get(s.rpe)) && !publicNames.has(normalizePublicEntityName(s.name)));

  const deadline = deps.nowMs() + DO_DGCP_CLASSIFY_BUDGET_MS;
  const suppliers: PublicBuyerSupplier[] = [];
  let read = 0;
  for (let i = 0; i < companies.length && read < DO_DGCP_MAX_CLASSIFIED; i += DO_DGCP_RUBRO_CONCURRENCY) {
    if (suppliers.length >= PUBLIC_BUYER_MAX_SUPPLIERS || deps.nowMs() > deadline) break;
    const batch = companies.slice(i, Math.min(i + DO_DGCP_RUBRO_CONCURRENCY, i + DO_DGCP_MAX_CLASSIFIED - read));
    const families = await Promise.all(
      batch.map(async (s) => {
        const cached = deps.cachedRubro?.(s.rpe);
        if (cached) return cached;
        try {
          const found = parseDoRubroFamilies(await deps.fetchJson(doUrls.rubro(s.rpe)));
          deps.rememberRubro?.(s.rpe, found);
          return found;
        } catch {
          return null;
        }
      }),
    );
    let failed = false;
    batch.forEach((s, j) => {
      if (families[j] === null) {
        failed = true;
        return;
      }
      read += 1;
      const macro = classifyDoRubro(families[j]!);
      if (!macro || macro.macroIndustryKey !== input.macroIndustryKey) return;
      suppliers.push({
        taxId: rnc.get(s.rpe)!,
        name: s.name,
        totalAmount: s.totalAmount,
        contractCount: s.contractCount,
        lastSignedAt: s.lastSignedAt,
        macroIndustryKey: macro.macroIndustryKey,
        macroShare: macro.share,
        rubro: macro.rubro,
        evidenceUrl: s.evidenceUrl,
      });
    });
    // Un error suele ser el límite de 60/min: no se insiste, se responde con lo que hay.
    if (failed) break;
  }
  return { ok: true, suppliers, read, outsideIndustry: read - suppliers.length, ...base };
}
