/**
 * SOURCES-BR-LIGHT-1 — CNPJ por nombre de Brasil dentro de la corrida del Agente 1.
 *
 * ── Reglas (medidas el 13-10-2026 con 100 grandes brasileñas) ───────────────
 *
 *   1. NOMBRE. Las variantes del nombre (`brazilCandidateNameVariants`: núcleo,
 *      parte antes del guion, sin «Grupo», sin «Brasil», clave pública) se buscan
 *      en el registro y sus alias (nome fantasia, nombre comercial de la CVM). La
 *      PRIMERA variante con filas decide:
 *        - si la web de la candidata tiene la misma etiqueta que la web de una de
 *          esas empresas («ambev.com.br» ↔ AMBEV S.A.), es esa (la cotizada si hay
 *          varias del grupo; si no, la de más capital, si es grande);
 *        - si hay UN solo CNPJ y su web no contradice la de la candidata: fuerte
 *          cuando es grande (capital ≥ R$ 10 M o 10+ sucursales) o, si la
 *          candidata no trae web, cuando el nombre tiene dos o más palabras;
 *        - si hay varios y la candidata NO tiene web, fuerte sólo si UNO es grande.
 *   2. DOMINIO. Si el nombre no dio un CNPJ fuerte y la candidata tiene web, se
 *      busca por la etiqueta del dominio («@bradesco»): entre las empresas grandes
 *      con esa web cuyo nombre CONTIENE el de la candidata, fuerte si hay una sola
 *      (o una sola cotizada en la CVM). «Petrobras» → PETROLEO BRASILEIRO S A
 *      PETROBRAS. Varias del mismo grupo → pista.
 *
 * Fuerte = `matched`. Todo lo demás = `low_confidence_match` (pista: nunca llena
 * las columnas fiscales). Con estas reglas: ~60 de 100 con CNPJ y ~10 de ellas en
 * otra empresa del mismo grupo; por eso una empresa del grupo con la misma web y
 * el nombre contenido NUNCA es fuerte si hay dos.
 *
 * Tamaño: el porte de la Receita viaja como `workforce` (ME/EPP descartan; DEMAIS
 * no decide).
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. Las lecturas llegan INYECTADAS.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  brazilCandidateNameVariants,
  brazilCoreContainsWords,
  type BrazilNameVariant,
} from '@/server/source-catalog/connectors/receita-brasil/br-name-keys';
import {
  brazilDomainLabelsAgree,
  brazilDomainLookupKey,
} from '@/server/source-catalog/connectors/receita-brasil/br-domain';
import { normalizeBrazilCnpj } from '@/server/source-catalog/connectors/br-receita-cnpj/br-cnpj';

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
  OfficialWorkforce,
} from '../source-enrichment';
import {
  SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
  SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
} from './snapshot-name-official-source-resolver';

export const BRAZIL_REGISTRY_SOURCE_KEY = 'br_receita_registry' as const;

/** Capital o sucursales desde los que una empresa cuenta como «grande». */
const LARGE_CAPITAL_BRL = 10_000_000;
const LARGE_ACTIVE_BRANCHES = 10;

/** Una fila del registro, de sus alias o de sus claves de dominio, reducida a lo que se usa. */
export interface BrazilSnapshotRow {
  taxId: string | null;
  legalName: string | null;
  /** La clave guardada (núcleo, alias o «@etiqueta»). */
  normalizedLegalName: string | null;
  /** Núcleo de la razón social cuando la fila es un alias o una clave de dominio. */
  registryCore: string | null;
  websiteDomain: string | null;
  capital: number | null;
  activeBranches: number | null;
  cvmListed: boolean;
  /** Ente público (naturaleza 1xxx): alcaldías, estados, ministerios, universidades. */
  publicEntity?: boolean;
  workforce?: OfficialWorkforce | null;
}

/** Lecturas inyectadas (fail-soft): por clave de nombre y por clave de dominio. */
export interface BrazilSnapshotReads {
  byName: (core: string) => Promise<BrazilSnapshotRow[]>;
  byDomainKey: (key: string) => Promise<BrazilSnapshotRow[]>;
}

export interface BrazilOfficialSourceResolverConfig {
  reads: BrazilSnapshotReads;
}

type Company = BrazilSnapshotRow & { taxId: string };

