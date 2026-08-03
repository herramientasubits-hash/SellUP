/**
 * fixtures.ts — Constructores compartidos por la suite de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 13.
 *
 * Todo es offline: ni una llamada real a Apollo, ni un crédito, ni una lectura
 * de `process.env`. Los tests que necesitan configuración la construyen aquí.
 */

import type {
  ApolloTwoRoundDiscoveryConfig,
} from '../config';
import type {
  CheapAssessment,
  RawDiscoveredOrganization,
} from '../orchestrator';
import type { ApolloTwoRoundRunCorrelation } from '../idempotency';
import type { ApolloTwoRoundQueryContext } from '../query-hypothesis';

/** Configuración del contrato: 5 / 2 / 5 / 10 / 2. */
export function testConfig(
  overrides: Partial<ApolloTwoRoundDiscoveryConfig> = {},
): ApolloTwoRoundDiscoveryConfig {
  return {
    targetEligibleCompanies: 5,
    maxRounds: 2,
    maxResultsPerRound: 5,
    maxRawResultsPerRun: 10,
    maxEnrichmentsPerRun: 2,
    ...overrides,
  };
}

/** Correlación económica estable. Sin timestamps: dos corridas iguales coinciden. */
export function testCorrelation(
  overrides: Partial<ApolloTwoRoundRunCorrelation> = {},
): ApolloTwoRoundRunCorrelation {
  return {
    wizardRunId: 'wizard-run-1',
    clientRequestId: 'client-request-1',
    batchId: 'batch-1',
    reservationId: 'reservation-1',
    requestFingerprint: 'fingerprint-1',
    idempotencyKey: 'idempotency-1',
    ...overrides,
  };
}

/** Búsqueda de supermercados en Colombia — el caso del § 3. */
export function testQueryContext(
  overrides: Partial<ApolloTwoRoundQueryContext> = {},
): ApolloTwoRoundQueryContext {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    sector: 'Retail y Consumo',
    subindustry: 'Supermercados e Hipermercados',
    targetLocations: ['Bogotá'],
    employeeRanges: ['201,500'],
    ...overrides,
  };
}

/** Organización cruda con identidad completa. */
export function org(
  id: string,
  overrides: Partial<RawDiscoveredOrganization> = {},
): RawDiscoveredOrganization {
  return {
    providerOrganizationId: id,
    domain: `${id}.com`,
    linkedinUrl: `https://www.linkedin.com/company/${id}`,
    name: `Supermercados ${id.toUpperCase()} S.A.`,
    providerRank: 1,
    declaredIndustry: 'retail',
    ...overrides,
  };
}

/** Lote de N organizaciones con `providerRank` correlativo. */
export function orgs(prefix: string, count: number): RawDiscoveredOrganization[] {
  return Array.from({ length: count }, (_unused, index) =>
    org(`${prefix}${index + 1}`, { providerRank: index + 1 }),
  );
}

/**
 * Evaluación barata "todo en orden y sector confirmado" — el candidato cuenta
 * de inmediato para el objetivo.
 */
export function passingAssessment(
  overrides: Partial<CheapAssessment> = {},
): CheapAssessment {
  return {
    rejection: null,
    sectorEvidenceState: 'sector_evidence_confirmed',
    noPriorSuggestion: true,
    signals: {
      countryCompatible: true,
      domainConfident: true,
      ownershipConfident: true,
      sectorKeywordMatchCount: 2,
      novel: true,
      hasCompanySizeSignal: true,
      hasLocationSignal: true,
      hasLinkedInUrl: true,
      freeOfContradictoryEvidence: true,
      knownDuplicate: false,
      cooldownActive: false,
    },
    ...overrides,
  };
}

/**
 * Candidato que pasa los gates baratos pero cuyo sector NO está demostrado:
 * el único estado que puede competir por un enrichment (§ 6).
 */
export function ambiguousAssessment(
  overrides: Partial<CheapAssessment> = {},
): CheapAssessment {
  const base = passingAssessment();
  return {
    ...base,
    sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
    signals: { ...base.signals, sectorKeywordMatchCount: 0 },
    ...overrides,
  };
}

/** Candidato rechazado por un gate barato concreto. */
export function rejectedAssessment(
  rejection: NonNullable<CheapAssessment['rejection']>,
  overrides: Partial<CheapAssessment> = {},
): CheapAssessment {
  const base = passingAssessment();
  return { ...base, rejection, ...overrides };
}
