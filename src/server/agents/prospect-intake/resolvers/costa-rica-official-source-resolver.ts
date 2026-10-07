/**
 * SOURCES-CR-CLOSE-1 — cédula jurídica por nombre de Costa Rica dentro de la
 * corrida del Agente 1.
 *
 * Mismas reglas conservadoras que Paraguay (`paraguay-official-source-resolver.ts`):
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      nombre sin restos de la web, parte antes del guion o del paréntesis, con o
 *      sin «de Costa Rica», clave de municipalidad: `costaRicaCandidateNameVariants`)
 *      contra el registro (`cr_company_registry`) y sus alias
 *      (`cr_company_name_alias`: nombre anterior, siglas oficiales, otros nombres
 *      de la misma cédula). La PRIMERA variante con alguna fila decide. Cada
 *      variante es una igualdad exacta: no hay coincidencia difusa.
 *   0. WEB OFICIAL. Si la web de la candidata es la de una entidad pública (ficha
 *      de MIDEPLAN, guardada como alias `web:<dominio>`), esa cédula manda.
 *   2. UNA PALABRA. Un nombre de una sola palabra sin forma societaria («ICE»,
 *      «Purdy», «Medtronic») sólo da una cédula fuerte si la web de la candidata
 *      lo confirma («ccss.sa.cr» ↔ CCSS). Si no, queda como pista.
 *
 * Fuerte (`matched`, 0.85) sólo con UNA cédula distinta. Varias →
 * `low_confidence_match` (pista, nunca llena las columnas fiscales). El resultado
 * siempre dice `cr_company_registry`: el alias es otra forma de encontrar la misma.
 *
 * Tamaño: si la cédula está en la lista de PYMES del MEIC, su tramo (micro,
 * pequeña, mediana) viaja como `workforce` para el filtro de tamaño del Agente 1.
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  costaRicaCandidateNameVariants,
  costaRicaNameCore,
  endsWithCostaRicaLegalForm,
  isCostaRicaPublicEntityCore,
  type CostaRicaNameVariant,
} from '@/server/source-catalog/connectors/cr-registry/cr-name-keys';
import {
  costaRicaSingleWordConfirmedByDomain,
  costaRicaWebAliasKey,
  CR_WEB_ALIAS_PREFIX,
} from '@/server/source-catalog/connectors/cr-registry/cr-domain';
import { CR_JURIDICAL_CEDULA } from '@/server/source-catalog/connectors/cr-registry/cr-company-registry-rows';

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

export const COSTA_RICA_REGISTRY_SOURCE_KEY = 'cr_company_registry' as const;

/** Una fila del registro o de sus alias, reducida a lo que el resolvedor usa. */
export interface CostaRicaNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  /** Tramo PYME del MEIC, si lo hay. */
  workforce?: OfficialWorkforce | null;
  /** `true` si la fila es un alias (`cr_company_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (registro y alias) cuya clave guardada es `core`. Fail-soft. */
export type CostaRicaNameQuery = (core: string) => Promise<CostaRicaNameRow[]>;

export interface CostaRicaOfficialSourceResolverConfig {
  querySnapshots: CostaRicaNameQuery;
}

type Pick = { variant: CostaRicaNameVariant; rows: CostaRicaNameRow[] };

async function pickFirstVariantWithRows(
  variants: readonly CostaRicaNameVariant[],
  query: CostaRicaNameQuery,
): Promise<Pick | null> {
  for (const variant of variants) {
    const rows = await query(variant.core);
    const hits = rows.filter(
      (row) => row.normalizedLegalName?.trim() === variant.core && CR_JURIDICAL_CEDULA.test(row.taxId?.trim() ?? ''),
    );
    if (hits.length > 0) return { variant, rows: hits };
  }
  return null;
}

/** Una entidad por cédula: la razón social del registro (no la del alias) y su tramo. */
function distinctByCedula(rows: readonly CostaRicaNameRow[]): CostaRicaNameRow[] {
  const groups = new Map<string, CostaRicaNameRow[]>();
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

/** «MEDTRONIC COSTA RICA» → «MEDTRONIC» (sólo el final que añadió la variante). */
function withoutCostaRicaSuffix(core: string): string {
  return core.replace(/ (DE COSTA RICA|COSTA RICA|CR)$/, '');
}

/** Construye el resolvedor de cédula jurídica por nombre de Costa Rica. */
export function createCostaRicaOfficialSourceResolver(
  config: CostaRicaOfficialSourceResolverConfig,
): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'CR',
    sourceKey: COSTA_RICA_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'CR',
    sourceKey: COSTA_RICA_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'CR') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 2);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';

      // La web oficial de una entidad pública (ficha de MIDEPLAN) manda: «TEC» con
      // tec.ac.cr es el Instituto Tecnológico de Costa Rica aunque MIDEPLAN no
      // publique esa sigla. Sólo con UNA cédula para esa web.
      const webKey = costaRicaWebAliasKey(input.candidate.domain ?? input.candidate.websiteUrl ?? null);
      if (webKey !== null) {
        const byWeb = distinctByCedula(
          (await config.querySnapshots(webKey)).filter(
            (row) => row.normalizedLegalName?.trim() === webKey && CR_JURIDICAL_CEDULA.test(row.taxId?.trim() ?? ''),
          ),
        );
        if (byWeb.length === 1) {
          const best = byWeb[0];
          return {
            status: 'matched',
            countryCode: 'CR',
            sourceKey: COSTA_RICA_REGISTRY_SOURCE_KEY,
            confidence: SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
            matchMethod: 'domain',
            taxIdentifier: best.taxId,
            taxIdentifierType: 'cedula_juridica',
            legalName: best.legalName || null,
            warnings: [],
            issues: [],
            safeMetadata: { matchedOfficialWebsite: webKey.slice(CR_WEB_ALIAS_PREFIX.length) },
            ...(best.workforce ? { workforce: { ...best.workforce } } : {}),
          };
        }
      }

      const all = costaRicaCandidateNameVariants(name);
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

      const distinct = distinctByCedula(pick.rows);
      const best = distinct[0];
      const base = {
        countryCode: 'CR',
        sourceKey: COSTA_RICA_REGISTRY_SOURCE_KEY,
        matchMethod: 'normalized_name' as const,
        taxIdentifier: best.taxId,
        taxIdentifierType: 'cedula_juridica',
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

      // «Medtronic» → MEDTRONIC COSTA RICA: el vendedor escribió UNA palabra; añadirle
      // «Costa Rica» no la convierte en un nombre completo.
      const word = pick.variant.origin === 'with_costa_rica' ? withoutCostaRicaSuffix(pick.variant.core) : pick.variant.core;
      const singleWord = word.split(' ').length === 1 && !endsWithCostaRicaLegalForm(name);
      const domainConfirms =
        singleWord &&
        costaRicaSingleWordConfirmedByDomain(input.candidate.domain ?? input.candidate.websiteUrl ?? null, word, {
          publicEntity: isCostaRicaPublicEntityCore(costaRicaNameCore(best.legalName)),
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
