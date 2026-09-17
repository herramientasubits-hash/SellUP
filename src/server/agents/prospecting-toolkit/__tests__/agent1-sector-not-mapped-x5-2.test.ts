/**
 * agent1-sector-not-mapped-x5-2.test.ts
 *
 * AGENT1-SECTOR-NOT-MAPPED-X5.2 — la ausencia de catálogo NUESTRO deja de
 * rechazar empresas.
 *
 * ── Lo que la auditoría demostró ─────────────────────────────────────────────
 *
 * `sector_not_mapped` nace SIEMPRE de la ausencia de un artefacto nuestro:
 *
 *   `apollo-sector-relevance-gate.ts`  ← `if (!entry)`: no hay entrada en
 *                                        `SECTOR_SIGNAL_TERMS`
 *   `prospect-discovery-provider.ts`   ← no hay entrada en el catálogo macro
 *                                        (y ahí NO rechaza: enruta a otro
 *                                        proveedor. Colisión de nombres.)
 *   `production-runner.server.ts`      ← relleno sobre una candidata YA
 *                                        rechazada por otra causa
 *
 * La evidencia EN CONTRA la lleva en exclusiva `sector_evidence_contradictory`,
 * producida sólo donde `sectorPolicyPresent: true` y estructuralmente
 * inalcanzable desde la rama de `sector_not_mapped`: sin política no hay nada
 * que contradecir.
 *
 * ── La asimetría que cierra ──────────────────────────────────────────────────
 *
 * En una corrida SIN política sectorial, dos candidatas con evidencia idéntica
 * —ninguna— terminaban en cubos opuestos según el azar del cupo:
 *
 *   la que PAGÓ su enrichment  → vuelve `sector_not_mapped` → RECHAZADA
 *   la que no llegó a pagar    → `…missing_bootstrap_eligible` → sobrevive
 *
 * Gastar un crédito era lo que la mataba. Es la misma enfermedad que X5 curó
 * para el cap, un nivel más abajo.
 *
 * ── Los dos ejes que este corte separa ───────────────────────────────────────
 *
 *   SUPERVIVENCIA          la deciden los gates obligatorios
 *   AUTORIZACIÓN DE GASTO  la decide la política de catálogo
 *
 * Sin política NO se paga un enrichment —y eso no se toca— pero tampoco se
 * descarta la empresa.
 *
 * Offline: sin red, sin Apollo, sin Lusha, sin Supabase, sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySectorEvidence,
  decideCandidateSurvival,
} from '../candidate-survival';
import {
  evaluateCandidateTargetEligibility,
  toSubindustryMatchVerdict,
} from '../candidate-completeness-contract';
import {
  selectCandidatesForEnrichment,
  type FreeCandidateSignals,
} from '../apollo-two-round/enrichment-ranking';
import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
} from '../apollo-two-round/orchestrator';
import { evaluateApolloCandidateFinalDispositions } from '../apollo-two-round/candidate-final-disposition';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  simulatedEffectiveRequestBuilder,
  org,
  passingAssessment,
  ambiguousAssessment,
  rejectedAssessment,
} from '../apollo-two-round/__tests__/fixtures';

// ─── Arnés ────────────────────────────────────────────────────────────────────

function freeSignals(overrides: Partial<FreeCandidateSignals> = {}): FreeCandidateSignals {
  return {
    candidateKey: 'apollo:x',
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
    sectorEvidenceState: 'sector_not_mapped',
    knownDuplicate: false,
    cooldownActive: false,
    ...overrides,
  };
}

/**
 * Una corrida SIN política sectorial: todo el mundo llega con el sector sin
 * mapear. Es la forma del lote de Salud `f4c8a60f`, donde Apollo devolvió veinte
 * empresas sin un solo campo clasificatorio.
 */
async function runWithoutSectorPolicy(options: {
  count: number;
  maxEnrichmentsPerRun: number;
  /** Los que el enrichment devuelve CONTRADICHOS, por índice. */
  contradictoryIndexes?: readonly number[];
}) {
  const organizations = Array.from({ length: options.count }, (_u, i) =>
    org(`nomap${i + 1}`, { providerRank: i + 1 }),
  );
  const contradictory = new Set(options.contradictoryIndexes ?? []);

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async () => ({
      organizations,
      providerRequestCount: 1,
      internalRecordedCredits: options.count,
      providerTotalPages: 1,
    }),
    // Gates baratos limpios; el sector, sin política con que juzgarlo.
    assessCandidate: ({ organization }) => {
      const base = ambiguousAssessment();
      const index = Number(
        (organization.providerOrganizationId ?? '').replace('nomap', ''),
      );
      return {
        ...base,
        // El estado llega SIN rejection: el gate barato ya no lo convierte en uno.
        rejection: null,
        sectorEvidenceState: contradictory.has(index - 1)
          ? 'sector_evidence_missing_needs_enrichment'
          : 'sector_not_mapped',
      };
    },
    enrichCandidate: async ({ candidateKey }) => {
      const index = Number(candidateKey.replace('apollo:nomap', ''));
      return {
        executed: true,
        internalRecordedCredits: 1,
        sectorEvidenceState: contradictory.has(index - 1)
          ? 'sector_evidence_contradictory'
          : 'sector_not_mapped',
      };
    },
    applyFinalGates: () => ({ rejection: null }),
  };

  return runApolloTwoRoundDiscovery(
    {
      config: testConfig({
        targetEligibleCompanies: 5,
        maxRounds: 1,
        maxResultsPerRound: 40,
        maxRawResultsPerRun: 40,
        maxEnrichmentsPerRun: options.maxEnrichmentsPerRun,
      }),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
    },
    deps,
  );
}

