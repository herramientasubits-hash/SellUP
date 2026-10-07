/**
 * SOURCES-PY-CLOSE-1 — RUC por nombre de Paraguay dentro de la corrida del Agente 1.
 *
 * Mismas reglas conservadoras que Perú (`peru-official-source-resolver.ts`):
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      nombre sin restos de la web, parte antes del guion o del paréntesis, con o
 *      sin «de/del Paraguay», clave de entidad pública:
 *      `paraguayCandidateNameVariants`) contra el padrón de la DNIT y sus alias
 *      (`py_set_name_alias`). La PRIMERA variante con alguna fila decide. Cada
 *      variante es una igualdad exacta: no hay coincidencia difusa.
 *   2. UNA PALABRA. Un nombre de una sola palabra sin forma societaria («Bancard»,
 *      «Pilar», «Retail») sólo da un RUC fuerte si la web de la candidata lo
 *      confirma («bancard.com.py» ↔ BANCARD) o si la sociedad informa 50+
 *      trabajadores. Si no, queda como pista: «Pilar» (la marca de Manufactura de
 *      Pilar) coincidía con PILAR S.A., otra sociedad.
 *
 * Fuerte (`matched`, 0.85) sólo con UN RUC distinto. Varios → `low_confidence_match`
 * (pista, nunca llena las columnas fiscales). El resultado siempre dice
 * `py_set_registry`: el alias es otra forma de encontrar la misma sociedad.
 *
 * Tamaño: si la sociedad declaró su tamaño MIPYME a la DNCP, viaja como
 * `workforce` (tramo) para el filtro de tamaño del Agente 1.
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  endsWithParaguayLegalForm,
  isParaguayPublicEntityCore,
  paraguayCandidateNameVariants,
  paraguayNameCore,
  PY_SINGLE_WORD_MIN_WORKERS,
  type ParaguayNameVariant,
} from '@/server/source-catalog/connectors/set-paraguay/py-name-keys';
import { paraguaySingleWordConfirmedByDomain } from '@/server/source-catalog/connectors/set-paraguay/py-domain';

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

export const PARAGUAY_REGISTRY_SOURCE_KEY = 'py_set_registry' as const;

/** RUC de sociedad con dígito verificador (las personas físicas nunca se ofrecen). */
const COMPANY_RUC = /^80\d{6}-\d$/;

/** Una fila del padrón o de sus alias, reducida a lo que el resolvedor usa. */
export interface ParaguayNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  /** Tamaño declarado (tramo MIPYME de la DNCP), si lo hay. */
  workforce?: OfficialWorkforce | null;
  /** `true` si la fila es un alias (`py_set_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (padrón y alias) cuya clave guardada es `core`. Fail-soft. */
export type ParaguayNameQuery = (core: string) => Promise<ParaguayNameRow[]>;

export interface ParaguayOfficialSourceResolverConfig {
  querySnapshots: ParaguayNameQuery;
}

type Pick = { variant: ParaguayNameVariant; rows: ParaguayNameRow[] };

async function pickFirstVariantWithRows(
  variants: readonly ParaguayNameVariant[],
  query: ParaguayNameQuery,
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

/** Una sociedad por RUC: la razón social del padrón (no la del alias) y su tamaño. */
function distinctByRuc(rows: readonly ParaguayNameRow[]): ParaguayNameRow[] {
  const groups = new Map<string, ParaguayNameRow[]>();
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

/** Construye el resolvedor de RUC por nombre de Paraguay. */
export function createParaguayOfficialSourceResolver(
  config: ParaguayOfficialSourceResolverConfig,
): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'PY',
    sourceKey: PARAGUAY_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'PY',
    sourceKey: PARAGUAY_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'PY') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';
      const all = paraguayCandidateNameVariants(name);
      const variants = all.filter(
        (variant) =>
          !isNameTooGeneric(
            variant.core.toLowerCase().split(' ').filter((t) => t.length > 0),
            input.candidate.domain,
            input.candidate.websiteUrl,
          ),
      );
      const firstCore = all[0]?.core ?? null;
      if (variants.length === 0) return notFound(firstCore);

      const pick = await pickFirstVariantWithRows(variants, config.querySnapshots);
      if (pick === null) return notFound(firstCore);

      const distinct = distinctByRuc(pick.rows);
      const best = distinct[0];
      const base = {
        countryCode: 'PY',
        sourceKey: PARAGUAY_REGISTRY_SOURCE_KEY,
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

      const singleWord = pick.variant.core.split(' ').length === 1 && !endsWithParaguayLegalForm(name);
      const workers = best.workforce?.workers ?? null;
      const domainConfirms =
        singleWord &&
        paraguaySingleWordConfirmedByDomain(
          input.candidate.domain ?? input.candidate.websiteUrl ?? null,
          pick.variant.core,
          { publicEntity: isParaguayPublicEntityCore(paraguayNameCore(best.legalName)) },
        );
      if (singleWord && !domainConfirms && (workers === null || workers < PY_SINGLE_WORD_MIN_WORKERS)) {
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
        safeMetadata: domainConfirms ? { ...metadata, singleWordConfirmedByDomain: true } : metadata,
        ...(best.workforce ? { workforce: { ...best.workforce } } : {}),
      };
    },
  };
}