function isLarge(row: BrazilSnapshotRow): boolean {
  return (row.capital ?? 0) >= LARGE_CAPITAL_BRL || (row.activeBranches ?? 0) >= LARGE_ACTIVE_BRANCHES;
}

/**
 * Un ente público con nombre ÚNICO cuenta como una empresa grande: no tiene
 * capital («MUNICIPIO DE SAO PAULO» declara 0). Los municipios homónimos de
 * distintos estados siguen siendo varios CNPJ ⇒ pista salvo que la web desempate.
 */
function isLargeOrPublic(row: BrazilSnapshotRow): boolean {
  return isLarge(row) || row.publicEntity === true;
}

/** Una empresa por CNPJ: la razón social del registro, su web, capital y tamaño de cualquier fila. */
function distinctByCnpj(rows: readonly BrazilSnapshotRow[]): Company[] {
  const groups = new Map<string, BrazilSnapshotRow[]>();
  for (const row of rows) {
    const cnpj = normalizeBrazilCnpj(row.taxId ?? '');
    if (cnpj.status !== 'valid' || cnpj.normalized === null) continue;
    groups.set(cnpj.normalized, [...(groups.get(cnpj.normalized) ?? []), row]);
  }
  return [...groups.entries()].map(([taxId, group]) => ({
    ...group[0],
    taxId,
    websiteDomain: group.find((r) => r.websiteDomain)?.websiteDomain ?? null,
    capital: Math.max(...group.map((r) => r.capital ?? 0)),
    activeBranches: Math.max(...group.map((r) => r.activeBranches ?? 0)),
    cvmListed: group.some((r) => r.cvmListed),
    publicEntity: group.some((r) => r.publicEntity === true),
    workforce: group.find((r) => r.workforce)?.workforce ?? null,
  }));
}

/** Entre varias empresas del mismo grupo, la única cotizada; si no, la de más capital si es grande. */
function pickWithinGroup(companies: readonly Company[]): Company | null {
  if (companies.length === 1) return companies[0];
  const listed = companies.filter((c) => c.cvmListed);
  if (listed.length === 1) return listed[0];
  const sorted = [...companies].sort((a, b) => (b.capital ?? 0) - (a.capital ?? 0));
  return isLarge(sorted[0]) && (sorted[0].capital ?? 0) > (sorted[1].capital ?? 0) ? sorted[0] : null;
}

type Decision = { company: Company; strong: boolean; via: string; candidateCount: number };

function decideByName(companies: readonly Company[], core: string, candidateDomain: string | null): Decision {
  const best = [...companies].sort((a, b) => (b.capital ?? 0) - (a.capital ?? 0))[0];
  const weak = (via: string): Decision => ({ company: best, strong: false, via, candidateCount: companies.length });

  if (candidateDomain !== null) {
    const agree = companies.filter((c) => brazilDomainLabelsAgree(c.websiteDomain, candidateDomain));
    if (agree.length > 0) {
      const picked = pickWithinGroup(agree);
      return picked !== null
        ? { company: picked, strong: true, via: 'name_and_domain', candidateCount: companies.length }
        : weak('name_and_domain_group');
    }
  }
  const conflicts = (c: Company): boolean =>
    candidateDomain !== null && c.websiteDomain !== null && !brazilDomainLabelsAgree(c.websiteDomain, candidateDomain);

  if (companies.length === 1) {
    const only = companies[0];
    if (conflicts(only)) return weak('domain_conflict');
    // «Casas Bahia» (casasbahia.com.br) caía en una distribuidora chica sin web que
    // usaba ese nome fantasia: con web en la candidata, una pequeña sin web es pista.
    const multiWordWithoutWebs = core.split(' ').length >= 2 && candidateDomain === null;
    return isLargeOrPublic(only) || multiWordWithoutWebs
      ? { company: only, strong: true, via: 'unique_name', candidateCount: 1 }
      : weak('single_word_small');
  }
  if (candidateDomain === null) {
    const large = companies.filter(isLarge);
    if (large.length === 1) return { company: large[0], strong: true, via: 'unique_large', candidateCount: companies.length };
  }
  return weak('ambiguous');
}