// ══ A · LA REGLA PURA ════════════════════════════════════════════════════════

describe('X5.2 § A · ausencia de política ≠ evidencia en contra', () => {
  test('1 · política de sector AUSENTE ⇒ la empresa SOBREVIVE', () => {
    assert.equal(classifySectorEvidence('sector_not_mapped'), 'sector_evidence_absent');

    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_not_mapped',
    });
    assert.equal(decision.survives, true);
    assert.equal(decision.cohort, 'survives_incomplete');
    assert.equal(decision.rejectionReason, null);
    assert.equal(decision.incompletenessReason, 'sector_evidence_absent');
  });

  test('2 · doble ausencia —el proveedor calla Y no hay política— ⇒ SOBREVIVE', () => {
    // `…bootstrap_eligible` y `sector_not_mapped` son las dos caras de la misma
    // corrida sin catálogo: la primera antes de poder adquirir evidencia, la
    // segunda cuando adquirirla no habría creado la política que falta.
    for (const state of ['sector_evidence_missing_bootstrap_eligible', 'sector_not_mapped']) {
      const decision = decideCandidateSurvival({
        mandatoryRejection: null,
        sectorEvidenceState: state,
      });
      assert.equal(decision.survives, true, state);
      assert.equal(decision.cohort, 'survives_incomplete', state);
    }
  });

  test('3 · política PRESENTE y evidencia CONTRARIA ⇒ sigue rechazada', () => {
    assert.equal(
      classifySectorEvidence('sector_evidence_contradictory'),
      'sector_mandatory_rejection',
    );

    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_evidence_contradictory',
    });
    assert.equal(decision.survives, false);
    assert.equal(decision.cohort, 'rejected');
    assert.equal(decision.rejectionReason, 'sector_evidence_contradictory');
  });

  test('4 · `sector_not_mapped` NO cuenta automáticamente hacia el objetivo', () => {
    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_not_mapped',
    });
    assert.equal(decision.survives, true);
    // El contrato canónico —el mismo del writer— la deja fuera del conteo.
    const eligibility = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: toSubindustryMatchVerdict('sector_not_mapped'),
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.equal(
      eligibility.countsTowardTargetIfPersisted,
      false,
      'sobrevivir con el sector sin demostrar no es cumplir el objetivo',
    );
  });

  test('6 · provider-agnóstico: el veredicto no depende de quién lo trajo', () => {
    const veredicts = ['apollo', 'lusha', 'tavily', 'adaptador_futuro'].map(() =>
      JSON.stringify(
        decideCandidateSurvival({
          mandatoryRejection: null,
          sectorEvidenceState: 'sector_not_mapped',
        }),
      ),
    );
    assert.equal(new Set(veredicts).size, 1);
  });
});

// ══ B · EL GASTO NO SE RELAJA ════════════════════════════════════════════════

describe('X5.2 § B · sobrevivir no es autorización de compra', () => {
  test('5 · `sector_not_mapped` sigue SIN poder gastar un enrichment', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [
        freeSignals({
          candidateKey: 'apollo:sinpolitica',
          sectorEvidenceState: 'sector_not_mapped',
        }),
      ],
      remainingEnrichmentBudget: 5,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.equal(selection.selected.length, 0, 'cero enrichments autorizados');
    const skip = selection.skipped.find((entry) => entry.candidateKey === 'apollo:sinpolitica');
    assert.ok(skip, 'y queda registrado por qué no compitió');
    assert.equal(
      skip.skippedReason,
      'sector_not_mapped',
      'el descalificador categórico de la selección de enrichment NO se toca',
    );
  });

  test('5b · ni con presupuesto de sobra y compitiendo contra nadie', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [
        freeSignals({ candidateKey: 'apollo:a', sectorEvidenceState: 'sector_not_mapped' }),
        freeSignals({ candidateKey: 'apollo:b', sectorEvidenceState: 'sector_not_mapped' }),
      ],
      remainingEnrichmentBudget: 99,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 99,
    });
    assert.equal(selection.selected.length, 0);
  });

  test('una corrida ENTERA sin política no gasta un solo crédito de enrichment', async () => {
    const result = await runWithoutSectorPolicy({ count: 12, maxEnrichmentsPerRun: 5 });
    assert.equal(
      result.runMetrics.enrichmentsExecuted,
      0,
      'sin política no se paga: comprar descripción no crea la política que falta',
    );
  });
});

