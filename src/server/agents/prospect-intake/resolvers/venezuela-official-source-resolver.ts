/**
 * SOURCES-VE-CLOSE-1 — RIF por nombre de Venezuela dentro de la corrida del Agente 1.
 *
 * Lee el registro unido de RIF (`ve_rif_registry`: emisoras y casas de bolsa de la
 * Bolsa de Caracas, sujetos regulados de la SUDEASEG y la SUNAVAL, GLEIF y webs
 * oficiales que muestran su RIF) y sus alias (`ve_rif_name_alias`), con las mismas
 * reglas conservadoras que Nicaragua y Panamá:
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      parte antes del guion o de la barra, con o sin «Venezuela», clave de entidad
 *      pública: `venezuelaCandidateNameVariants`). La PRIMERA variante con alguna
 *      fila decide. Cada variante es una igualdad exacta: nada difuso.
 *   2. UNA PALABRA. Un nombre de una sola palabra sin forma societaria («Digitel»,
 *      «Cemex»), o una variante de una palabra, sólo da un RIF fuerte si la web de
 *      la candidata lo confirma («digitel.com.ve» ↔ DIGITEL). Si no, queda como pista.
 *
 * Fuerte (`matched`, 0.85) sólo con UN RIF distinto. Varios → `low_confidence_match`
 * (pista, nunca llena las columnas fiscales). El resultado siempre dice
 * `ve_rif_registry`: el alias es otra forma de encontrar el mismo RIF.
 *
 * Tamaño: ninguna fuente venezolana alcanzable lo publica (el SENIAT no publica la
 * lista de contribuyentes especiales), así que el resultado no trae `workforce`.
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  hasVenezuelaLegalForm,
  isVenezuelaPublicEntityCore,
  venezuelaCandidateNameVariants,
  venezuelaNameCore,
  type VenezuelaNameVariant,
} from '@/server/source-catalog/connectors/ve-sources/ve-name-keys';
import { venezuelaSingleWordConfirmedByDomain } from '@/server/source-catalog/connectors/ve-sources/ve-domain';
import { VE_RIF_REGISTRY_SOURCE_KEY } from '@/server/source-catalog/connectors/ve-sources/ve-sources-rows';
import { canonicalVenezuelaRif } from '@/server/source-catalog/connectors/ve-sources/ve-sources-input';

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
} from '../source-enrichment';
import {
  SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
  SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
} from './snapshot-name-official-source-resolver';

/** Una fila del registro o de sus alias, reducida a lo que el resolvedor usa. */
export interface VenezuelaNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  /** `true` si la fila es un alias (`ve_rif_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (registro y alias) cuya clave guardada es `core`. Fail-soft. */
export type VenezuelaNameQuery = (core: string) => Promise<VenezuelaNameRow[]>;

export interface VenezuelaOfficialSourceResolverConfig {
  querySnapshots: VenezuelaNameQuery;
}

type Pick = { variant: VenezuelaNameVariant; rows: VenezuelaNameRow[] };

async function pickFirstVariantWithRows(variants: readonly VenezuelaNameVariant[], query: VenezuelaNameQuery): Promise<Pick | null> {
  for (const variant of variants) {
    const rows = await query(variant.core);
    const hits = rows.filter(
      (row) => row.normalizedLegalName?.trim() === variant.core && canonicalVenezuelaRif(row.taxId) !== null,
    );
    if (hits.length > 0) return { variant, rows: hits };
  }
  return null;
}

/** Un RIF, una fila: la razón social del registro (no la del alias). */
function distinctByRif(rows: readonly VenezuelaNameRow[]): VenezuelaNameRow[] {
  const groups = new Map<string, VenezuelaNameRow[]>();
  for (const row of rows) {
    const rif = canonicalVenezuelaRif(row.taxId)!;
    groups.set(rif, [...(groups.get(rif) ?? []), row]);
  }
  return [...groups.entries()].map(([taxId, group]) => ({
    ...(group.find((row) => row.alias !== true) ?? group[0]),
    taxId,
  }));
}

/** Construye el resolvedor de RIF por nombre de Venezuela. */
export function createVenezuelaOfficialSourceResolver(config: VenezuelaOfficialSourceResolverConfig): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'VE',
    sourceKey: VE_RIF_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'VE',
    sourceKey: VE_RIF_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'VE') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';
      const all = venezuelaCandidateNameVariants(name);
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

      const distinct = distinctByRif(pick.rows);
      const best = distinct[0];
      const base = {
        countryCode: 'VE',
        sourceKey: VE_RIF_REGISTRY_SOURCE_KEY,
        matchMethod: 'normalized_name' as const,
        taxIdentifier: best.taxId,
        taxIdentifierType: 'RIF',
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

      // Una palabra: el nombre del candidato (sin «Venezuela» añadido) es UNA palabra, o
      // la variante que encontró la fila lo es («Distribuidora de Venezuela» →
      // DISTRIBUIDORA). Sin forma societaria, sólo la web la confirma.
      const ownCore = venezuelaNameCore(name);
      const matchedOneWord = pick.variant.core.split(' ').length === 1;
      const singleWord = (ownCore.split(' ').length === 1 || matchedOneWord) && !hasVenezuelaLegalForm(name);
      const confirmWord = matchedOneWord ? pick.variant.core : ownCore;
      const domainConfirms =
        singleWord &&
        venezuelaSingleWordConfirmedByDomain(input.candidate.domain ?? input.candidate.websiteUrl ?? null, confirmWord, {
          publicEntity: isVenezuelaPublicEntityCore(venezuelaNameCore(best.legalName)),
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
      };
    },
  };
}
