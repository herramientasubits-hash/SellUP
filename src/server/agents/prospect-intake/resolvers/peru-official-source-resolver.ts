/**
 * SOURCES-PE-CLOSE-1 — RUC por nombre de Perú dentro de la corrida del Agente 1.
 *
 * Mismo contrato y mismas reglas conservadoras que el resolvedor genérico de
 * padrones (`snapshot-name-official-source-resolver.ts`), con dos diferencias:
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      nombre sin restos de la web, parte antes del guion, con o sin «del Perú»,
 *      clave de entidad pública: `peruCandidateNameVariants`) contra el padrón de
 *      SUNAT y sus alias (`pe_sunat_name_alias`). La PRIMERA variante con alguna
 *      fila decide; las siguientes no se miran. Cada variante es una igualdad
 *      exacta: no hay coincidencia difusa.
 *   2. UNA PALABRA. Un nombre de una sola palabra sin forma societaria («Rinti»,
 *      «LIMA») sólo da un RUC fuerte si la sociedad informa 50+ trabajadores. Medido
 *      el 06-10-2026: los aciertos de una palabra tenían de 67 a 5.702
 *      trabajadores; los falsos («LIMA» → LIMA S.A.C., «Pers» → PERS E.I.R.L.,
 *      «AQUALEP» → 3) no tenían o tenían menos. Con menos queda como pista.
 *
 * Fuerte (`matched`, 0.85) sólo con UN RUC distinto. Varios → `low_confidence_match`
 * (pista, nunca llena las columnas fiscales). El resultado siempre dice
 * `pe_sunat_registry`: el alias es una forma de encontrar la misma sociedad del
 * padrón, no otra fuente de identidad.
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  endsWithPeruLegalForm,
  peruCandidateNameVariants,
  PE_SINGLE_WORD_MIN_WORKERS,
  type PeruNameVariant,
} from '@/server/source-catalog/connectors/sunat-peru/pe-name-keys';

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

export const PERU_REGISTRY_SOURCE_KEY = 'pe_sunat_registry' as const;

/** RUC de sociedad (las personas naturales, RUC 10, nunca se ofrecen). */
const COMPANY_RUC = /^20\d{9}$/;

/** Una fila del padrón o de sus alias, reducida a lo que el resolvedor usa. */
export interface PeruNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  /** Trabajadores informados por SUNAT (si los hay). */
  workforce?: OfficialWorkforce | null;
  /** `true` si la fila es un alias (`pe_sunat_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (padrón y alias) cuya clave guardada es `core`. Fail-soft. */
export type PeruNameQuery = (core: string) => Promise<PeruNameRow[]>;

export interface PeruOfficialSourceResolverConfig {
  querySnapshots: PeruNameQuery;
}

type Pick = { variant: PeruNameVariant; rows: PeruNameRow[] };

/** Pide las variantes en orden y se queda con la primera que tenga alguna sociedad. */
async function pickFirstVariantWithRows(
  variants: readonly PeruNameVariant[],
  query: PeruNameQuery,
): Promise<Pick | null> {
  for (const variant of variants) {
    const rows = await query(variant.core);
    const hits = rows.filter(
      (row) => row.normalizedLegalName?.trim() === variant.core && COMPANY_RUC.test(row.taxId?.trim() ?? ''),
    );
    if (hits.length > 0) return { variant, rows: hits };
  }
  return null;
}

/**
 * Una sociedad por RUC. Se muestra la razón social del padrón (no la del alias) y
 * se conservan los trabajadores de cualquiera de sus filas.
 */
function distinctByRuc(rows: readonly PeruNameRow[]): PeruNameRow[] {
  const groups = new Map<string, PeruNameRow[]>();
  for (const row of rows) {
    const taxId = row.taxId!.trim();
    groups.set(taxId, [...(groups.get(taxId) ?? []), row]);
  }
  return [...groups.entries()].map(([taxId, group]) => {
    const shown = group.find((row) => row.alias !== true) ?? group[0];
    const workforce = group.find((row) => row.workforce)?.workforce ?? null;
    return { ...shown, taxId, workforce };
  });
}

/** Construye el resolvedor de RUC por nombre de Perú. */
export function createPeruOfficialSourceResolver(config: PeruOfficialSourceResolverConfig): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'PE',
    sourceKey: PERU_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'PE',
    sourceKey: PERU_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'PE') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';
      const variants = peruCandidateNameVariants(name).filter(
        (variant) =>
          !isNameTooGeneric(
            variant.core.toLowerCase().split(' ').filter((t) => t.length > 0),
            input.candidate.domain,
            input.candidate.websiteUrl,
          ),
      );
      const firstCore = peruCandidateNameVariants(name)[0]?.core ?? null;
      if (variants.length === 0) return notFound(firstCore);

      const pick = await pickFirstVariantWithRows(variants, config.querySnapshots);
      if (pick === null) return notFound(firstCore);

      const distinct = distinctByRuc(pick.rows);
      const best = distinct[0];
      const base = {
        countryCode: 'PE',
        sourceKey: PERU_REGISTRY_SOURCE_KEY,
        matchMethod: 'normalized_name' as const,
        taxIdentifier: best.taxId,
        taxIdentifierType: 'RUC',
        legalName: best.legalName || null,
        warnings: [],
        issues: [],
      };
      const metadata = {
        normalizedSearchName: pick.variant.core,
        nameVariant: pick.variant.origin,
        ...(best.alias === true ? { matchedAlias: true } : {}),
      };

      if (distinct.length > 1) {
        return {
          ...base,
          status: 'low_confidence_match',
          confidence: SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
          safeMetadata: { ...metadata, ambiguous: true, candidateCount: distinct.length },
        };
      }

      const singleWord = pick.variant.core.split(' ').length === 1 && !endsWithPeruLegalForm(name);
      const workers = best.workforce?.workers ?? null;
      if (singleWord && (workers === null || workers < PE_SINGLE_WORD_MIN_WORKERS)) {
        return {
          ...base,
          status: 'low_confidence_match',
          confidence: SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
          safeMetadata: { ...metadata, singleWordName: true },
        };
      }

      return {
        ...base,
        status: 'matched',
        confidence: SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
        safeMetadata: metadata,
        ...(best.workforce ? { workforce: { ...best.workforce } } : {}),
      };
    },
  };
}
