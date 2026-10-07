/**
 * SOURCES-CL-NAME-ALIAS-1 — RUT por nombre de Chile dentro de la corrida del Agente 1.
 *
 * Mismas reglas conservadoras que el resolvedor genérico de padrones
 * (`snapshot-name-official-source-resolver.ts`), que es el que Chile usaba, con tres
 * añadidos (ver `cl-name-keys.ts`):
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      nombre sin restos de la web, cada parte de un nombre doble, sin «Chile» al
 *      final) contra el registro del SII y sus alias (`cl_sii_name_alias`). La
 *      PRIMERA variante con alguna fila decide. Cada variante es una igualdad exacta.
 *   2. SIGLAS. Si ninguna variante encuentra nada y una de ellas es la sigla de un
 *      organismo público conocido (INJUV, Junaeb, SENDA, PDI con su web…), su RUT.
 *   3. ALIAS. El nombre comercial al final de una razón social larga
 *      («Transemel» → EMPRESA DE TRANSMISION ELECTRICA TRANSEMEL S A). Sólo da un
 *      RUT seguro si la web del candidato lleva esa palabra (transemel.cl); sin web
 *      que lo confirme queda como pista: una palabra única del SII («LAETITIA», de
 *      una fundación) puede ser también la marca de otra empresa.
 *
 * Fuerte (`matched`, 0.85) sólo con UN RUT distinto. Varios → `low_confidence_match`
 * (pista, nunca llena las columnas fiscales). El resultado siempre dice
 * `cl_sii_registry`: un alias o una sigla son formas de encontrar la misma sociedad
 * del registro, no otra fuente de identidad.
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  chileCandidateNameVariants,
  chileGroupBrandByDomain,
  chilePublicEntityBySigla,
  CL_HOMONYM_MIN_WORKERS,
  type ChileNameVariant,
} from '@/server/source-catalog/connectors/sii-chile/cl-name-keys';

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

export const CHILE_REGISTRY_SOURCE_KEY = 'cl_sii_registry' as const;

const CHILE_RUT = /^\d{7,8}-[\dK]$/;

/** Una fila del registro o de sus alias, reducida a lo que el resolvedor usa. */
export interface ChileNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  workforce?: OfficialWorkforce | null;
  /** `true` si la fila es un alias (`cl_sii_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (registro y alias) cuya clave guardada es `core`. Fail-soft. */
export type ChileNameQuery = (core: string) => Promise<ChileNameRow[]>;

export interface ChileOfficialSourceResolverConfig {
  querySnapshots: ChileNameQuery;
}

type Pick = { variant: ChileNameVariant; rows: ChileNameRow[] };

async function pickFirstVariantWithRows(
  variants: readonly ChileNameVariant[],
  query: ChileNameQuery,
): Promise<Pick | null> {
  for (const variant of variants) {
    const rows = await query(variant.core);
    const hits = rows.filter(
      (row) => row.normalizedLegalName?.trim() === variant.core && CHILE_RUT.test(row.taxId?.trim() ?? ''),
    );
    if (hits.length > 0) return { variant, rows: hits };
  }
  return null;
}

