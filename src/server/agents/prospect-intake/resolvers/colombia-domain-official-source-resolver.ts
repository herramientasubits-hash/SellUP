/**
 * colombia-domain-official-source-resolver.ts — Colombia: WEB → NIT con las
 * fuentes oficiales cargadas.
 *
 * SOURCES-CO-CLOSE-1. Medido el 06-10-2026 sobre 275 empresas colombianas sin NIT
 * en 30 días: 89 eran entidades públicas con dominio .gov.co/.edu.co/.mil.co cuya
 * razón social no se parece a su nombre de uso («Alcaldía de Ipiales» es
 * «Ipiales»), y muchas privadas usan una marca distinta de la razón social. Casi
 * todas llegan con su web, y la web sí coincide:
 *
 *   - `co_public_entities` — CHIP de la Contaduría (web publicada por la propia
 *     entidad) + servidores del SIGEP II, que viajan como tamaño oficial.
 *   - `co_siis` — la web cargada de las 10.000 empresas del SIIS (SECOP II y
 *     correo de Supersociedades, sólo si el dominio lleva el nombre).
 *
 * Reglas:
 *   - Primero el host exacto («guataqui.cundinamarca.gov.co» es Guataquí, no la
 *     Gobernación); sólo si no aparece, el dominio registrable («sed.narino.gov.co»
 *     es la Gobernación de Nariño: la secretaría comparte su NIT).
 *   - Un NIT ⇒ identidad fuerte. Varios NIT con la misma web (el municipio y su
 *     instituto de deportes) ⇒ gana el que lleva el mismo nombre que la candidata;
 *     si ninguno, la cabeza de la entidad (alcaldía, gobernación, ministerio) si es
 *     una sola; si no, sólo una pista para revisar.
 *   - Un dominio del Estado (.gov.co, .mil.co) nunca identifica a una empresa del
 *     SIIS, ni un dominio privado a una entidad pública por la vía del registrable.
 *
 * La lectura se INYECTA. Sólo lectura; cualquier error ⇒ `not_found`.
 */

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
  OfficialWorkforce,
} from '../source-enrichment';
import {
  coDomainLookupKeys,
  isColombianPublicSectorDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';
import { normalizeColombiaCompanyNameCore } from '@/server/source-catalog/connectors/personas-juridicas-cc-colombia/co-company-name-core';

export const CO_DOMAIN_RESOLVER_SOURCE_KEY = 'co_official_domain' as const;
export const CO_DOMAIN_MATCH_CONFIDENCE = 0.85 as const;
export const CO_DOMAIN_SIGNAL_CONFIDENCE = 0.6 as const;

/** Fila de una fuente oficial con web. */
export type CoDomainRow = {
  sourceKey: string;
  taxId: string | null;
  legalName: string | null;
  websiteDomain: string | null;
  /** Alcaldía, gobernación, ministerio… (sólo entidades públicas). */
  entityHead?: boolean;
  workforce?: OfficialWorkforce | null;
};

/** Lectura inyectada: filas cuyo `website_domain` es alguna de las llaves. */
export type CoDomainQuery = (domains: readonly string[]) => Promise<CoDomainRow[]>;

const VALID_NIT = /^[89]\d{8}$/;

/** Palabras que no distinguen a una entidad («Alcaldía Municipal de», «Gobernación del»). */
const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  'ALCALDIA', 'ALCALDIAS', 'MUNICIPAL', 'MUNICIPIO', 'MAYOR', 'DISTRITAL', 'DISTRITO', 'GOBERNACION',
  'DEPARTAMENTO', 'DEPARTAMENTAL', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'EN', 'COLOMBIA', 'DC',
  'ESPECIAL', 'TURISTICO', 'CULTURAL', 'HISTORICO', 'PORTUARIO', 'BIODIVERSO',
]);

/** Fichas distintivas del nombre (sin genéricas ni letras sueltas). */
export function distinctiveCoNameTokens(name: string | null | undefined): Set<string> {
  return new Set(
    normalizeColombiaCompanyNameCore(name)
      .split(' ')
      .filter((token) => token.length > 1 && !GENERIC_TOKENS.has(token)),
  );
}

