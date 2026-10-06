/**
 * co-public-entity-rows.ts — directorio de entidades públicas de Colombia, listo
 * para `source_company_snapshots` (`source_key = co_public_entities`).
 *
 * SOURCES-CO-CLOSE-1. Medido el 06-10-2026: de 275 empresas colombianas sin NIT en
 * 30 días, 89 eran entidades públicas (alcaldías, gobernaciones, E.S.E.,
 * ministerios). No están en las cámaras de comercio y su razón social oficial no
 * se parece a su nombre de uso (la Alcaldía de Ipiales figura como «Ipiales»). Dos
 * fuentes gratuitas de datos.gov.co las resuelven:
 *
 *   - CHIP de la Contaduría General (5c7g-ptic): NIT, nombre, municipio, correo y
 *     PÁGINA WEB de 4.419 entidades. La web es la llave: casi todas las candidatas
 *     públicas llegan con su dominio .gov.co.
 *   - Caracterización del Empleo Público, SIGEP II (h8rs-jxum, junio 2026): NIT,
 *     naturaleza jurídica y SERVIDORES por entidad (3.061 entidades). Es el tamaño.
 *
 * Una fila por NIT. Nunca se guardan correos ni personas: sólo el dominio.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import { normalizeColombiaCompanyNameCore } from '../personas-juridicas-cc-colombia/co-company-name-core';
import { emailDomain, isColombianInstitutionalDomain, isNonCorporateDomain, normalizeWebsiteHost } from './co-domain';

export const CO_PUBLIC_ENTITIES_SOURCE_KEY = 'co_public_entities' as const;
export const CO_PUBLIC_ENTITIES_SOURCE_YEAR = 2026;

/** Fila del CHIP tal como la publica datos.gov.co. */
export type ChipEntityRow = {
  a_o?: string;
  periodo?: string;
  nit?: string;
  razon_social?: string;
  ciudad?: string;
  departamento?: string;
  e_mail?: string;
  p_gina_web?: { url?: string } | string | null;
};

/** Fila del SIGEP II (Caracterización del Empleo Público). */
export type SigepEntityRow = {
  nit?: string;
  nombre_de_la_entidad?: string;
  naturaleza_jur_dica?: string;
  orden?: string;
  departamento?: string;
  municipio?: string;
  a_o?: string;
  mes?: string;
  genero_hombre?: string;
  genero_mujer?: string;
  genero_no_binario?: string;
};

/** Macro industria que se asigna a cada naturaleza jurídica (dueña, 06-10-2026: sólo Gobierno se ofrece). */
export type PublicEntityMacro = 'government' | 'health_pharma' | 'energy_mining_environment' | null;

const PERIOD_ORDER = ['ENERO-MARZO', 'ABRIL-JUNIO', 'JULIO-SEPTIEMBRE', 'OCTUBRE-DICIEMBRE'];

/** Caracteres de Windows-1252 en 0x80–0x9F (el resto coincide con Latin-1). */
const CP1252_BYTES: Readonly<Record<string, number>> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/**
 * El SIGEP publica el texto en UTF-8 leído como Latin-1/Windows-1252
 * («ALCALDÃ\u008dA», «GOBERNACIÃ“N»). Se recuperan los bytes y se vuelven a
 * leer como UTF-8; si no cuadra, el texto queda como venía.
 */