function decideByDomain(rows: readonly BrazilSnapshotRow[], core: string): Decision | null {
  const companies = distinctByCnpj(rows).filter(isLarge);
  const firstWord = core.split(' ')[0] ?? '';
  const contains = (c: Company): boolean => {
    const names = [c.registryCore, c.normalizedLegalName].filter((n): n is string => typeof n === 'string');
    return names.some(
      (n) => brazilCoreContainsWords(n, core) || (firstWord.length >= 4 && brazilCoreContainsWords(n, firstWord)),
    );
  };
  const pool = companies.filter(contains);
  if (pool.length === 0) return null;
  // Dentro del grupo: la única cotizada; si no, el único nombre idéntico; si no, la
  // única que contiene el nombre. «Empieza igual» NO cuenta: elegía filiales
  // (BRADESCO COMERCIALIZADORA, USIMINAS PARTICIPACOES).
  const listed = pool.filter((c) => c.cvmListed);
  const exact = pool.filter((c) => c.registryCore === core);
  const picked = listed.length === 1 ? listed[0] : exact.length === 1 ? exact[0] : pool.length === 1 ? pool[0] : null;
  if (picked !== null) return { company: picked, strong: true, via: 'domain_and_name', candidateCount: pool.length };
  const best = [...pool].sort((a, b) => (b.capital ?? 0) - (a.capital ?? 0))[0];
  return { company: best, strong: false, via: 'domain_group', candidateCount: pool.length };
}

async function firstVariantWithRows(
  variants: readonly BrazilNameVariant[],
  read: BrazilSnapshotReads['byName'],
): Promise<{ variant: BrazilNameVariant; companies: Company[] } | null> {
  for (const variant of variants) {
    const rows = (await read(variant.core)).filter((r) => r.normalizedLegalName?.trim() === variant.core);
    const companies = distinctByCnpj(rows);
    if (companies.length > 0) return { variant, companies };
  }
  return null;
}

/** Construye el resolvedor de CNPJ por nombre de Brasil. */
export function createBrazilOfficialSourceResolver(config: BrazilOfficialSourceResolverConfig): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'BR',
    sourceKey: BRAZIL_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  const toResult = (decision: Decision, metadata: Record<string, unknown>): OfficialSourceEnrichmentResult => {
    const { company } = decision;
    const base = {
      countryCode: 'BR',
      sourceKey: BRAZIL_REGISTRY_SOURCE_KEY,
      matchMethod: 'normalized_name' as const,
      taxIdentifier: company.taxId,
      taxIdentifierType: 'CNPJ',
      legalName: company.legalName || null,
      warnings: [],
      issues: [],
    };
    const safeMetadata = { ...metadata, cnpjVia: decision.via, candidateCount: decision.candidateCount };
    if (!decision.strong) {
      return { ...base, status: 'low_confidence_match', confidence: SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE, safeMetadata };
    }
    return {
      ...base,
      status: 'matched',
      confidence: SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
      safeMetadata,
      ...(company.workforce ? { workforce: { ...company.workforce } } : {}),
    };
  };

  return {
    countryCode: 'BR',
    sourceKey: BRAZIL_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'BR') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 2);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';
      const candidateDomain = input.candidate.domain ?? input.candidate.websiteUrl ?? null;
      const all = brazilCandidateNameVariants(name);
      const firstCore = all[0]?.core ?? null;
      const variants = all.filter(
        (variant) =>
          !isNameTooGeneric(
            variant.core.toLowerCase().split(' ').filter((t) => t.length > 0),
            input.candidate.domain,
            input.candidate.websiteUrl,
          ),
      );
      if (variants.length === 0 || firstCore === null) return notFound(firstCore);

      const byName = await firstVariantWithRows(variants, config.reads.byName);
      const nameDecision = byName ? decideByName(byName.companies, byName.variant.core, candidateDomain) : null;
      const nameMetadata = byName ? { normalizedSearchName: byName.variant.core, nameVariant: byName.variant.origin } : {};
      if (nameDecision?.strong) return toResult(nameDecision, nameMetadata);

      const domainKey = brazilDomainLookupKey(candidateDomain);
      if (domainKey !== null) {
        const domainDecision = decideByDomain(await config.reads.byDomainKey(domainKey), firstCore);
        if (domainDecision !== null && (domainDecision.strong || nameDecision === null)) {
          return toResult(domainDecision, { normalizedSearchName: firstCore, domainKey });
        }
      }
      return nameDecision !== null ? toResult(nameDecision, nameMetadata) : notFound(firstCore);
    },
  };
}
