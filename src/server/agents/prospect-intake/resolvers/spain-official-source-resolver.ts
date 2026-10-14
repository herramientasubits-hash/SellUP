/**
 * SOURCES-ES-CLOSE-1 — NIF por nombre de España dentro de la corrida del Agente 1.
 *
 * Lee los registros de NIF de sociedades (`es_placsp_registry`: adjudicatarias de la
 * Plataforma de Contratación; `es_official_nif_registry`: beneficiarias de ayudas de
 * Estado de la BDNS, entes de INVENTE y bancos del Banco de España) y sus alias
 * (`es_nif_name_alias`), con las mismas reglas conservadoras que Honduras:
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      parte antes del guion o de la barra, con o sin «(de) España» y con «Spain»,
 *      clave de entidad pública: `spainCandidateNameVariants`). La PRIMERA variante
 *      con alguna fila decide. Cada variante es una igualdad exacta.
 *   2. UNA PALABRA. Un nombre de una sola palabra sin forma societaria («Mapfre»,
 *      «Iberdrola») sólo da un NIF fuerte si la web de la candidata lo confirma
 *      («mapfre.com» ↔ MAPFRE). Si no, queda como pista.
 *
 * Fuerte (`matched`, 0.85) sólo con UN NIF distinto. Varios → `low_confidence_match`
 * (pista, nunca llena las columnas fiscales). El resultado dice
 * `es_placsp_registry` u `es_official_nif_registry` según de dónde sale la razón
 * social; el alias es otra forma de encontrar el mismo NIF.
 *
 * TAMAÑO: la plantilla de INVENTE (número exacto) o «GRAN EMPRESA» de la BDNS (tramo
 * sin piso ni techo: queda en la ficha y no decide solo).
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  endsWithSpainLegalForm,
  spainCandidateNameVariants,
  spainNameCore,
  spainPublicEntityKey,
  type SpainNameVariant,
} from '@/server/source-catalog/connectors/placsp-spain/es-name-keys';
import { spainSingleWordConfirmedByDomain } from '@/server/source-catalog/connectors/placsp-spain/es-domain';
import {
  ES_PLACSP_REGISTRY_SOURCE_KEY,
  normalizeSpainCompanyNif,
} from '@/server/source-catalog/connectors/placsp-spain/es-placsp-registry-rows';

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

/** Una fila de un registro o de sus alias, reducida a lo que el resolvedor usa. */
export interface SpainNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  /** Clave de la fuente de la que sale la razón social (registro, no alias). */
  sourceKey?: string | null;
  /** Plantilla de INVENTE o «GRAN EMPRESA» de la BDNS, si lo hay. */
  workforce?: OfficialWorkforce | null;
  /** `true` si la fila es un alias (`es_nif_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (registros y alias) cuya clave guardada es `core`. Fail-soft. */
export type SpainNameQuery = (core: string) => Promise<SpainNameRow[]>;

export interface SpainOfficialSourceResolverConfig {
  querySnapshots: SpainNameQuery;
}

type Pick = { variant: SpainNameVariant; rows: SpainNameRow[] };

async function pickFirstVariantWithRows(variants: readonly SpainNameVariant[], query: SpainNameQuery): Promise<Pick | null> {
  for (const variant of variants) {
    const rows = await query(variant.core);
    const hits = rows.filter(
      (row) => row.normalizedLegalName?.trim() === variant.core && normalizeSpainCompanyNif(row.taxId) !== null,
    );
    if (hits.length > 0) return { variant, rows: hits };
  }
  return null;
}

/** Un NIF, una fila: la razón social de un registro (no la del alias) y su tamaño. */
function distinctByNif(rows: readonly SpainNameRow[]): SpainNameRow[] {
  const groups = new Map<string, SpainNameRow[]>();
  for (const row of rows) {
    const nif = normalizeSpainCompanyNif(row.taxId)!;
    groups.set(nif, [...(groups.get(nif) ?? []), row]);
  }
  return [...groups.entries()].map(([taxId, group]) => {
    const shown = group.find((row) => row.alias !== true) ?? group[0];
    // Un número exacto de plantilla manda sobre el tramo «grande» sin número.
    const workforce =
      group.find((row) => row.workforce && row.workforce.maxWorkers === undefined)?.workforce ??
      group.find((row) => row.workforce)?.workforce ??
      null;
    return { ...shown, taxId, workforce };
  });
}

/** Construye el resolvedor de NIF por nombre de España. */
export function createSpainOfficialSourceResolver(config: SpainOfficialSourceResolverConfig): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'ES',
    sourceKey: ES_PLACSP_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'ES',
    sourceKey: ES_PLACSP_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'ES') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';
      const all = spainCandidateNameVariants(name);
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

      const distinct = distinctByNif(pick.rows);
      const best = distinct[0];
      const base = {
        countryCode: 'ES',
        sourceKey: best.sourceKey ?? ES_PLACSP_REGISTRY_SOURCE_KEY,
        matchMethod: 'normalized_name' as const,
        taxIdentifier: best.taxId,
        taxIdentifierType: 'NIF',
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

      // Una palabra: el nombre del candidato (sin «España» añadido) es UNA palabra.
      const ownCore = spainNameCore(name);
      const singleWord = ownCore.split(' ').length === 1 && !endsWithSpainLegalForm(name);
      const domainConfirms =
        singleWord &&
        spainSingleWordConfirmedByDomain(input.candidate.domain ?? input.candidate.websiteUrl ?? null, ownCore, {
          publicEntity: spainPublicEntityKey(best.legalName ?? '') !== null,
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