export function fixMojibake(text: string | null | undefined): string {
  if (typeof text !== 'string') return '';
  if (!/[ÃÂ]/.test(text)) return text.trim();
  try {
    const bytes = Uint8Array.from([...text].map((ch) => CP1252_BYTES[ch] ?? ch.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded.trim();
  } catch {
    return text.trim();
  }
}

/** Dígito de verificación del NIT (DIAN). */
export function nitCheckDigit(nit: string): string {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let sum = 0;
  const digits = [...nit].reverse();
  for (let i = 0; i < digits.length; i++) sum += Number(digits[i]) * weights[i];
  const rest = sum % 11;
  return String(rest < 2 ? rest : 11 - rest);
}

/**
 * NIT de persona jurídica (9 dígitos, empieza por 8 o 9) a partir de lo que
 * publique la fuente: «800099095:7», «800099095-7», «8000990957» (con el dígito
 * de verificación pegado, sólo si cuadra) o «800099095». Otra cosa ⇒ `null`.
 */
export function normalizeEntityNit(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const head = raw.trim().split(/[:\-\s]/)[0] ?? '';
  const digits = head.replace(/\D/g, '');
  if (/^[89]\d{8}$/.test(digits)) return digits;
  if (/^[89]\d{9}$/.test(digits) && nitCheckDigit(digits.slice(0, 9)) === digits[9]) return digits.slice(0, 9);
  return null;
}

function webOf(row: ChipEntityRow): string | null {
  const raw = typeof row.p_gina_web === 'string' ? row.p_gina_web : row.p_gina_web?.url;
  return normalizeWebsiteHost(raw ?? null);
}

/** Naturaleza jurídica (sin tildes, mayúsculas) → macro y si es cabeza de su entidad. */
export function classifyNaturaleza(naturaleza: string): { macro: PublicEntityMacro; head: boolean } {
  const n = naturaleza.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (n.includes('EMPRESAS SOCIALES DEL ESTADO')) return { macro: 'health_pharma', head: false };
  if (n.includes('SERVICIOS PUBLICOS')) return { macro: 'energy_mining_environment', head: false };
  if (n.includes('ENTE UNIVERSITARIO') || n.includes('ECONOMIA MIXTA') || n.includes('INDUSTRIALES Y COMERCIALES') || n.includes('SOCIEDADES PUBLICAS')) {
    return { macro: null, head: false };
  }
  const head = /^(ALCALDIA|GOBERNACION|MINISTERIO|DEPARTAMENTO ADMINISTRATIVO|SUPERINTENDENCIA|ORGANOS AUTONOMOS)/.test(n);
  return { macro: 'government', head };
}

/** ¿El nombre del CHIP es el de un municipio o departamento (su cabeza)? */
function chipNameIsTerritorialHead(name: string, city: string): boolean {
  const core = normalizeColombiaCompanyNameCore(name);
  const cityCore = normalizeColombiaCompanyNameCore(city);
  if (core === '') return false;
  if (/^DEPARTAMENTO (DE|DEL) /.test(core)) return true;
  // «Ipiales» en la ciudad IPIALES; «Granada - Meta» en GRANADA.
  return cityCore !== '' && (core === cityCore || core.startsWith(`${cityCore} `));
}

export type CoPublicEntitySnapshotRow = {
  source_key: typeof CO_PUBLIC_ENTITIES_SOURCE_KEY;
  country_code: 'CO';
  source_year: number;
  /** Vacío, como el resto de cargas: el CHECK de la tabla sólo admite períodos con formato fijo. */
  source_period: null;
  record_identity_key: string;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string | null;
  city: string | null;
  department: string | null;
  priority_score: number;
  raw_data: {
    website_domain: string | null;
    website_domain_source: 'chip_web' | 'chip_email' | null;
    workers: number | null;
    metrics_year: number | null;
    naturaleza: string | null;
    orden: string | null;
    macro_industry_key: PublicEntityMacro;
    entity_head: boolean;
    chip_name: string | null;
    sigep_name: string | null;
  };
};

type SigepAggregate = { name: string; naturaleza: string; orden: string | null; workers: number; head: boolean; macro: PublicEntityMacro; year: number | null };

/**
 * Nombre de la entidad en el SIGEP: arreglado y sin el número de orden que el
 * SIGEP pega a algunas («DIRECCION GENERAL DE LA POLICIA NACIONAL 1»).
 */
export function sigepEntityName(raw: string | null | undefined): string {
  return fixMojibake(raw).replace(/\s+\d{1,2}$/, '').trim();
}

function aggregateSigep(rows: Iterable<SigepEntityRow>): Map<string, SigepAggregate> {
  const out = new Map<string, SigepAggregate>();
  const best = new Map<string, number>();
  for (const row of rows) {
    const nit = normalizeEntityNit(row.nit);
    if (nit === null) continue;
    const workers =
      Number(row.genero_hombre ?? 0) + Number(row.genero_mujer ?? 0) + Number(row.genero_no_binario ?? 0);
    const safeWorkers = Number.isFinite(workers) && workers >= 0 ? Math.trunc(workers) : 0;
    const naturaleza = fixMojibake(row.naturaleza_jur_dica);
    const { macro, head } = classifyNaturaleza(naturaleza);
    const year = Number.isInteger(Number(row.a_o)) ? Number(row.a_o) : null;
    const current = out.get(nit);
    const total = (current?.workers ?? 0) + safeWorkers;
    // La fila «cabeza» (alcaldía, gobernación, ministerio…) da nombre y naturaleza;
    // si no hay, la de más servidores. Personería y concejo comparten el NIT.
    const rank = (head ? 1_000_000_000 : 0) + safeWorkers;
    if (current === undefined || rank > (best.get(nit) ?? -1)) {
      best.set(nit, rank);
      out.set(nit, { name: sigepEntityName(row.nombre_de_la_entidad), naturaleza, orden: row.orden?.trim() || null, workers: total, head, macro, year });
    } else {
      out.set(nit, { ...current, workers: total });
    }
  }
  return out;
}

function latestChipByNit(rows: Iterable<ChipEntityRow>): Map<string, ChipEntityRow> {
  const out = new Map<string, ChipEntityRow>();
  const keyOf = (row: ChipEntityRow) => Number(row.a_o ?? 0) * 10 + PERIOD_ORDER.indexOf(row.periodo ?? '');
  for (const row of rows) {
    const nit = normalizeEntityNit(row.nit);
    if (nit === null) continue;
    const previous = out.get(nit);
    if (previous === undefined || keyOf(row) > keyOf(previous)) out.set(nit, row);
  }
  return out;
}

/** Dominio de la entidad: su web; si no publica, su correo institucional (.gov.co…). */
function entityDomain(row: ChipEntityRow | undefined): { domain: string | null; source: 'chip_web' | 'chip_email' | null } {
  if (row === undefined) return { domain: null, source: null };
  const web = webOf(row);
  if (web !== null) return { domain: web, source: 'chip_web' };
  const mail = emailDomain(row.e_mail);
  if (mail !== null && !isNonCorporateDomain(mail) && isColombianInstitutionalDomain(mail)) {
    return { domain: mail, source: 'chip_email' };
  }
  return { domain: null, source: null };
}

/**
 * CHIP + SIGEP → una fila por NIT. Entra toda entidad que esté en alguna de las
 * dos fuentes: las que no tienen servidores en el SIGEP sirven igual para
 * encontrar el NIT por la web, pero nunca se ofrecen en el buscador (sin tamaño).
 */
export function buildCoPublicEntityRows(
  chipRows: Iterable<ChipEntityRow>,
  sigepRows: Iterable<SigepEntityRow>,
): CoPublicEntitySnapshotRow[] {
  const chip = latestChipByNit(chipRows);
  const sigep = aggregateSigep(sigepRows);
  const nits = [...new Set([...chip.keys(), ...sigep.keys()])].sort();
  const out: CoPublicEntitySnapshotRow[] = [];
  for (const nit of nits) {
    const c = chip.get(nit);
    const s = sigep.get(nit);
    const chipName = c?.razon_social?.trim() || null;
    const legalName = s?.name || chipName;
    if (!legalName) continue;
    const normalized = normalizeColombiaCompanyNameCore(legalName);
    if (normalized === '') continue;
    const { domain, source } = entityDomain(c);
    const chipHead = chipName !== null && chipNameIsTerritorialHead(chipName, c?.ciudad ?? '');
    const macro: PublicEntityMacro = s ? s.macro : chipHead ? 'government' : null;
    out.push({
      source_key: CO_PUBLIC_ENTITIES_SOURCE_KEY,
      country_code: 'CO',
      source_year: CO_PUBLIC_ENTITIES_SOURCE_YEAR,
      source_period: null,
      record_identity_key: `tax:${nit}`,
      tax_id: nit,
      normalized_tax_id: nit,
      legal_name: legalName,
      normalized_legal_name: normalized,
      sector: s?.naturaleza || null,
      city: c?.ciudad?.trim() || null,
      department: c?.departamento?.trim() || null,
      priority_score: s?.workers ?? 0,
      raw_data: {
        website_domain: domain,
        website_domain_source: source,
        workers: s ? s.workers : null,
        metrics_year: s ? s.year : null,
        naturaleza: s?.naturaleza || null,
        orden: s?.orden ?? null,
        macro_industry_key: macro,
        entity_head: (s?.head ?? false) || chipHead,
        chip_name: chipName,
        sigep_name: s?.name || null,
      },
    });
  }
  return out;
}
