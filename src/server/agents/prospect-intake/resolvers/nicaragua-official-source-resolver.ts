/**
 * SOURCES-NI-CLOSE-2 — RUC por nombre de Nicaragua dentro de la corrida del Agente 1.
 *
 * Lee el registro unido de RUC (`ni_ruc_registry`: Grandes Contribuyentes de la DGI
 * y licencias sanitarias del MINSA) y sus alias (`ni_ruc_name_alias`), con las
 * mismas reglas conservadoras que Panamá:
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      parte antes del guion o de la barra, con o sin «Nicaragua», clave de entidad
 *      pública: `nicaraguaCandidateNameVariants`). La PRIMERA variante con alguna
 *      fila decide. Cada variante es una igualdad exacta: nada difuso.
 *   2. UNA PALABRA. Un nombre de una sola palabra sin forma societaria («Cemex»,
 *      «Tropigas») sólo da un RUC fuerte si la web de la candidata lo confirma
 *      («cemex.com.ni» ↔ CEMEX). Si no, queda como pista.
 *
 * Fuerte (`matched`, 0.85) sólo con UN RUC distinto. Varios → `low_confidence_match`
 * (pista, nunca llena las columnas fiscales). El resultado siempre dice
 * `ni_ruc_registry`: el alias es otra forma de encontrar el mismo RUC.
 *
 * Tamaño: un Gran Contribuyente de la DGI viaja como `workforce` (tramo «gran
 * contribuyente», sin número de personas): queda en la ficha y no decide solo.
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  endsWithNicaraguaLegalForm,
  isNicaraguaPublicEntityCore,
  nicaraguaCandidateNameVariants,
  nicaraguaNameCore,
  type NicaraguaNameVariant,
} from '@/server/source-catalog/connectors/ni-sources/ni-name-keys';
import { nicaraguaSingleWordConfirmedByDomain } from '@/server/source-catalog/connectors/ni-sources/ni-domain';
import { canonicalNicaraguaRuc, NI_RUC_REGISTRY_SOURCE_KEY } from '@/server/source-catalog/connectors/ni-sources/ni-sources-rows';

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
export interface NicaraguaNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  /** Tramo «gran contribuyente» de la DGI, si lo hay. */
  workforce?: OfficialWorkforce | null;
  /** `true` si la fila es un alias (`ni_ruc_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (registro y alias) cuya clave guardada es `core`. Fail-soft. */
export type NicaraguaNameQuery = (core: string) => Promise<NicaraguaNameRow[]>;

export interface NicaraguaOfficialSourceResolverConfig {
  querySnapshots: NicaraguaNameQuery;
}

type Pick = { variant: NicaraguaNameVariant; rows: NicaraguaNameRow[] };

async function pickFirstVariantWithRows(variants: readonly NicaraguaNameVariant[], query: NicaraguaNameQuery): Promise<Pick | null> {
  for (const variant of variants) {
    const rows = await query(variant.core);
    const hits = rows.filter(
      (row) => row.normalizedLegalName?.trim() === variant.core && canonicalNicaraguaRuc(row.taxId) !== null,
    );
    if (hits.length > 0) return { variant, rows: hits };
  }
  return null;
}

/** Un RUC, una fila: la razón social del registro (no la del alias) y su tramo. */
function distinctByRuc(rows: readonly NicaraguaNameRow[]): NicaraguaNameRow[] {
  const groups = new Map<string, NicaraguaNameRow[]>();
  for (const row of rows) {
    const ruc = canonicalNicaraguaRuc(row.taxId)!;
    groups.set(ruc, [...(groups.get(ruc) ?? []), row]);
  }
  return [...groups.entries()].map(([taxId, group]) => ({
    ...(group.find((row) => row.alias !== true) ?? group[0]),
    taxId,
    workforce: group.find((row) => row.workforce)?.workforce ?? null,
  }));
}

/** Construye el resolvedor de RUC por nombre de Nicaragua. */
export function createNicaraguaOfficialSourceResolver(config: NicaraguaOfficialSourceResolverConfig): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'NI',
    sourceKey: NI_RUC_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'NI',
    sourceKey: NI_RUC_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'NI') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';
      const all = nicaraguaCandidateNameVariants(name);
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
        countryCode: 'NI',
        sourceKey: NI_RUC_REGISTRY_SOURCE_KEY,
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

      // Una palabra: el nombre del candidato (sin «Nicaragua» añadido) es UNA palabra.
      const ownCore = nicaraguaNameCore(name);
      const singleWord = ownCore.split(' ').length === 1 && !endsWithNicaraguaLegalForm(name);
      const domainConfirms =
        singleWord &&
        nicaraguaSingleWordConfirmedByDomain(input.candidate.domain ?? input.candidate.websiteUrl ?? null, ownCore, {
          publicEntity: isNicaraguaPublicEntityCore(nicaraguaNameCore(best.legalName)),
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
