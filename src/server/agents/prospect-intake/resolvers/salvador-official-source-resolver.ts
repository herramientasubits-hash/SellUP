/**
 * SOURCES-SV-CLOSE-1 — NIT por nombre de El Salvador dentro de la corrida del Agente 1.
 *
 * Lee el registro unido de NIT (`sv_nit_registry`: Grandes Contribuyentes de la DGII
 * 2019, Grandes y Medianos 2012, Zonas Francas, entidades públicas y alcaldías 2014
 * de Hacienda; sin personas naturales) y sus alias (`sv_nit_name_alias`), con las
 * mismas reglas conservadoras que Honduras y Panamá:
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      parte antes del guion o de la barra, con o sin «(de) El Salvador», clave de
 *      entidad pública: `salvadorCandidateNameVariants`). La PRIMERA variante con
 *      alguna fila decide. Cada variante es una igualdad exacta: nada difuso.
 *   2. UNA PALABRA. Un nombre de una sola palabra sin forma societaria («Duralita»,
 *      «Freund», «ANDA») sólo da un NIT fuerte si la web de la candidata lo confirma
 *      («duralita.com» ↔ DURALITA). Si no, queda como pista.
 *
 * Fuerte (`matched`, 0.85) sólo con UN NIT distinto. Varios → `low_confidence_match`
 * (pista, nunca llena las columnas fiscales). El resultado siempre dice
 * `sv_nit_registry`: el alias es otra forma de encontrar el mismo NIT.
 *
 * Tamaño: un gran o mediano contribuyente viaja como `workforce` (tramo sin número
 * de personas, de una lista de 2019 o 2012): queda en la ficha y no decide solo.
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  endsWithSalvadorLegalForm,
  isSalvadorPublicEntityCore,
  salvadorCandidateNameVariants,
  salvadorNameCore,
  type SalvadorNameVariant,
} from '@/server/source-catalog/connectors/sv-official-sources/sv-name-keys';
import { salvadorSingleWordConfirmedByDomain } from '@/server/source-catalog/connectors/sv-official-sources/sv-domain';
import { normalizeSalvadoranNit } from '@/server/source-catalog/connectors/sv-official-sources/sv-nit';
import { SV_NIT_REGISTRY_SOURCE_KEY } from '@/server/source-catalog/connectors/sv-official-sources/sv-sources-rows';

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
export interface SalvadorNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  /** Tramo «gran / mediano contribuyente» de Hacienda, si lo hay. */
  workforce?: OfficialWorkforce | null;
  /** `true` si la fila es un alias (`sv_nit_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (registro y alias) cuya clave guardada es `core`. Fail-soft. */
export type SalvadorNameQuery = (core: string) => Promise<SalvadorNameRow[]>;

export interface SalvadorOfficialSourceResolverConfig {
  querySnapshots: SalvadorNameQuery;
}

type Pick = { variant: SalvadorNameVariant; rows: SalvadorNameRow[] };

async function pickFirstVariantWithRows(variants: readonly SalvadorNameVariant[], query: SalvadorNameQuery): Promise<Pick | null> {
  for (const variant of variants) {
    const rows = await query(variant.core);
    const hits = rows.filter(
      (row) => row.normalizedLegalName?.trim() === variant.core && normalizeSalvadoranNit(row.taxId) !== null,
    );
    if (hits.length > 0) return { variant, rows: hits };
  }
  return null;
}

/** Un NIT, una fila: la razón social del registro (no la del alias). */
function distinctByNit(rows: readonly SalvadorNameRow[]): SalvadorNameRow[] {
  const groups = new Map<string, SalvadorNameRow[]>();
  for (const row of rows) {
    const nit = normalizeSalvadoranNit(row.taxId)!;
    groups.set(nit, [...(groups.get(nit) ?? []), row]);
  }
  return [...groups.entries()].map(([taxId, group]) => ({
    ...(group.find((row) => row.alias !== true) ?? group[0]),
    taxId,
    workforce: group.find((row) => row.workforce)?.workforce ?? null,
  }));
}

/** Construye el resolvedor de NIT por nombre de El Salvador. */
export function createSalvadorOfficialSourceResolver(config: SalvadorOfficialSourceResolverConfig): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'SV',
    sourceKey: SV_NIT_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'SV',
    sourceKey: SV_NIT_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'SV') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';
      const all = salvadorCandidateNameVariants(name);
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

      const distinct = distinctByNit(pick.rows);
      const best = distinct[0];
      const base = {
        countryCode: 'SV',
        sourceKey: SV_NIT_REGISTRY_SOURCE_KEY,
        matchMethod: 'normalized_name' as const,
        taxIdentifier: best.taxId,
        taxIdentifierType: 'NIT',
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

      // Una palabra: el nombre del candidato (sin «El Salvador» añadido) es UNA palabra.
      const ownCore = salvadorNameCore(name);
      const singleWord = ownCore.split(' ').length === 1 && !endsWithSalvadorLegalForm(name);
      const domainConfirms =
        singleWord &&
        salvadorSingleWordConfirmedByDomain(input.candidate.domain ?? input.candidate.websiteUrl ?? null, ownCore, {
          publicEntity: isSalvadorPublicEntityCore(salvadorNameCore(best.legalName)),
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