function sameName(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || a.size !== b.size) return false;
  for (const token of a) if (!b.has(token)) return false;
  return true;
}

/** Elige la fila que identifica a la candidata entre las que comparten su web. */
export function pickCoDomainMatch(
  rows: readonly CoDomainRow[],
  candidateName: string | null | undefined,
): { row: CoDomainRow; strong: boolean; ambiguous: boolean } | null {
  const byNit = new Map<string, CoDomainRow>();
  for (const row of rows) {
    const nit = row.taxId?.trim() ?? '';
    if (!VALID_NIT.test(nit) || byNit.has(nit)) continue;
    byNit.set(nit, { ...row, taxId: nit });
  }
  const distinct = [...byNit.values()];
  if (distinct.length === 0) return null;
  if (distinct.length === 1) return { row: distinct[0], strong: true, ambiguous: false };

  const candidateTokens = distinctiveCoNameTokens(candidateName);
  const named = distinct.filter((row) => sameName(candidateTokens, distinctiveCoNameTokens(row.legalName)));
  if (named.length === 1) return { row: named[0], strong: true, ambiguous: false };

  const heads = distinct.filter((row) => row.entityHead === true);
  if (heads.length === 1) return { row: heads[0], strong: true, ambiguous: false };

  const best = [...distinct].sort((a, b) => (b.workforce?.workers ?? -1) - (a.workforce?.workers ?? -1))[0];
  return { row: best, strong: false, ambiguous: true };
}

function candidateHost(input: OfficialSourceResolverInput): string | null {
  return normalizeWebsiteHost(input.candidate.domain ?? null) ?? normalizeWebsiteHost(input.candidate.websiteUrl ?? null);
}

/** Construye el resolvedor por web de Colombia. */
export function createColombiaDomainOfficialSourceResolver(config: { queryByDomain: CoDomainQuery }): OfficialSourceResolver {
  const notFound = (host: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'CO',
    sourceKey: CO_DOMAIN_RESOLVER_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(host ? { safeMetadata: { domain: host } } : {}),
  });

  return {
    countryCode: 'CO',
    sourceKey: CO_DOMAIN_RESOLVER_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      return target === 'CO' && candidateHost(input) !== null;
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const host = candidateHost(input);
      if (host === null) return notFound(null);
      const keys = coDomainLookupKeys(host);
      let rows: CoDomainRow[];
      try {
        rows = await config.queryByDomain(keys);
      } catch {
        return notFound(host);
      }
      const publicHost = isColombianPublicSectorDomain(host);
      const usable = rows.filter((row) => {
        // Un dominio del Estado nunca identifica a una empresa del SIIS.
        if (publicHost && row.sourceKey === 'co_siis') return false;
        return typeof row.websiteDomain === 'string';
      });
      const exact = usable.filter((row) => row.websiteDomain === host);
      const pool = exact.length > 0 ? exact : usable;
      const pick = pickCoDomainMatch(pool, input.candidate.canonicalName);
      if (pick === null) return notFound(host);

      const { row, strong, ambiguous } = pick;
      return {
        status: strong ? 'matched' : 'low_confidence_match',
        countryCode: 'CO',
        sourceKey: row.sourceKey,
        confidence: strong ? CO_DOMAIN_MATCH_CONFIDENCE : CO_DOMAIN_SIGNAL_CONFIDENCE,
        matchMethod: 'domain',
        taxIdentifier: row.taxId,
        taxIdentifierType: 'NIT',
        legalName: row.legalName,
        warnings: [],
        issues: [],
        safeMetadata: {
          domain: host,
          matchedDomain: row.websiteDomain,
          ...(exact.length === 0 ? { viaRegistrableDomain: true } : {}),
          ...(ambiguous ? { ambiguous: true, candidateCount: new Set(pool.map((r) => r.taxId)).size } : {}),
        },
        ...(strong && row.workforce ? { workforce: { ...row.workforce } } : {}),
      };
    },
  };
}
