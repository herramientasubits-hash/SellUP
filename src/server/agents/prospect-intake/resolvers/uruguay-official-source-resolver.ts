/**
 * SOURCES-UY-CLOSE-1 — RUT por nombre de Uruguay dentro de la corrida del Agente 1.
 *
 * Mismas reglas conservadoras que Paraguay (`paraguay-official-source-resolver.ts`):
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      nombre sin restos de la web, parte antes del guion o del paréntesis, sigla
 *      pegada, con o sin «(del) Uruguay»: `uruguayCandidateNameVariants`) contra el
 *      RUPE y sus alias (`uy_rupe_name_alias`). La PRIMERA variante con alguna fila
 *      decide. Cada variante es una igualdad exacta: no hay coincidencia difusa.
 *   2. UNA PALABRA. Un nombre de una sola palabra sin forma societaria («Saman»,
 *      «Claro», «UTE») sólo da un RUT fuerte si:
 *        - es la sigla OFICIAL de un ente del Estado (`UY_PUBLIC_ENTITY_ACRONYMS`:
 *          UTE, OSE, ANCAP…), o
 *        - la web de la candidata lo confirma («tilsor.com.uy» ↔ TILSOR) Y la
 *          organización del RUPE es una sociedad anónima o una institución sin
 *          forma societaria (mutualista, cooperativa: «casmu.com.uy» ↔ CASMU), no
 *          «en ingreso»: «CLARO S.R.L.» no es Claro (AM Wireless) ni «SAMAN
 *          S.R.L.» es Saman (medido el 13-10-2026).
 *      Si no, queda como pista.
 *
 * Fuerte (`matched`, 0.85) sólo con UN RUT distinto. Varios → `low_confidence_match`
 * (pista, nunca llena las columnas fiscales). El resultado siempre dice
 * `uy_rupe_registry`: el alias es otra forma de encontrar la misma organización.
 *
 * Uruguay no publica tamaño por empresa: este resolvedor nunca trae `workforce`.
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  endsWithUruguayLegalForm,
  plainUpperUruguay,
  UY_PUBLIC_ENTITY_ACRONYMS,
  uruguayCandidateNameVariants,
  type UruguayNameVariant,
} from '@/server/source-catalog/connectors/rupe-uruguay/uy-name-keys';
import { uruguaySingleWordConfirmedByDomain } from '@/server/source-catalog/connectors/rupe-uruguay/uy-domain';
import { isUruguayPublicEntityName } from '@/server/source-catalog/connectors/rupe-uruguay/uy-public-entities';
import { isUruguayOrganizationName } from '@/server/source-catalog/connectors/rupe-uruguay/uy-rupe-registry-row';

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
} from '../source-enrichment';
import {
  SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
  SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
} from './snapshot-name-official-source-resolver';

export const URUGUAY_REGISTRY_SOURCE_KEY = 'uy_rupe_registry' as const;

/** RUT uruguayo: 12 dígitos. */
const UY_RUT = /^\d{12}$/;

/** Una fila del RUPE o de sus alias, reducida a lo que el resolvedor usa. */
export interface UruguayNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  /** `active` o `registering` (en ingreso), del RUPE. */
  rupeState?: string | null;
  /** `true` si la fila es un alias (`uy_rupe_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (RUPE y alias) cuya clave guardada es `core`. Fail-soft. */
export type UruguayNameQuery = (core: string) => Promise<UruguayNameRow[]>;

export interface UruguayOfficialSourceResolverConfig {
  querySnapshots: UruguayNameQuery;
}

type Pick = { variant: UruguayNameVariant; rows: UruguayNameRow[] };

async function pickFirstVariantWithRows(
  variants: readonly UruguayNameVariant[],
  query: UruguayNameQuery,
): Promise<Pick | null> {
  for (const variant of variants) {
    const rows = await query(variant.core);
    const hits = rows.filter((row) => row.normalizedLegalName?.trim() === variant.core && UY_RUT.test(row.taxId?.trim() ?? ''));
    if (hits.length > 0) return { variant, rows: hits };
  }
  return null;
}

/** Una organización por RUT: la razón social del RUPE (no la del alias). */
function distinctByRut(rows: readonly UruguayNameRow[]): UruguayNameRow[] {
  const groups = new Map<string, UruguayNameRow[]>();
  for (const row of rows) {
    const taxId = row.taxId!.trim();
    groups.set(taxId, [...(groups.get(taxId) ?? []), row]);
  }
  return [...groups.entries()].map(([taxId, group]) => ({ ...(group.find((row) => row.alias !== true) ?? group[0]), taxId }));
}

/** ¿Es la sigla OFICIAL del ente cuya razón social es `legalName`? */
function isOfficialAcronymOf(word: string, legalName: string | null): boolean {
  const names = UY_PUBLIC_ENTITY_ACRONYMS[word];
  if (names === undefined || legalName === null) return false;
  const upper = plainUpperUruguay(legalName);
  return names.some((name) => upper === name || upper.startsWith(`${name} `));
}

/** Sociedad anónima (no S.R.L., SAS ni Ltda.): las marcas grandes lo son. */
const ANONYMOUS_COMPANY = /(?:^| )(?:S A|SA|SOCIEDAD ANONIMA|S A C I|SACI|S A I C|SAIC)$/;

/** Construye el resolvedor de RUT por nombre de Uruguay. */
export function createUruguayOfficialSourceResolver(config: UruguayOfficialSourceResolverConfig): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'UY',
    sourceKey: URUGUAY_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'UY',
    sourceKey: URUGUAY_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'UY') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 2);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';
      const all = uruguayCandidateNameVariants(name);
      const variants = all.filter(
        (variant) =>
          // Una sigla oficial (UTE, OSE) es corta pero no genérica.
          UY_PUBLIC_ENTITY_ACRONYMS[variant.core] !== undefined ||
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

      const distinct = distinctByRut(pick.rows);
      const best = distinct[0];
      const base = {
        countryCode: 'UY',
        sourceKey: URUGUAY_REGISTRY_SOURCE_KEY,
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

      if (distinct.length > 1) {
        return {
          ...base,
          status: 'low_confidence_match',
          confidence: SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
          safeMetadata: { ...metadata, ambiguous: true, candidateCount: distinct.length },
        };
      }

      const singleWord = pick.variant.core.split(' ').length === 1 && !endsWithUruguayLegalForm(name);
      if (singleWord) {
        const officialAcronym = isOfficialAcronymOf(pick.variant.core, best.legalName);
        const publicEntity = isUruguayPublicEntityName(best.legalName);
        const domainConfirms = uruguaySingleWordConfirmedByDomain(
          input.candidate.domain ?? input.candidate.websiteUrl ?? null,
          pick.variant.core,
          { publicEntity },
        );
        const institution = !endsWithUruguayLegalForm(best.legalName ?? '') && isUruguayOrganizationName(best.legalName);
        const bigCompany =
          (ANONYMOUS_COMPANY.test(plainUpperUruguay(best.legalName ?? '')) || institution) && best.rupeState !== 'registering';
        if (!officialAcronym && !(domainConfirms && (bigCompany || publicEntity))) {
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
          safeMetadata: officialAcronym
            ? { ...metadata, officialAcronym: true }
            : { ...metadata, singleWordConfirmedByDomain: true },
        };
      }

      return {
        ...base,
        status: 'matched',
        confidence: SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
        safeMetadata: metadata,
      };
    },
  };
}