// ══ C · EXTREMO A EXTREMO ════════════════════════════════════════════════════

describe('X5.2 § C · la corrida sin política ya no entrega cero', () => {
  test('12 empresas limpias sin política: las 12 sobreviven a revisión', async () => {
    const result = await runWithoutSectorPolicy({ count: 12, maxEnrichmentsPerRun: 5 });

    assert.equal(result.runMetrics.totalUniqueOrganizations, 12);
    assert.equal(result.reviewOnly.length, 12, 'ninguna desaparece por falta de catálogo');
    assert.equal(result.persisted.length, 0, 'y ninguna es elegible: su sector no está demostrado');

    const dispositions = evaluateApolloCandidateFinalDispositions(result);
    for (const entry of dispositions) {
      assert.equal(entry.finalDisposition, 'persisted_review_only_final');
      assert.equal(entry.finalReason, null);
    }
  });

  test('🔴 la asimetría MUERE: pagar ya no empeora a nadie', async () => {
    // Doce sin política; el cupo permite cinco enrichments. Antes de este corte,
    // las cinco que pagaran habrían vuelto `sector_not_mapped` y habrían muerto,
    // mientras las siete restantes sobrevivían. Ahora el cupo es irrelevante
    // para la supervivencia — y de hecho ninguna llega a pagar (§ B).
    const conCupo = await runWithoutSectorPolicy({ count: 12, maxEnrichmentsPerRun: 5 });
    const sinCupo = await runWithoutSectorPolicy({ count: 12, maxEnrichmentsPerRun: 0 });

    assert.equal(conCupo.reviewOnly.length, sinCupo.reviewOnly.length);
    assert.equal(conCupo.reviewOnly.length, 12);
    assert.equal(
      conCupo.runMetrics.enrichmentsExecuted,
      sinCupo.runMetrics.enrichmentsExecuted,
      'el cupo no cambia NADA cuando no hay política: ni gasto ni supervivencia',
    );
  });

  test('7 · regresión: la contradicción sigue matando, también aquí', async () => {
    // Dos de las doce llegan con política y evidencia ambigua; su enrichment las
    // contradice. Ésas SÍ se rechazan: hay evidencia sobre la empresa.
    const result = await runWithoutSectorPolicy({
      count: 12,
      maxEnrichmentsPerRun: 5,
      contradictoryIndexes: [0, 1],
    });

    const dispositions = evaluateApolloCandidateFinalDispositions(result);
    const rejected = dispositions.filter(
      (entry) => entry.finalDisposition === 'sector_subindustry_rejected_final',
    );
    assert.equal(rejected.length, 2, 'las dos contradichas siguen rechazadas');
    for (const entry of rejected) {
      assert.equal(entry.finalReason, 'sector_evidence_contradictory');
    }
    assert.equal(result.reviewOnly.length, 10, 'las otras diez sobreviven');
  });

  test('7b · regresión: los gates obligatorios REALES no se tocan', async () => {
    const organizations = [
      org('pais', { providerRank: 1 }),
      org('dominio', { providerRank: 2 }),
      org('owner', { providerRank: 3 }),
      org('dup', { providerRank: 4 }),
      org('sinpolitica', { providerRank: 5 }),
    ];
    const rejections: Record<string, Parameters<typeof rejectedAssessment>[0]> = {
      pais: 'country_incompatible',
      dominio: 'invalid_domain',
      owner: 'ownership_mismatch',
      dup: 'duplicate_in_hubspot',
    };

    const result = await runApolloTwoRoundDiscovery(
      {
        config: testConfig({ maxRounds: 1, maxResultsPerRound: 10, maxRawResultsPerRun: 10 }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      {
        buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
        searchRound: async () => ({
          organizations,
          providerRequestCount: 1,
          internalRecordedCredits: 5,
          providerTotalPages: 1,
        }),
        assessCandidate: ({ organization }) => {
          const id = organization.providerOrganizationId ?? '';
          const rejection = rejections[id];
          if (rejection) return rejectedAssessment(rejection);
          return { ...passingAssessment(), sectorEvidenceState: 'sector_not_mapped' };
        },
        enrichCandidate: async () => ({
          executed: false,
          internalRecordedCredits: 0,
          sectorEvidenceState: 'sector_not_mapped',
        }),
        applyFinalGates: () => ({ rejection: null }),
      },
    );

    const dispositions = evaluateApolloCandidateFinalDispositions(result);
    const byKey = new Map(dispositions.map((entry) => [entry.candidateKey, entry]));
    assert.equal(byKey.get('apollo:pais')?.finalDisposition, 'country_rejected_final');
    // 🔴 X6.9 — `invalid_domain` deja de archivarse como ownership: el gate de
    // ownership nunca corrió sobre una candidata SIN dominio. El rechazo es el
    // mismo —sigue siendo un gate obligatorio y sigue siendo terminal—, sólo
    // cambia a qué se atribuye. Es exactamente lo que este § dice defender:
    // los gates REALES no se tocan.
    assert.equal(byKey.get('apollo:dominio')?.finalDisposition, 'missing_domain_final');
    assert.equal(byKey.get('apollo:dominio')?.finalReason, 'invalid_domain');
    assert.equal(byKey.get('apollo:owner')?.finalDisposition, 'ownership_rejected_final');
    assert.equal(byKey.get('apollo:dup')?.finalDisposition, 'hubspot_duplicate_final');
    // La única sin causa real sobrevive.
    assert.equal(byKey.get('apollo:sinpolitica')?.finalDisposition, 'persisted_review_only_final');
  });
});

// ══ D · MUTACIONES ═══════════════════════════════════════════════════════════

describe('X5.2 § D · mutaciones', () => {
  /**
   * 🔴 M1 · devolver `sector_not_mapped` al grupo de rechazos.
   *
   * La mutación: sacarlo de `SECTOR_EVIDENCE_ABSENT_STATES`, con lo que el
   * fail-closed de `classifySectorEvidence` lo captura como rechazo obligatorio.
   */
  test('🔴 M1 · `sector_not_mapped` no puede volver a rechazar', () => {
    assert.equal(classifySectorEvidence('sector_not_mapped'), 'sector_evidence_absent');
    assert.notEqual(
      decideCandidateSurvival({
        mandatoryRejection: null,
        sectorEvidenceState: 'sector_not_mapped',
      }).cohort,
      'rejected',
    );
  });

  /**
   * 🔴 M2 · hacer que sobrevivir implique contar.
   *
   * Es la mutación que «arregla» el síntoma inflando el objetivo: doce
   * supervivientes sin sector demostrado contarían como objetivo cumplido.
   */
  test('🔴 M2 · sobrevivir sin política NO cuenta hacia el objetivo', async () => {
    const result = await runWithoutSectorPolicy({ count: 12, maxEnrichmentsPerRun: 5 });

    assert.equal(result.reviewOnly.length, 12, 'doce sobreviven…');
    assert.equal(result.runMetrics.stableFinalizableCandidateCount, 0, '…y cero cuentan');
    assert.equal(result.targetReached, false);
    assert.equal(result.resultStatus, 'partial_target_not_reached');
  });

  /**
   * 🔴 M3 · convertir la supervivencia en autorización de gasto.
   *
   * La mutación más cara de todas: si alguien quita `sector_not_mapped` de
   * `disqualifyCategorically` «para que sea coherente con que sobreviva», la
   * corrida empieza a pagar enrichments que no pueden resolver nada, porque lo
   * que falta es una política nuestra.
   */
  test('🔴 M3 · sobrevivir NO autoriza comprar', async () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [freeSignals({ sectorEvidenceState: 'sector_not_mapped' })],
      remainingEnrichmentBudget: 5,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });
    assert.equal(selection.selected.length, 0);
    assert.equal(selection.skipped[0]?.skippedReason, 'sector_not_mapped');

    const result = await runWithoutSectorPolicy({ count: 12, maxEnrichmentsPerRun: 5 });
    assert.equal(result.runMetrics.enrichmentsExecuted, 0);
    assert.equal(result.runMetrics.totalEnrichmentCredits, 0);
  });

  /**
   * 🔴 M4 · dejar sobrevivir a la contradicha.
   *
   * La mutación simétrica, y la que convierte este corte en «aceptar todo».
   */
  test('🔴 M4 · `sector_evidence_contradictory` no puede sobrevivir', async () => {
    assert.equal(
      decideCandidateSurvival({
        mandatoryRejection: null,
        sectorEvidenceState: 'sector_evidence_contradictory',
      }).survives,
      false,
    );

    const result = await runWithoutSectorPolicy({
      count: 3,
      maxEnrichmentsPerRun: 5,
      contradictoryIndexes: [0],
    });
    const contradicted = result.reviewOnly.find(
      (entry) => entry.candidateKey === 'apollo:nomap1',
    );
    assert.equal(contradicted, undefined, 'la contradicha no entra en revisión');
  });
});
