/**
 * country-source-official-tax-id.ts — número fiscal oficial para las empresas de
 * la capa gratuita que la fuente publica SIN él.
 *
 * SOURCES-MX-FREE-LAYER-RFC-1. Prod 05-10 (lotes 0c856270 Salud y 79c79bd0
 * Tecnología, México): 40 empresas de DENUE, 0 con RFC. DENUE no publica RFC y
 * esta capa nunca pasaba por el registro oficial por nombre que Apollo, Tavily y
 * Claude sí usan. Simulado contra CompraNet: 9 de esas 40 tenían RFC oficial.
 *
 * Mismas fuentes y misma regla que el resto (`buildColombiaOfficialSourceResolvers`):
 * sólo una coincidencia FUERTE pone el número fiscal. Una dudosa se ignora: aquí
 * el número decide duplicados, y uno equivocado escondería una empresa nueva.
 * Única excepción: un nombre oficial de una sola palabra con UN solo RFC (ver abajo).
 *
 * Nunca falla la corrida: un tropiezo deja la empresa como venía. Con plazo,
 * porque la capa gratuita corre antes del proveedor de pago en el mismo request.
 */

import { normalizeProviderDiscoveredCompany } from '@/server/agents/prospect-intake/normalize';
import {
  enrichNormalizedProspectWithOfficialSources,
  type OfficialSourceEnrichmentResult,
  type OfficialSourceResolver,
} from '@/server/agents/prospect-intake/source-enrichment';
import type { ProviderDiscoveredCompany } from '@/server/agents/prospect-intake/types';
import type { CountrySourceCompany } from './country-source-types';

/** Plazo total para EMPEZAR búsquedas nuevas. */
export const COUNTRY_SOURCE_TAX_ID_LOOKUP_DEADLINE_MS = 15_000;
/** Búsquedas simultáneas. */
export const COUNTRY_SOURCE_TAX_ID_LOOKUP_CONCURRENCY = 4;

type TaxIdentifierType = NonNullable<CountrySourceCompany['taxIdentifierType']>;

const KNOWN_TAX_IDENTIFIER_TYPES: ReadonlySet<string> = new Set<TaxIdentifierType>([
  'NIT', 'RFC', 'RUT', 'RUC', 'CUIT', 'CNPJ', 'RNC', 'RTN', 'cedula_juridica', 'EIN', 'NIF', 'other',
]);

export type CountrySourceOfficialTaxIdMatch = {
  taxId: string;
  taxIdentifierType: TaxIdentifierType;
  sourceKey: string | null;
  confidence: number | null;
};

/** READ-ONLY. `null` = sin coincidencia fuerte. */
export type LookUpCountrySourceOfficialTaxId = (
  company: CountrySourceCompany,
) => Promise<CountrySourceOfficialTaxIdMatch | null>;

function toTaxIdentifierType(value: string | null | undefined): TaxIdentifierType {
  return value && KNOWN_TAX_IDENTIFIER_TYPES.has(value) ? (value as TaxIdentifierType) : 'other';
}

function isUniqueSingleWordSignal(source: OfficialSourceEnrichmentResult): boolean {
  return (
    source.status === 'low_confidence_match' &&
    source.matchMethod === 'normalized_name' &&
    source.safeMetadata?.singleWordName === true &&
    source.safeMetadata?.ambiguous !== true
  );
}

/** Adapta los resolutores oficiales (los mismos de Apollo/Tavily/Claude) a esta capa. */
export function buildCountrySourceOfficialTaxIdLookup(
  resolvers: OfficialSourceResolver[],
): LookUpCountrySourceOfficialTaxId {
  return async (company) => {
    const name = company.legalName?.trim();
    if (!name) return null;
    const criteria = { countryCode: company.countryCode };
    // Se arma aquí y no con un adaptador de proveedor: esta capa no puede importar
    // ninguno (guarda estática § 27/§ 28).
    const discovered: ProviderDiscoveredCompany = {
      provider: 'public_source',
      companyName: name,
      legalName: name,
      countryCode: company.countryCode,
      city: company.city,
      region: company.region,
    };
    const normalized = normalizeProviderDiscoveredCompany(discovered, criteria);
    const enriched = await enrichNormalizedProspectWithOfficialSources(normalized, criteria, resolvers);
    const source = enriched.officialSource;
    if (enriched.strongIdentityAvailable && enriched.taxIdentifier) {
      return {
        taxId: enriched.taxIdentifier,
        taxIdentifierType: toTaxIdentifierType(enriched.taxIdentifierType),
        sourceKey: source.sourceKey ?? null,
        confidence: source.confidence ?? null,
      };
    }
    // Decisión de la dueña 06-10 (Prod, lote 614827f2: DENUE trajo «AXTEL» y
    // «BICENTEL» sin forma societaria). Para Apollo/Tavily/Claude una sola palabra
    // es sólo pista porque puede ser una marca; aquí el nombre sale de un registro
    // OFICIAL (DENUE, 51+ personas) y el registro fiscal tiene UN solo RFC con ese
    // núcleo. Eso basta en esta capa. Un nombre ambiguo (varios RFC) sigue fuera.
    if (isUniqueSingleWordSignal(source) && source.taxIdentifier) {
      return {
        taxId: source.taxIdentifier,
        taxIdentifierType: toTaxIdentifierType(source.taxIdentifierType),
        sourceKey: source.sourceKey ?? null,
        confidence: source.confidence ?? null,
      };
    }
    return null;
  };
}

export type FillMissingOfficialTaxIdsOptions = {
  nowMs?: () => number;
  deadlineMs?: number;
  concurrency?: number;
};

/**
 * Busca el número fiscal de las empresas que llegaron sin él, en su orden, con
 * `concurrency` a la vez, y deja de EMPEZAR búsquedas al vencer el plazo. Devuelve
 * una lista NUEVA; las empresas sin coincidencia fuerte quedan igual.
 */
export async function fillMissingOfficialTaxIds(
  companies: readonly CountrySourceCompany[],
  lookUp: LookUpCountrySourceOfficialTaxId,
  options: FillMissingOfficialTaxIdsOptions = {},
): Promise<CountrySourceCompany[]> {
  const now = options.nowMs ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? COUNTRY_SOURCE_TAX_ID_LOOKUP_DEADLINE_MS);
  const concurrency = Math.max(1, options.concurrency ?? COUNTRY_SOURCE_TAX_ID_LOOKUP_CONCURRENCY);
  const out = [...companies];
  const pending = out
    .map((company, index) => ({ company, index }))
    .filter(({ company }) => company.taxId === null && (company.legalName ?? '').trim().length > 0);

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < pending.length && now() < deadline) {
      const { company, index } = pending[next++];
      const match = await lookUp(company).catch(() => null);
      if (match === null) continue;
      out[index] = {
        ...company,
        taxId: match.taxId,
        taxIdentifierType: match.taxIdentifierType,
        officialTaxIdLookup: { sourceKey: match.sourceKey, confidence: match.confidence },
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  return out;
}
