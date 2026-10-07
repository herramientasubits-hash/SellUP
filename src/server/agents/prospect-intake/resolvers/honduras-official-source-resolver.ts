/**
 * SOURCES-HN-CLOSE-1 — RTN por nombre de Honduras dentro de la corrida del Agente 1.
 *
 * Lee el registro de RTN de personas jurídicas proveedoras del Estado
 * (`hn_ocds_rtn_registry`: ONCAE / HonduCompras + SEFIN / SIAFI, OCDS 2018-2026) y
 * sus alias (`hn_rtn_name_alias`), con las mismas reglas conservadoras que
 * Guatemala y Paraguay:
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      parte antes del guion o de la barra, con o sin «(de) Honduras» y con
 *      «Hondureña», clave de entidad pública: `hondurasCandidateNameVariants`). La
 *      PRIMERA variante con alguna fila decide. Cada variante es una igualdad exacta.
 *   2. UNA PALABRA. Un nombre de una sola palabra sin forma societaria
 *      («Lacthosa», «Hondutel») sólo da un RTN fuerte si la web de la candidata lo
 *      confirma («lacthosa.com» ↔ LACTHOSA). Si no, queda como pista.
 *
 * Fuerte (`matched`, 0.85) sólo con UN RTN distinto. Varios → `low_confidence_match`
 * (pista, nunca llena las columnas fiscales). El resultado siempre dice
 * `hn_ocds_rtn_registry`: el alias es otra forma de encontrar el mismo RTN.
 *
 * TAMAÑO: si HonduCompras marcó a la empresa como «*MIPYME*» en los últimos años, el
 * resultado lleva ese tramo (hasta 150 personas) y el filtro de tamaño la descarta
 * (aprobado por la dueña el 07-10-2026). Lo grande no se marca: no hay fuente.
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  endsWithHondurasLegalForm,
  hondurasCandidateNameVariants,
  hondurasNameCore,
  isHondurasPublicEntityCore,
  type HondurasNameVariant,
} from '@/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-name-keys';
import { hondurasSingleWordConfirmedByDomain } from '@/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-domain';
import {
  HN_OCDS_RTN_SOURCE_KEY,
  normalizeHondurasJuridicalRtn,
} from '@/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-rtn-registry-rows';

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

/** Una fila del registro o de sus alias, reducida a lo que el resolvedor usa. */
export interface HondurasNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  /** Tramo MIPYME declarado en HonduCompras, si lo hay. */
  workforce?: OfficialWorkforce | null;
  /** `true` si la fila es un alias (`hn_rtn_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (registro y alias) cuya clave guardada es `core`. Fail-soft. */
export type HondurasNameQuery = (core: string) => Promise<HondurasNameRow[]>;

export interface HondurasOfficialSourceResolverConfig {
  querySnapshots: HondurasNameQuery;
}

type Pick = { variant: HondurasNameVariant; rows: HondurasNameRow[] };

async function pickFirstVariantWithRows(
  variants: readonly HondurasNameVariant[],
  query: HondurasNameQuery,
): Promise<Pick | null> {
  for (const variant of variants) {
    const rows = await query(variant.core);
    const hits = rows.filter(
      (row) => row.normalizedLegalName?.trim() === variant.core && normalizeHondurasJuridicalRtn(row.taxId) !== null,
    );
    if (hits.length > 0) return { variant, rows: hits };
  }
  return null;
}

/** Un RTN, una fila: la razón social del registro (no la del alias) y su tramo. */
function distinctByRtn(rows: readonly HondurasNameRow[]): HondurasNameRow[] {
  const groups = new Map<string, HondurasNameRow[]>();
  for (const row of rows) {
    const rtn = normalizeHondurasJuridicalRtn(row.taxId)!;
    groups.set(rtn, [...(groups.get(rtn) ?? []), row]);
  }
  return [...groups.entries()].map(([taxId, group]) => {
    const shown = group.find((row) => row.alias !== true) ?? group[0];
    const workforce = group.find((row) => row.workforce)?.workforce ?? null;
    return { ...shown, taxId, workforce };
  });
}

/** Construye el resolvedor de RTN por nombre de Honduras. */
export function createHondurasOfficialSourceResolver(
  config: HondurasOfficialSourceResolverConfig,
): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'HN',
    sourceKey: HN_OCDS_RTN_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'HN',
    sourceKey: HN_OCDS_RTN_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'HN') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';
      const all = hondurasCandidateNameVariants(name);
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

      const distinct = distinctByRtn(pick.rows);
      const best = distinct[0];
      const base = {
        countryCode: 'HN',
        sourceKey: HN_OCDS_RTN_SOURCE_KEY,
        matchMethod: 'normalized_name' as const,
        taxIdentifier: best.taxId,
        taxIdentifierType: 'RTN',
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

      // Una palabra: el nombre del candidato (sin «de Honduras» añadido) es UNA palabra.
      const ownCore = hondurasNameCore(name);
      const singleWord = ownCore.split(' ').length === 1 && !endsWithHondurasLegalForm(name);
      const domainConfirms =
        singleWord &&
        hondurasSingleWordConfirmedByDomain(input.candidate.domain ?? input.candidate.websiteUrl ?? null, ownCore, {
          publicEntity: isHondurasPublicEntityCore(hondurasNameCore(best.legalName)),
        });
      if (singleWord && !domainConfirms) {
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