/** Una sociedad por RUT: la razón social del registro (no la del alias) y sus trabajadores. */
function distinctByRut(rows: readonly ChileNameRow[]): ChileNameRow[] {
  const groups = new Map<string, ChileNameRow[]>();
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

/**
 * Entre homónimos, la ÚNICA sociedad con `CL_HOMONYM_MIN_WORKERS`+ trabajadores, si
 * todas las demás informan 0 o nada. Si dos tienen trabajadores, sigue ambiguo.
 */
function onlyActiveHomonym(rows: readonly ChileNameRow[]): ChileNameRow | null {
  const active = rows.filter((row) => (row.workforce?.workers ?? 0) >= CL_HOMONYM_MIN_WORKERS);
  if (active.length !== 1) return null;
  const othersIdle = rows.every((row) => row === active[0] || (row.workforce?.workers ?? 0) === 0);
  return othersIdle && active[0].alias !== true ? active[0] : null;
}

/** ¿La web del candidato lleva la palabra del alias («transemel.cl» para «TRANSEMEL»)? */
function domainCarriesAlias(domainOrUrl: string | null, aliasCore: string): boolean {
  if (!domainOrUrl || aliasCore.includes(' ')) return false;
  try {
    const host = new URL(domainOrUrl.includes('://') ? domainOrUrl : `https://${domainOrUrl}`).hostname.toLowerCase();
    return host.replace(/[^a-z0-9.]/g, '').includes(aliasCore.toLowerCase());
  } catch {
    return false;
  }
}

/** Construye el resolvedor de RUT por nombre de Chile (registro del SII + alias + siglas). */
export function createChileOfficialSourceResolver(config: ChileOfficialSourceResolverConfig): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'CL',
    sourceKey: CHILE_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'CL',
    sourceKey: CHILE_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'CL') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const allVariants = chileCandidateNameVariants(input.candidate.canonicalName);
      const firstCore = allVariants[0]?.core ?? null;
      const domain = input.candidate.domain ?? input.candidate.websiteUrl ?? null;
      const variants = allVariants.filter(
        (variant) =>
          !isNameTooGeneric(
            variant.core.toLowerCase().split(' ').filter((t) => t.length > 0),
            input.candidate.domain,
            input.candidate.websiteUrl,
          ),
      );

      // Marca de un grupo grande con su web oficial: decide antes que los homónimos del SII.
      const groupBrand = chileGroupBrandByDomain(allVariants, domain);
      if (groupBrand !== null) {
        return {
          status: 'matched',
          countryCode: 'CL',
          sourceKey: CHILE_REGISTRY_SOURCE_KEY,
          confidence: SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
          matchMethod: 'normalized_name',
          taxIdentifier: groupBrand.rut,
          taxIdentifierType: 'RUT',
          legalName: groupBrand.legalName,
          warnings: [],
          issues: [],
          safeMetadata: { normalizedSearchName: firstCore ?? groupBrand.legalName, groupBrand: true },
        };
      }

      const pick = variants.length > 0 ? await pickFirstVariantWithRows(variants, config.querySnapshots) : null;
      if (pick === null) {
        const entity = chilePublicEntityBySigla(allVariants, domain);
        if (entity === null) return notFound(firstCore);
        return {
          status: 'matched',
          countryCode: 'CL',
          sourceKey: CHILE_REGISTRY_SOURCE_KEY,
          confidence: SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
          matchMethod: 'normalized_name',
          taxIdentifier: entity.rut,
          taxIdentifierType: 'RUT',
          legalName: entity.legalName,
          warnings: [],
          issues: [],
          safeMetadata: { normalizedSearchName: firstCore ?? entity.legalName, publicEntitySigla: true },
        };
      }

      const distinct = distinctByRut(pick.rows);
      const best = distinct[0];
      const base = {
        countryCode: 'CL',
        sourceKey: CHILE_REGISTRY_SOURCE_KEY,
        matchMethod: 'normalized_name' as const,
        taxIdentifier: best.taxId,
        taxIdentifierType: 'RUT',
        legalName: best.legalName || null,
        warnings: [],
        issues: [],
      };
      const metadata = {
        normalizedSearchName: pick.variant.core,
        nameVariant: pick.variant.origin,
        ...(best.alias === true ? { matchedAlias: true } : {}),
      };

      if (best.alias === true && !domainCarriesAlias(domain, pick.variant.core)) {
        return {
          ...base,
          status: 'low_confidence_match',
          confidence: SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
          safeMetadata: { ...metadata, aliasNeedsDomain: true },
        };
      }

      const bySize = distinct.length > 1 ? onlyActiveHomonym(distinct) : null;
      if (bySize !== null) {
        return {
          ...base,
          taxIdentifier: bySize.taxId,
          legalName: bySize.legalName || null,
          status: 'matched',
          confidence: SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
          safeMetadata: { ...metadata, homonymResolvedBySize: true, candidateCount: distinct.length },
          ...(bySize.workforce ? { workforce: { ...bySize.workforce } } : {}),
        };
      }

      if (distinct.length > 1) {
        return {
          ...base,
          status: 'low_confidence_match',
          confidence: SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
          safeMetadata: { ...metadata, ambiguous: true, candidateCount: distinct.length },
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
