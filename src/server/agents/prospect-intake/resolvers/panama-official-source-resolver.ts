/**
 * SOURCES-PA-CLOSE-1 — RUC por nombre de Panamá dentro de la corrida del Agente 1.
 *
 * Lee el registro unido de RUC (`pa_ruc_registry`: proveedoras y entidades
 * compradoras de PanamaCompra y Grandes Contribuyentes de la DGI) y sus alias
 * (`pa_ruc_name_alias`), con las mismas reglas conservadoras que Guatemala:
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      parte antes del guion o de la barra, con o sin «Panamá», clave de entidad
 *      pública: `panamaCandidateNameVariants`). La PRIMERA variante con alguna
 *      fila decide. Cada variante es una igualdad exacta: nada difuso.
 *   2. UNA PALABRA. Un nombre de una sola palabra sin forma societaria
 *      («Banistmo», «Cochez», «IDAAN») sólo da un RUC fuerte si la web de la
 *      candidata lo confirma («banistmo.com» ↔ BANISTMO). Si no, queda como pista.
 *
 * Fuerte (`matched`, 0.85) sólo con UN RUC distinto. Varios → `low_confidence_match`
 * (pista, nunca llena las columnas fiscales). El resultado siempre dice
 * `pa_ruc_registry`: el alias es otra forma de encontrar el mismo RUC.
 *
 * Tamaño: un Gran Contribuyente de la DGI viaja como `workforce` (tramo «gran
 * contribuyente», sin número de personas): queda en la ficha y no decide solo.
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  endsWithPanamaLegalForm,
  isPanamaPublicEntityCore,
  panamaCandidateNameVariants,
  panamaNameCore,
  type PanamaNameVariant,
} from '@/server/source-catalog/connectors/panamacompra-pa/pa-name-keys';
import { panamaSingleWordConfirmedByDomain } from '@/server/source-catalog/connectors/panamacompra-pa/pa-domain';
import { canonicalPanamaRuc } from '@/server/source-catalog/connectors/panamacompra-pa/pa-ruc';
import { PA_RUC_REGISTRY_SOURCE_KEY } from '@/server/source-catalog/connectors/panamacompra-pa/pa-sources-rows';

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
export interface PanamaNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  /** Tramo «gran contribuyente» de la DGI, si lo hay. */
  workforce?: OfficialWorkforce | null;
  /** `true` si la fila es un alias (`pa_ruc_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (registro y alias) cuya clave guardada es `core`. Fail-soft. */
export type PanamaNameQuery = (core: string) => Promise<PanamaNameRow[]>;

export interface PanamaOfficialSourceResolverConfig {
  querySnapshots: PanamaNameQuery;
}

type Pick = { variant: PanamaNameVariant; rows: PanamaNameRow[] };

async function pickFirstVariantWithRows(variants: readonly PanamaNameVariant[], query: PanamaNameQuery): Promise<Pick | null> {
  for (const variant of variants) {
    const rows = await query(variant.core);
    const hits = rows.filter(
      (row) => row.normalizedLegalName?.trim() === variant.core && canonicalPanamaRuc(row.taxId) !== null,
    );
    if (hits.length > 0) return { variant, rows: hits };
  }
  return null;
}

/** Un RUC, una fila: la razón social del registro (no la del alias). */
function distinctByRuc(rows: readonly PanamaNameRow[]): PanamaNameRow[] {
  const groups = new Map<string, PanamaNameRow[]>();
  for (const row of rows) {
    const ruc = canonicalPanamaRuc(row.taxId)!;
    groups.set(ruc, [...(groups.get(ruc) ?? []), row]);
  }
  return [...groups.entries()].map(([taxId, group]) => ({
    ...(group.find((row) => row.alias !== true) ?? group[0]),
    taxId,
    workforce: group.find((row) => row.workforce)?.workforce ?? null,
  }));
}

/** Construye el resolvedor de RUC por nombre de Panamá. */
export function createPanamaOfficialSourceResolver(config: PanamaOfficialSourceResolverConfig): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'PA',
    sourceKey: PA_RUC_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'PA',
    sourceKey: PA_RUC_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'PA') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';
      const all = panamaCandidateNameVariants(name);
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
        countryCode: 'PA',
        sourceKey: PA_RUC_REGISTRY_SOURCE_KEY,
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

      // Una palabra: el nombre del candidato (sin «Panamá» añadido) es UNA palabra.
      const ownCore = panamaNameCore(name);
      const singleWord = ownCore.split(' ').length === 1 && !endsWithPanamaLegalForm(name);
      const domainConfirms =
        singleWord &&
        panamaSingleWordConfirmedByDomain(input.candidate.domain ?? input.candidate.websiteUrl ?? null, ownCore, {
          publicEntity: isPanamaPublicEntityCore(panamaNameCore(best.legalName)),
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
