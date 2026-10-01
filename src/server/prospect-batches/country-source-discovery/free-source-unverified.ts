/**
 * free-source-unverified.ts — qué hace la capa gratuita con una empresa que llega
 * SIN sitio web.
 *
 * AGENT1-FREE-SOURCE-UNVERIFIED-1. Decisión de la dueña (2026-10-01): una
 * empresa de un catálogo oficial sin dominio NO cuenta para la meta. Medido en
 * Producción (01-10, México × Tecnología y × Salud): DENUE dejó 20 filas sin
 * dominio, sin tamaño y sin LinkedIn, contó 5 como aceptadas y por eso Apollo y
 * Lusha no corrieron.
 *
 * La regla:
 *   · CON dominio ⇒ se entrega como candidata y cuenta para la meta.
 *   · SIN dominio ⇒ NO se entrega ni cuenta: va a «Descartadas» con el motivo
 *     `missing_domain_final`, el MISMO que usa Apollo, para que el rescate con
 *     Claude busque su sitio oficial al terminar la corrida. Si lo encuentra (y
 *     pasa duplicados), la envía a revisión; si no, se queda descartada.
 *
 * Los catálogos no traen tamaño de empresa, así que hoy la única prueba que
 * convierte una fila en verificable es el dominio.
 *
 * Puro: sin env, sin I/O.
 */

import type { CreateDiscardedDispositionInput } from '@/modules/prospect-discards/types';
import type { CountrySourceCompany } from './country-source-types';

/** El MISMO código que el buscador de sitio de Claude recoge (`DOMAIN_SEARCH_REASON_CODE`). */
export const FREE_SOURCE_MISSING_DOMAIN_REASON_CODE = 'missing_domain_final';

/** Máximo de descartes por corrida: el rescate trabaja un lote acotado. */
export const FREE_SOURCE_UNVERIFIED_MAX_DISPOSITIONS = 50;

export function hasVerifiableDomain(company: Pick<CountrySourceCompany, 'domain'>): boolean {
  return typeof company.domain === 'string' && company.domain.trim() !== '';
}

export function partitionFreeCompaniesByDomain<T extends Pick<CountrySourceCompany, 'domain'>>(
  companies: readonly T[],
): { withDomain: T[]; withoutDomain: T[] } {
  const withDomain: T[] = [];
  const withoutDomain: T[] = [];
  for (const company of companies) (hasVerifiableDomain(company) ? withDomain : withoutDomain).push(company);
  return { withDomain, withoutDomain };
}

/**
 * Las filas de «Descartadas» para las empresas sin sitio. Sin PII: nombre de la
 * empresa, ubicación, actividad declarada y la PRESENCIA (no el valor) del
 * identificador fiscal.
 */
export function buildUnverifiedFreeDispositionRows(input: {
  batchId: string;
  countryCode: string;
  companies: readonly CountrySourceCompany[];
}): CreateDiscardedDispositionInput[] {
  return input.companies
    .filter((c) => !hasVerifiableDomain(c))
    .slice(0, FREE_SOURCE_UNVERIFIED_MAX_DISPOSITIONS)
    .flatMap((c) => {
      const name = c.legalName?.trim() || c.normalizedLegalName?.trim() || '';
      if (!name || !c.recordIdentityKey) return [];
      return [
        {
          batchId: input.batchId,
          providerIdentifier: c.recordIdentityKey,
          sourceKey: `free:${c.recordIdentityKey}`,
          name,
          domain: null,
          countryCode: c.countryCode || input.countryCode,
          industry: c.declaredIndustry,
          sourcePrimary: 'public_source',
          roundOrigin: 'free_source',
          disposition: 'final_validation_rejected',
          reasonCode: FREE_SOURCE_MISSING_DOMAIN_REASON_CODE,
          reasonDetail: 'Fuente oficial sin sitio web: no cuenta para la meta; Claude buscará su sitio.',
          evidence: {
            provider_raw_name: c.legalName ?? null,
            city: c.city,
            region: c.region,
            industry_code: c.industryCode,
            tax_identifier_present: Boolean(c.taxId),
            tax_identifier_type: c.taxIdentifierType,
          },
        } satisfies CreateDiscardedDispositionInput,
      ];
    });
}
