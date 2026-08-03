/**
 * Calidad sectorial y deduplicación previa al gasto.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 13, casos 5–11.
 *
 * Offline: fixtures puras, cero llamadas a Apollo, cero créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { WebSearchResult } from '../../types';
import { evaluateApolloSectorRelevanceForPaidOperation } from '../../apollo-sector-relevance-gate';
import { evaluateApolloEnrichmentEligibility } from '../../apollo-enrichment-eligibility-gate';
import { selectCandidatesForEnrichment, type FreeCandidateSignals } from '../enrichment-ranking';
import { runApolloTwoRoundDiscovery, type CheapAssessment } from '../orchestrator';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  org,
  passingAssessment,
  ambiguousAssessment,
  rejectedAssessment,
} from './fixtures';

const SECTOR = 'Retail y Consumo';
const SUBINDUSTRY = 'Supermercados e Hipermercados';

function candidate(overrides: {
  title: string;
  domain: string;
  industry?: string | null;
  industries?: string[];
  keywords?: string[];
  shortDescription?: string | null;
  snippet?: string;
}): WebSearchResult {
  return {
    title: overrides.title,
    url: `https://${overrides.domain}`,
    snippet: overrides.snippet ?? `Empresa: ${overrides.title}`,
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    confidence: 0.85,
    metadata: {
      domain: overrides.domain,
      industry: overrides.industry ?? null,
      keywords: overrides.keywords ?? [],
      short_description: overrides.shortDescription ?? null,
      apollo_profile: {
        organization_id: 'org-1',
        industry: overrides.industry ?? null,
        industries: overrides.industries ?? [],
        keywords: overrides.keywords ?? [],
        organization_keywords: [],
        short_description: overrides.shortDescription ?? null,
        seo_description: null,
        description: null,
      },
    },
  } as unknown as WebSearchResult;
}

// ─── Casos 5, 6, 10, 11: clasificación sectorial ─────────────────────────────

describe('§ 13 · clasificación sectorial (§ 5)', () => {
  test('caso 5 — "retail banking" NO satisface supermercados: es contradicción, no evidencia', () => {
    const citigroup = candidate({
      title: 'Citigroup Inc',
      domain: 'citi.com',
      industry: 'retail banking',
    });

    const verdict = evaluateApolloSectorRelevanceForPaidOperation(
      citigroup,
      SECTOR,
      SUBINDUSTRY,
    );

    assert.equal(verdict.decision, 'sector_relevance_contradicted');
    assert.deepEqual(verdict.matchedTerms, []);
  });

  test('caso 6 — un supermercado real con industry "retail" y señales grocery NO se bloquea', () => {
    const exito = candidate({
      title: 'Almacenes Éxito S.A.',
      domain: 'grupoexito.com.co',
      industry: 'retail',
      keywords: ['supermercado', 'grocery retail'],
      shortDescription: 'Cadena de supermercados e hipermercados en Colombia.',
    });

    const verdict = evaluateApolloSectorRelevanceForPaidOperation(exito, SECTOR, SUBINDUSTRY);

    assert.equal(verdict.decision, 'relevant');
    assert.ok(verdict.matchedTerms.length > 0);
  });

  test('industry "retail" SIN señales específicas es evidencia insuficiente, no contradicción', () => {
    // El defecto que este hito corrige: antes esto caía en
    // `sector_relevance_contradicted` y un supermercado real cuya única
    // industria declarada es la categoría amplia quedaba fuera del enrichment
    // sin poder resolver su propia ambigüedad.
    const generic = candidate({
      title: 'Comercializadora Andina',
      domain: 'comercializadoraandina.com',
      industry: 'retail',
    });

    const verdict = evaluateApolloSectorRelevanceForPaidOperation(generic, SECTOR, SUBINDUSTRY);

    assert.equal(verdict.decision, 'sector_evidence_missing_needs_enrichment');
  });

  test('caso 10 — industria financiera contradice y se rechaza ANTES del enrichment', () => {
    const bank = candidate({
      title: 'Bancolombia S.A.',
      domain: 'grupobancolombia.com',
      industry: 'financial services',
    });

    const eligibility = evaluateApolloEnrichmentEligibility(bank, {
      targetCountryCode: 'CO',
      sector: SECTOR,
      subindustry: SUBINDUSTRY,
    });

    assert.equal(eligibility.eligible, false);
    assert.equal(
      eligibility.eligible === false ? eligibility.skipReason : null,
      'sector_relevance_contradicted',
    );
  });

  test('caso 11 — evidencia ausente SÍ puede competir por un enrichment bajo el cap', () => {
    const unknownSector = candidate({
      title: 'Distribuidora del Norte',
      domain: 'distribuidoradelnorte.com',
    });

    const eligibility = evaluateApolloEnrichmentEligibility(unknownSector, {
      targetCountryCode: 'CO',
      sector: SECTOR,
      subindustry: SUBINDUSTRY,
    });

    assert.equal(eligibility.eligible, true);
    assert.equal(
      eligibility.eligible === true ? eligibility.sectorDecision : null,
      'sector_evidence_missing_needs_enrichment',
    );
  });

  test('un sector sin mapping nunca autoriza gasto', () => {
    const anything = candidate({ title: 'Empresa X', domain: 'empresax.com', industry: 'mining' });

    const verdict = evaluateApolloSectorRelevanceForPaidOperation(
      anything,
      'Sector Inexistente',
      null,
    );

    assert.equal(verdict.decision, 'sector_not_mapped');
  });
});

// ─── Casos 7, 8: duplicados conocidos antes del enrichment ───────────────────

describe('§ 13 · duplicados conocidos antes del gasto', () => {
  test('caso 7 — citi.com ya conocido se descarta antes del enrichment, sin consumir crédito', () => {
    const citi = candidate({
      title: 'Citigroup Inc',
      domain: 'citi.com',
      industry: 'retail banking',
    });

    const eligibility = evaluateApolloEnrichmentEligibility(citi, {
      targetCountryCode: 'US',
      sector: SECTOR,
      subindustry: SUBINDUSTRY,
      alreadyProcessedDomains: new Set(['citi.com']),
    });

    assert.equal(eligibility.eligible, false);
    assert.equal(
      eligibility.eligible === false ? eligibility.skipReason : null,
      'organization_already_processed',
    );
  });

  test('caso 7-bis — un duplicado conocido nunca entra en la selección de enrichment', () => {
    const signals: FreeCandidateSignals[] = [
      {
        candidateKey: 'apollo:citi',
        roundNumber: 1,
        providerRank: 1,
        countryCompatible: true,
        domainConfident: true,
        ownershipConfident: true,
        sectorKeywordMatchCount: 0,
        novel: false,
        hasCompanySizeSignal: true,
        hasLocationSignal: true,
        hasLinkedInUrl: true,
        freeOfContradictoryEvidence: true,
        sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
        knownDuplicate: true,
        cooldownActive: false,
      },
    ];

    const selection = selectCandidatesForEnrichment({
      candidates: signals,
      remainingEnrichmentBudget: 2,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.deepEqual(selection.selected, []);
    assert.equal(selection.skipped[0]?.skippedReason, 'known_duplicate');
    assert.equal(selection.remainingEnrichmentBudget, 2);
  });

  test('caso 8 — un dominio ya conocido en HubSpot se descarta antes del enrichment', async () => {
    const enrichCalls: string[] = [];
    const result = await runApolloTwoRoundDiscovery(
      {
        config: testConfig(),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      {
        searchRound: async () => ({
          organizations: [org('hubspotdup', { providerRank: 1 })],
          providerRequestCount: 1,
          internalRecordedCredits: 1,
        }),
        assessCandidate: (): CheapAssessment =>
          rejectedAssessment('duplicate_in_hubspot', {
            sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
          }),
        enrichCandidate: async ({ candidateKey }) => {
          enrichCalls.push(candidateKey);
          return {
            executed: true,
            sectorEvidenceState: 'sector_evidence_confirmed',
            internalRecordedCredits: 1,
          };
        },
      },
    );

    assert.deepEqual(enrichCalls, []);
    assert.equal(result.runMetrics.totalEnrichmentCredits, 0);
    assert.equal(result.rounds[0]?.knownCompanyDuplicates, 1);
  });

  test('un candidato en cooldown nunca se enriquece', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [
        {
          candidateKey: 'apollo:cooldown',
          roundNumber: 1,
          providerRank: 1,
          countryCompatible: true,
          domainConfident: true,
          ownershipConfident: true,
          sectorKeywordMatchCount: 0,
          novel: true,
          hasCompanySizeSignal: true,
          hasLocationSignal: true,
          hasLinkedInUrl: true,
          freeOfContradictoryEvidence: true,
          sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
          knownDuplicate: false,
          cooldownActive: true,
        },
      ],
      remainingEnrichmentBudget: 2,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.deepEqual(selection.selected, []);
    assert.equal(selection.skipped[0]?.skippedReason, 'cooldown_active');
  });
});

// ─── § 6: selección económica ────────────────────────────────────────────────

describe('§ 6 · selección económica del enrichment', () => {
  function signals(
    key: string,
    overrides: Partial<FreeCandidateSignals> = {},
  ): FreeCandidateSignals {
    return {
      candidateKey: key,
      roundNumber: 1,
      providerRank: 1,
      countryCompatible: true,
      domainConfident: true,
      ownershipConfident: true,
      sectorKeywordMatchCount: 0,
      novel: true,
      hasCompanySizeSignal: true,
      hasLocationSignal: true,
      hasLinkedInUrl: true,
      freeOfContradictoryEvidence: true,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      knownDuplicate: false,
      cooldownActive: false,
      ...overrides,
    };
  }

  test('no se enriquece simplemente el primer resultado recibido', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [
        // Primero en llegar, pero con las peores señales gratuitas.
        signals('apollo:primero', {
          providerRank: 1,
          ownershipConfident: false,
          hasLinkedInUrl: false,
          hasCompanySizeSignal: false,
          hasLocationSignal: false,
          novel: false,
        }),
        signals('apollo:mejor', { providerRank: 2 }),
      ],
      remainingEnrichmentBudget: 1,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.equal(selection.selected.length, 1);
    assert.equal(selection.selected[0]?.candidateKey, 'apollo:mejor');
  });

  test('un sector ya confirmado no gasta un crédito en confirmarse otra vez', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [signals('apollo:confirmada', { sectorEvidenceState: 'sector_evidence_confirmed' })],
      remainingEnrichmentBudget: 2,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.deepEqual(selection.selected, []);
    assert.equal(selection.skipped[0]?.skippedReason, 'sector_evidence_already_confirmed');
  });

  test('alcanzado el objetivo, no se ejecuta ningún enrichment restante', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [signals('apollo:a'), signals('apollo:b')],
      remainingEnrichmentBudget: 2,
      eligibleCompaniesSoFar: 5,
      targetEligibleCompanies: 5,
    });

    assert.deepEqual(selection.selected, []);
    assert.equal(selection.skipped.length, 2);
    for (const skip of selection.skipped) {
      assert.equal(skip.skippedReason, 'target_already_reached');
    }
  });

  test('cada selección registra su motivo, y cada omisión el suyo', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [
        signals('apollo:elegida'),
        signals('apollo:contradicha', {
          sectorEvidenceState: 'sector_evidence_contradictory',
        }),
      ],
      remainingEnrichmentBudget: 1,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.equal(
      selection.selected[0]?.selectionReason,
      'resolves_missing_sector_evidence_highest_free_signal_rank',
    );
    assert.equal(selection.skipped[0]?.skippedReason, 'sector_evidence_contradictory');
  });

  test('la misma organización no recibe dos enrichments', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [signals('apollo:misma'), signals('apollo:misma', { providerRank: 2 })],
      remainingEnrichmentBudget: 2,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.equal(selection.selected.length, 1);
    assert.equal(selection.skipped[0]?.skippedReason, 'known_duplicate');
  });

  test('el orden de la selección es estable ante empates', () => {
    const build = () => [signals('apollo:b', { providerRank: 2 }), signals('apollo:a', { providerRank: 1 })];

    const first = selectCandidatesForEnrichment({
      candidates: build(),
      remainingEnrichmentBudget: 1,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });
    const second = selectCandidatesForEnrichment({
      candidates: build(),
      remainingEnrichmentBudget: 1,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.equal(first.selected[0]?.candidateKey, 'apollo:a');
    assert.deepEqual(
      first.selected.map((s) => s.candidateKey),
      second.selected.map((s) => s.candidateKey),
    );
  });

  test('un candidato ambiguo que el enrichment confirma pasa a contar para el objetivo', async () => {
    const result = await runApolloTwoRoundDiscovery(
      {
        config: testConfig({ targetEligibleCompanies: 1 }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      {
        searchRound: async () => ({
          organizations: [org('ambigua', { providerRank: 1 })],
          providerRequestCount: 1,
          internalRecordedCredits: 1,
        }),
        assessCandidate: () => ambiguousAssessment(),
        enrichCandidate: async () => ({
          executed: true,
          sectorEvidenceState: 'sector_evidence_confirmed',
          internalRecordedCredits: 1,
        }),
      },
    );

    assert.equal(result.eligibleCompaniesFound, 1);
    assert.equal(result.persisted[0]?.becameEligibleAfterEnrichment, true);
    assert.equal(result.runMetrics.enrichmentWaste, 0);
  });

  test('un candidato con el sector ya confirmado no consume presupuesto de enrichment', async () => {
    const enrichCalls: string[] = [];
    await runApolloTwoRoundDiscovery(
      {
        config: testConfig({ targetEligibleCompanies: 5 }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      {
        searchRound: async ({ roundNumber }) => ({
          organizations: roundNumber === 1 ? [org('confirmada', { providerRank: 1 })] : [],
          providerRequestCount: 1,
          internalRecordedCredits: 1,
        }),
        assessCandidate: () => passingAssessment(),
        enrichCandidate: async ({ candidateKey }) => {
          enrichCalls.push(candidateKey);
          return {
            executed: true,
            sectorEvidenceState: 'sector_evidence_confirmed',
            internalRecordedCredits: 1,
          };
        },
      },
    );

    assert.deepEqual(enrichCalls, []);
  });
});
