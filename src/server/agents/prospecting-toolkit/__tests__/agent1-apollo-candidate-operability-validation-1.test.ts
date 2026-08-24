/**
 * AGENT1-APOLLO-CANDIDATE-OPERABILITY-VALIDATION-1 — un candidato real de una
 * corrida real se puede operar, y la ficha no afirma ausencias falsas.
 *
 * Los dos defectos que esta suite fija, medidos en la corrida live `b3afe066…`
 * (candidato `f526cd07…`, Supertiendas Cañaveral, `supertiendascanaveral.com.co`,
 * runtime `89563be5`):
 *
 *   § A  `record_origin = NULL` en las OCHO filas de Apollo en Producción. La cola
 *        de revisión limpia exige `record_origin = 'production'`, así que ninguna
 *        se podía aprobar ni descartar. No era un defecto de Apollo: el writer
 *        canónico NUNCA escribió la columna. Los `web_ai` con `'production'` (61)
 *        vienen todos de un backfill único —`classification_source =
 *        'derived_status'`— y los 22 `web_ai` escritos DESPUÉS de aquel backfill
 *        están igual de NULL. Apollo sólo lo hizo visible por ser la única
 *        procedencia sin backfill histórico.
 *
 *   § D  `scoring.warnings = ['LinkedIn no disponible.']` en una fila con
 *        `linkedin_url` en columna, `linkedin_mapping_status = 'confirmed'` y
 *        `persistence_mode = 'column'`. La causa era el ORDEN:
 *        `captureApolloCompanyFields()` corría DESPUÉS de `scoreCandidate()`, así
 *        que el scorer nunca recibía `linkedinCompanyUrl`.
 *
 *   § G  `rich_profile.notes.missing_fields = ['linkedin_url','subindustry','city',
 *        'size']` en una fila que tenía los CUATRO (`city = 'Cali'`, `subindustry
 *        = 'Supermercados e Hipermercados'`, `employee_count = 2000`). El perfil se
 *        congelaba con el estado pre-enrichment y nadie lo refrescaba.
 *
 *   § H  `final_state_consistency.ok = false` con `unclassified = 1` mientras
 *        `candidate_final_dispositions` cerraba 17/17 con `unclassified_count = 0`
 *        y `unexplained_gap = 0`.
 *
 * Todo offline: sin Apollo real, sin Tavily real, sin Supabase real, sin
 * escrituras en Producción, sin HubSpot, sin gasto y sin créditos. Los patrones
 * son sintéticos; ninguna empresa real está codificada.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CANONICAL_PRODUCTION_RECORD_ORIGIN,
  resolveCandidateRecordOriginForWriter,
  toCandidateRecordOriginColumns,
  toCandidateRecordOriginMetadata,
} from '../candidate-record-origin';
import {
  describeLinkedinAvailability,
  reconcileScoringForLinkedinAvailability,
  resolveEffectiveLinkedinCompanyUrl,
  toLinkedinAvailabilityMetadata,
} from '../candidate-linkedin-availability';
import {
  LINKEDIN_ABSENT_WARNING,
  LINKEDIN_PRESENCE_SCORE_COMPONENT,
  scoreCandidate,
} from '../candidate-scorer';
import {
  buildCandidateRichProfileV1,
  computeRichProfileMissingFields,
  refreshCandidateRichProfileWithEffectiveTruth,
} from '../candidate-rich-profile';
import {
  buildApolloPersistenceReconciliation,
  buildPostWriterStateConsistency,
  reconcileApolloTwoRoundPersistedTruth,
} from '../apollo-persisted-candidate-truth';
import { captureApolloEnrichmentForPersistence } from '../apollo-enrichment-persistence-capture';
import { assessApolloSubindustryPrecisionForRequest } from '../apollo-subindustry-precision';
import { writeProspectingCandidates } from '../candidate-writer';
import type { CandidateScoringOutput, CandidateWriterInput, WebSearchResult } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { evaluateApproveEligibility } from '@/modules/prospect-review/approve-eligibility';
import { evaluateConvertApproveEligibility } from '@/modules/prospect-review/approve-and-convert-eligibility';
import { evaluateDiscardEligibility } from '@/modules/prospect-review/discard-eligibility';
import { evaluateDuplicateEligibility } from '@/modules/prospect-review/duplicate-eligibility';
import { PENDING_REVIEW_RECORD_ORIGIN } from '@/modules/prospect-review/queries';

import { preM126Rpc } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
const MAPPED_SUBINDUSTRY = 'Supermercados e Hipermercados';
const LINKEDIN_URL = 'https://www.linkedin.com/company/synthetic-market-chain';

// ─────────────────────────────────────────────────────────────────────────────
// § A · record_origin — la procedencia la declara quien crea la fila
// ─────────────────────────────────────────────────────────────────────────────

describe('§ A · record_origin canónico desde el writer', () => {
  const productionCandidate = {
    status: 'needs_review',
    duplicate_status: 'new_candidate',
    source_primary: 'apollo',
    review_notes: null,
    metadata: {},
  };

  const productionBatch = {
    source: 'agent_1',
    name: 'Agente 1 · Pipeline · Colombia · Retail y Consumo',
    metadata: {},
  };

  it('una corrida REAL de Agent 1 Apollo resuelve production', () => {
    const resolution = resolveCandidateRecordOriginForWriter({
      dryRun: false,
      candidate: productionCandidate,
      batch: productionBatch,
    });

    assert.equal(resolution.recordOrigin, CANONICAL_PRODUCTION_RECORD_ORIGIN);
    assert.equal(resolution.recordOrigin, 'production');
    assert.equal(resolution.rejectionReason, null);
    assert.equal(resolution.isCleanProduction, true);
  });

  it('una corrida en seco NO etiqueta production — devuelve ausencia', () => {
    const resolution = resolveCandidateRecordOriginForWriter({
      dryRun: true,
      candidate: productionCandidate,
      batch: productionBatch,
    });

    assert.equal(resolution.recordOrigin, null);
    assert.equal(resolution.isCleanProduction, false);
    // Y la proyección a columnas queda VACÍA: sin clave, la columna no se toca.
    assert.deepEqual(toCandidateRecordOriginColumns(resolution), {});
  });

  it('un marcador de smoke gana sobre production, aunque dryRun sea false', () => {
    const resolution = resolveCandidateRecordOriginForWriter({
      dryRun: false,
      candidate: { ...productionCandidate, metadata: { smoke_test: true } },
      batch: productionBatch,
    });

    assert.equal(resolution.recordOrigin, 'smoke_test');
    assert.notEqual(resolution.recordOrigin, 'production');
    assert.equal(resolution.isCleanProduction, false);
  });

  it('un marcador de QA en el LOTE tampoco se asciende', () => {
    const resolution = resolveCandidateRecordOriginForWriter({
      dryRun: false,
      candidate: productionCandidate,
      batch: { ...productionBatch, name: 'Agente 1 · QA · Colombia' },
    });

    assert.equal(resolution.recordOrigin, 'qa');
    assert.equal(resolution.isCleanProduction, false);
  });

  it('un duplicado sigue siendo production, con su motivo de rechazo', () => {
    const resolution = resolveCandidateRecordOriginForWriter({
      dryRun: false,
      candidate: { ...productionCandidate, status: 'duplicate' },
      batch: productionBatch,
    });

    assert.equal(resolution.recordOrigin, 'production');
    assert.equal(resolution.rejectionReason, 'duplicate');
    assert.deepEqual(toCandidateRecordOriginColumns(resolution), {
      record_origin: 'production',
      rejection_reason: 'duplicate',
    });
  });

  it('la proyección NUNCA escribe classification_source ni classification_confidence', () => {
    // Contrato explícito: esas dos columnas las gobierna el proyector del
    // enrichment de Apollo y el § 7 de #241 exige que queden intactas sin
    // subindustria confirmada. Escribirlas desde aquí las convertiría en columnas
    // con dos escritores y dos semánticas — y fue el vocabulario equivocado en
    // `classification_source` lo que produjo el 23514 de FORENSICS-1.
    const columns = toCandidateRecordOriginColumns(
      resolveCandidateRecordOriginForWriter({
        dryRun: false,
        candidate: productionCandidate,
        batch: productionBatch,
      }),
    );

    assert.equal('classification_source' in columns, false);
    assert.equal('classification_confidence' in columns, false);
    assert.deepEqual(Object.keys(columns), ['record_origin']);
  });

  it('la derivación viaja auditable en metadata, sin perder la fuente ni la confianza', () => {
    const metadata = toCandidateRecordOriginMetadata(
      resolveCandidateRecordOriginForWriter({
        dryRun: false,
        candidate: productionCandidate,
        batch: productionBatch,
      }),
    );

    assert.equal(metadata.record_origin, 'production');
    assert.equal(metadata.decided_by, 'canonical_writer');
    const derivation = metadata.derivation as Record<string, unknown>;
    assert.equal(derivation.matched_rule, 'production_status');
    assert.equal(typeof derivation.derived_confidence, 'number');
  });

  it('record_origin y source_primary son dimensiones distintas', () => {
    // Misma clase de corrida, proveedores distintos: `record_origin` no puede
    // derivarse de `source_primary` ni sustituirse por él.
    for (const sourcePrimary of ['apollo', 'web_ai', 'lusha']) {
      const resolution = resolveCandidateRecordOriginForWriter({
        dryRun: false,
        candidate: { ...productionCandidate, source_primary: sourcePrimary },
        batch: productionBatch,
      });
      assert.equal(resolution.recordOrigin, 'production', sourcePrimary);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § B · los cuatro gates de la cola limpia siguen exigiendo production
// ─────────────────────────────────────────────────────────────────────────────

describe('§ B · review actions — el gate de origen se preserva', () => {
  const GATES = [
    {
      name: 'approve',
      run: (recordOrigin: string | null) =>
        evaluateApproveEligibility({
          status: 'needs_review',
          recordOrigin,
          duplicateStatus: 'new_candidate',
        }),
      pass: 'approve',
    },
    {
      name: 'approve + convert',
      run: (recordOrigin: string | null) =>
        evaluateConvertApproveEligibility({
          status: 'needs_review',
          recordOrigin,
          duplicateStatus: 'new_candidate',
          convertedAccountId: null,
          matchedHubspotCompanyId: null,
        }),
      pass: 'convert',
    },
    {
      name: 'discard',
      run: (recordOrigin: string | null) =>
        evaluateDiscardEligibility({ status: 'needs_review', recordOrigin }),
      pass: 'discard',
    },
    {
      name: 'mark duplicate',
      run: (recordOrigin: string | null) =>
        evaluateDuplicateEligibility({ status: 'needs_review', recordOrigin }),
      pass: 'mark_duplicate',
    },
  ] as const;

  for (const gate of GATES) {
    it(`${gate.name} — un candidato Apollo de producción PASA el gate de origen`, () => {
      const decision = gate.run(CANONICAL_PRODUCTION_RECORD_ORIGIN);
      assert.equal(decision.decision, gate.pass);
    });

    it(`${gate.name} — record_origin NULL sigue RECHAZADO`, () => {
      const decision = gate.run(null);
      assert.equal(decision.decision, 'reject');
      assert.equal(
        (decision as { reason: string }).reason,
        'not_clean_production',
      );
    });

    for (const nonProduction of ['smoke_test', 'qa', 'import', 'historical_cleanup', 'synthetic', 'unknown']) {
      it(`${gate.name} — record_origin '${nonProduction}' sigue RECHAZADO`, () => {
        const decision = gate.run(nonProduction);
        assert.equal(decision.decision, 'reject');
        assert.equal((decision as { reason: string }).reason, 'not_clean_production');
      });
    }
  }

  it('el valor que el writer escribe es EXACTAMENTE el que la cola consulta', () => {
    // Si estos dos se separan, el writer volvería a producir filas inoperables
    // sin que ningún test lo notara.
    assert.equal(CANONICAL_PRODUCTION_RECORD_ORIGIN, PENDING_REVIEW_RECORD_ORIGIN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § D · la URL canónica llega al scorer ANTES de evaluar la advertencia
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_SOURCE = readFileSync(
  path.join(import.meta.dirname, '..', 'prospecting-pipeline.ts'),
  'utf8',
);

describe('§ D · orden — la captura del proveedor precede al scoring', () => {
  it('en el constructor canónico, captureApolloCompanyFields va ANTES de scoreCandidate', () => {
    // Éste es el defecto de origen y es un defecto de ORDEN: no falla al
    // compilar, no rompe ningún tipo y sólo se ve leyendo la secuencia. La
    // regresión sería silenciosa, así que se anda sobre el fuente.
    const builderStart = PIPELINE_SOURCE.indexOf('export async function buildProspectingPipelineCandidate');
    assert.ok(builderStart > 0, 'no se encontró el constructor canónico');

    const builderBody = PIPELINE_SOURCE.slice(builderStart);
    const captureAt = builderBody.indexOf('captureApolloCompanyFields(');
    const scoreAt = builderBody.indexOf('scoreCandidate({');

    assert.ok(captureAt > 0, 'el constructor ya no captura los campos del proveedor');
    assert.ok(scoreAt > 0, 'el constructor ya no puntúa el candidato');
    assert.ok(
      captureAt < scoreAt,
      'captureApolloCompanyFields debe ejecutarse ANTES de scoreCandidate',
    );
  });

  it('los DOS call sites del scorer reciben linkedinCompanyUrl', () => {
    const callSites = PIPELINE_SOURCE.split('scoreCandidate({').length - 1;
    assert.equal(callSites, 2, 'cambió el número de call sites del scorer');

    const withLinkedin = PIPELINE_SOURCE.split('linkedinCompanyUrl:').length - 1;
    assert.ok(
      withLinkedin >= 2,
      'algún call site de scoreCandidate dejó de recibir linkedinCompanyUrl',
    );
  });
});

describe('§ D/F · el scorer y la advertencia de LinkedIn', () => {
  const baseScoringInput = {
    name: 'Cadena Sintetica de Mercados',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail y Consumo',
    website: 'https://www.cadenasintetica.com.co',
    domain: 'cadenasintetica.com.co',
    sourceTitle: 'Cadena Sintetica de Mercados',
    sourceSnippet: 'Empresa: Cadena Sintetica | Pais: Colombia',
  };

  it('SIN URL — la advertencia de ausencia está presente y es cierta', () => {
    const scoring = scoreCandidate({ ...baseScoringInput, linkedinCompanyUrl: null });
    assert.ok(scoring.warnings.includes(LINKEDIN_ABSENT_WARNING));
  });

  it('CON URL — la advertencia de ausencia desaparece', () => {
    const scoring = scoreCandidate({ ...baseScoringInput, linkedinCompanyUrl: LINKEDIN_URL });
    assert.equal(scoring.warnings.includes(LINKEDIN_ABSENT_WARNING), false);
  });

  it('paridad de puntuación: la presencia aporta el componente canónico, en confianza y en completitud', () => {
    const without = scoreCandidate({ ...baseScoringInput, linkedinCompanyUrl: null });
    const with_ = scoreCandidate({ ...baseScoringInput, linkedinCompanyUrl: LINKEDIN_URL });

    assert.equal(
      with_.confidenceScore - without.confidenceScore,
      LINKEDIN_PRESENCE_SCORE_COMPONENT,
    );
    assert.equal(
      with_.dataCompletenessScore - without.dataCompletenessScore,
      LINKEDIN_PRESENCE_SCORE_COMPONENT,
    );
    assert.equal(LINKEDIN_PRESENCE_SCORE_COMPONENT, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § E · disponibilidad ≠ verificación
// ─────────────────────────────────────────────────────────────────────────────

function confirmedCapture() {
  return {
    companyLinkedInUrl: LINKEDIN_URL,
    status: 'confirmed' as const,
    sourceProvider: 'apollo' as const,
    sourceOperation: 'organizations_search' as const,
    observedAt: '2026-08-11T14:06:18.873Z',
    rawValue: LINKEDIN_URL,
    reason: null,
  };
}

describe('§ E · disponibilidad y verificación son dos preguntas', () => {
  it('sin URL ⇒ absent, y ése es el ÚNICO estado que dice «no disponible»', () => {
    const availability = describeLinkedinAvailability({
      providerCapture: null,
      writerEnrichment: null,
    });

    assert.equal(availability.state, 'absent');
    assert.equal(availability.isAvailable, false);
    assert.equal(availability.isVerified, false);
    assert.match(availability.label, /no disponible/);
  });

  it('URL confirmada por el proveedor SIN verificación ⇒ disponible · verificación pendiente', () => {
    const availability = describeLinkedinAvailability({
      providerCapture: confirmedCapture(),
      writerEnrichment: null,
    });

    assert.equal(availability.state, 'available_verification_pending');
    assert.equal(availability.isAvailable, true);
    assert.equal(availability.isVerified, false);
    // La afirmación crítica: NUNCA dice «no disponible» habiendo URL.
    assert.doesNotMatch(availability.label, /no disponible/);
    assert.match(availability.label, /verificaci/i);
  });

  it('verificación AMBIGUA no convierte la URL en ausente', () => {
    const availability = describeLinkedinAvailability({
      providerCapture: confirmedCapture(),
      writerEnrichment: { status: 'ambiguous', company_url: LINKEDIN_URL, confidence: 40 },
    });

    assert.notEqual(availability.state, 'absent');
    assert.equal(availability.isAvailable, true);
    assert.equal(availability.isVerified, false);
    assert.doesNotMatch(availability.label, /no disponible/);
  });

  it('mapping_status=confirmed NO es «verificado» por sí solo', () => {
    const availability = describeLinkedinAvailability({
      providerCapture: confirmedCapture(),
      writerEnrichment: null,
    });
    assert.equal(availability.isVerified, false);
  });

  it('sólo un enrichment `found` con confianza suficiente verifica', () => {
    const verified = describeLinkedinAvailability({
      providerCapture: confirmedCapture(),
      writerEnrichment: { status: 'found', company_url: LINKEDIN_URL, confidence: 85 },
    });
    assert.equal(verified.state, 'available_verified');
    assert.equal(verified.isVerified, true);

    const lowConfidence = describeLinkedinAvailability({
      providerCapture: confirmedCapture(),
      writerEnrichment: { status: 'found', company_url: LINKEDIN_URL, confidence: 40 },
    });
    assert.equal(lowConfidence.isVerified, false);
    assert.equal(lowConfidence.isAvailable, true);
  });

  it('la precedencia de la URL es la MISMA que la de la columna: proveedor > enrichment', () => {
    const fromProvider = resolveEffectiveLinkedinCompanyUrl({
      providerCapture: confirmedCapture(),
      writerEnrichment: { status: 'found', company_url: 'https://www.linkedin.com/company/otra' },
    });
    assert.equal(fromProvider.url, LINKEDIN_URL);
    assert.equal(fromProvider.origin, 'provider');

    const fromEnrichment = resolveEffectiveLinkedinCompanyUrl({
      providerCapture: null,
      writerEnrichment: { status: 'found', company_url: LINKEDIN_URL },
    });
    assert.equal(fromEnrichment.url, LINKEDIN_URL);
    assert.equal(fromEnrichment.origin, 'writer_enrichment');
  });

  it('el metadata publica disponibilidad y verificación como campos SEPARADOS', () => {
    const availability = describeLinkedinAvailability({
      providerCapture: confirmedCapture(),
      writerEnrichment: null,
    });
    const metadata = toLinkedinAvailabilityMetadata(availability, {
      absentWarningRemoved: true,
      appliedScoreComponent: LINKEDIN_PRESENCE_SCORE_COMPONENT,
    });

    assert.equal(metadata.is_available, true);
    assert.equal(metadata.is_verified, false);
    assert.equal(metadata.state, 'available_verification_pending');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § F · reconciliación del scoring cuando la URL llega tarde
// ─────────────────────────────────────────────────────────────────────────────

function scoringWithAbsentWarning(): CandidateScoringOutput {
  return {
    confidenceScore: 75,
    fitScore: 45,
    dataCompletenessScore: 65,
    qualityLabel: 'needs_review',
    recommendedAction: 'review_manually',
    breakdown: {
      existenceSignals: 75,
      websiteSignals: 25,
      duplicateSignals: 15,
      sourceSignals: 10,
      fitSignals: 45,
      completenessSignals: 65,
      penalties: 0,
    },
    reasons: ['País identificado.'],
    warnings: [LINKEDIN_ABSENT_WARNING],
    blockers: [],
    fitBreakdown: null,
  };
}

describe('§ F · el scoring reconciliado', () => {
  const available = { isAvailable: true } as const;
  const absent = { isAvailable: false } as const;

  it('con URL y advertencia presente: la retira y aplica el componente una vez', () => {
    const before = scoringWithAbsentWarning();
    const { scoring, absentWarningRemoved, appliedScoreComponent } =
      reconcileScoringForLinkedinAvailability(before, available);

    assert.equal(absentWarningRemoved, true);
    assert.equal(appliedScoreComponent, LINKEDIN_PRESENCE_SCORE_COMPONENT);
    assert.equal(scoring.warnings.includes(LINKEDIN_ABSENT_WARNING), false);
    // Las cifras exactas de la corrida `b3afe066`: 75 → 80 y 65 → 70.
    assert.equal(scoring.confidenceScore, 80);
    assert.equal(scoring.dataCompletenessScore, 70);
  });

  it('sin URL: no toca nada — la advertencia es cierta', () => {
    const before = scoringWithAbsentWarning();
    const { scoring, absentWarningRemoved, appliedScoreComponent } =
      reconcileScoringForLinkedinAvailability(before, absent);

    assert.equal(absentWarningRemoved, false);
    assert.equal(appliedScoreComponent, 0);
    assert.ok(scoring.warnings.includes(LINKEDIN_ABSENT_WARNING));
    assert.equal(scoring.confidenceScore, 75);
  });

  it('idempotente: si el scorer YA vio la URL, no vuelve a sumar', () => {
    const alreadyCounted: CandidateScoringOutput = {
      ...scoringWithAbsentWarning(),
      confidenceScore: 80,
      dataCompletenessScore: 70,
      warnings: [],
    };

    const first = reconcileScoringForLinkedinAvailability(alreadyCounted, available);
    assert.equal(first.appliedScoreComponent, 0);
    assert.equal(first.scoring.confidenceScore, 80);

    // Y aplicarlo dos veces sobre su propio resultado tampoco acumula.
    const second = reconcileScoringForLinkedinAvailability(first.scoring, available);
    assert.equal(second.scoring.confidenceScore, 80);
    assert.equal(second.scoring.dataCompletenessScore, 70);
  });

  it('no muta el scoring recibido', () => {
    const before = scoringWithAbsentWarning();
    const snapshot = JSON.stringify(before);
    reconcileScoringForLinkedinAvailability(before, available);
    assert.equal(JSON.stringify(before), snapshot);
  });

  it('el fit NO se toca aquí: el fit responde a la verificación, no a la disponibilidad', () => {
    const before = scoringWithAbsentWarning();
    const { scoring } = reconcileScoringForLinkedinAvailability(before, available);
    assert.equal(scoring.fitScore, before.fitScore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § G · rich_profile — missing_fields describe ausencias REALES
// ─────────────────────────────────────────────────────────────────────────────

describe('§ G · rich_profile con la verdad post-enrichment', () => {
  function baseProfile() {
    return buildCandidateRichProfileV1({
      name: 'Cadena Sintetica de Mercados',
      website: 'https://www.cadenasintetica.com.co',
      domain: 'cadenasintetica.com.co',
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Retail y Consumo',
      sourceUrl: 'https://www.cadenasintetica.com.co',
      sourceTitle: 'Cadena Sintetica de Mercados',
      sourceSnippet: 'Empresa: Cadena Sintetica | Pais: Colombia',
      confidenceScore: 75,
      fitScore: 45,
      clockFn: () => '2026-08-11T14:06:51.558Z',
    });
  }

  it('el estado PRE-enrichment declara las cuatro ausencias — y en ese momento son ciertas', () => {
    const profile = baseProfile();
    const missing = profile.notes.missing_fields ?? [];

    // Reproduce exactamente lo que la corrida `b3afe066` persistió.
    assert.deepEqual(missing, ['linkedin_url', 'subindustry', 'city', 'size']);
  });

  it('tras el refresco, ninguna de las cuatro figura como ausente', () => {
    const refreshed = refreshCandidateRichProfileWithEffectiveTruth(baseProfile(), {
      linkedin: { url: LINKEDIN_URL, state: 'available_unverified' },
      city: 'Cali',
      subindustry: MAPPED_SUBINDUSTRY,
      employeeCount: 2000,
    });

    assert.deepEqual(refreshed.notes.missing_fields, []);
    assert.equal(refreshed.company.linkedin_url, LINKEDIN_URL);
    assert.equal(refreshed.location.city, 'Cali');
    assert.equal(refreshed.classification.subindustry, MAPPED_SUBINDUSTRY);
    assert.equal(refreshed.size.estimated_range, '2000');
    assert.notEqual(refreshed.size.status, 'unknown');
  });

  it('la nota ejecutiva deja de afirmar «sin perfil de LinkedIn» sobre una URL presente', () => {
    const before = baseProfile();
    assert.match(String(before.notes.executive_note), /sin perfil de LinkedIn/);

    const refreshed = refreshCandidateRichProfileWithEffectiveTruth(before, {
      linkedin: { url: LINKEDIN_URL, state: 'available_unverified' },
    });

    const note = String(refreshed.notes.executive_note);
    assert.doesNotMatch(note, /sin perfil de LinkedIn/);
    // Y distingue «disponible sin verificar» de «verificado»: no promete lo que
    // la evidencia no sostiene.
    assert.match(note, /sin verificaci/i);
    assert.doesNotMatch(note, /LinkedIn verificado/);
  });

  it('presente-pero-no-verificado NO es lo mismo que ausente', () => {
    const unverified = refreshCandidateRichProfileWithEffectiveTruth(baseProfile(), {
      linkedin: { url: LINKEDIN_URL, state: 'available_unverified' },
    });
    const verified = refreshCandidateRichProfileWithEffectiveTruth(baseProfile(), {
      linkedin: { url: LINKEDIN_URL, state: 'verified' },
    });

    // Ninguno declara ausencia…
    assert.equal((unverified.notes.missing_fields ?? []).includes('linkedin_url'), false);
    assert.equal((verified.notes.missing_fields ?? []).includes('linkedin_url'), false);
    // …y sus notas NO son la misma frase: la verificación se distingue.
    assert.notEqual(unverified.notes.executive_note, verified.notes.executive_note);
    assert.match(String(verified.notes.executive_note), /LinkedIn verificado/);
  });

  it('el refresco sólo AÑADE: nunca borra un dato que el perfil ya tenía', () => {
    const enriched = refreshCandidateRichProfileWithEffectiveTruth(baseProfile(), {
      linkedin: { url: LINKEDIN_URL, state: 'verified' },
      city: 'Cali',
      subindustry: MAPPED_SUBINDUSTRY,
      employeeCount: 2000,
    });

    // Segunda pasada sin nada nuevo: todo se conserva.
    const again = refreshCandidateRichProfileWithEffectiveTruth(enriched, {});
    assert.equal(again.company.linkedin_url, LINKEDIN_URL);
    assert.equal(again.location.city, 'Cali');
    assert.equal(again.classification.subindustry, MAPPED_SUBINDUSTRY);
    assert.equal(again.size.estimated_range, '2000');
    assert.deepEqual(again.notes.missing_fields, []);
  });

  it('lo que de verdad falta SIGUE figurando como ausente', () => {
    const refreshed = refreshCandidateRichProfileWithEffectiveTruth(baseProfile(), {
      linkedin: { url: LINKEDIN_URL, state: 'verified' },
      // sin ciudad, sin subindustria y sin tamaño
    });

    const missing = refreshed.notes.missing_fields ?? [];
    assert.equal(missing.includes('linkedin_url'), false);
    assert.ok(missing.includes('city'));
    assert.ok(missing.includes('subindustry'));
    assert.ok(missing.includes('size'));
  });

  it('`city` ya no se declara ausente sin condición', () => {
    // La línea original era `missingFields.push('city')` sin ningún `if`: la
    // ciudad figuraba ausente incluso teniéndola.
    const withCity = computeRichProfileMissingFields({
      company: { name: 'X', website: 'https://x.test', domain: 'x.test', linkedin_url: LINKEDIN_URL },
      classification: { subindustry: MAPPED_SUBINDUSTRY },
      location: { city: 'Cali' },
      size: { estimated_range: '2000', status: 'confirmed' },
      description: { short: 'descripcion' },
    });
    assert.deepEqual(withCity, []);

    const withoutCity = computeRichProfileMissingFields({
      company: { name: 'X', website: 'https://x.test', domain: 'x.test', linkedin_url: LINKEDIN_URL },
      classification: { subindustry: MAPPED_SUBINDUSTRY },
      location: { city: null },
      size: { estimated_range: '2000', status: 'confirmed' },
      description: { short: 'descripcion' },
    });
    assert.deepEqual(withoutCity, ['city']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § H · pre_writer vs final_state_consistency
// ─────────────────────────────────────────────────────────────────────────────

describe('§ H · consistencia final = post-writer, y sólo post-writer', () => {
  function truth(overrides: Record<string, unknown> = {}) {
    return {
      persistedCandidates: 1,
      eligibleBeforePersistence: 1,
      completeValidCandidates: 1,
      targetEligibleCompanies: 5,
      gapCauses: {},
      ...overrides,
    } as Parameters<typeof buildApolloPersistenceReconciliation>[0];
  }

  it('una corrida sana cierra ok=true con computed_at=post_writer', () => {
    const consistency = buildPostWriterStateConsistency(
      buildApolloPersistenceReconciliation(truth({ targetEligibleCompanies: 1 }), 25),
    );

    assert.equal(consistency.ok, true);
    assert.equal(consistency.computed_at, 'post_writer');
    assert.deepEqual(consistency.conflicts, []);
  });

  it('un hueco que ninguna causa explica se NOMBRA', () => {
    const consistency = buildPostWriterStateConsistency(
      buildApolloPersistenceReconciliation(
        truth({ persistedCandidates: 1, eligibleBeforePersistence: 3, completeValidCandidates: 1 }),
        25,
      ),
    );

    assert.equal(consistency.ok, false);
    assert.equal(consistency.unexplained_gap, 2);
    assert.ok(consistency.conflicts.some((c) => c.code === 'persistence_gap_unexplained'));
  });

  it('sin medición de completitud es fail-closed: conflicto, no «todo bien»', () => {
    const consistency = buildPostWriterStateConsistency(
      buildApolloPersistenceReconciliation(truth({ completeValidCandidates: null }), 25),
    );

    assert.equal(consistency.ok, false);
    assert.equal(consistency.complete_valid_candidates, null);
    assert.ok(consistency.conflicts.some((c) => c.code === 'completeness_not_measured'));
  });

  it('el bloque post-writer NO hereda el veredicto pre-writer de la corrida b3afe066', () => {
    // La corrida real: `unclassified = 1` y `ok = false` en el bloque pre-writer,
    // mientras las disposiciones cerraban 17/17 y `unexplained_gap` era 0. El
    // bloque post-writer se calcula de las cifras autoritativas, así que aquí
    // cierra en verde sin que nadie corrija el diagnóstico intermedio.
    const reconciliation = buildApolloPersistenceReconciliation(
      truth({ persistedCandidates: 1, eligibleBeforePersistence: 1, completeValidCandidates: 1, targetEligibleCompanies: 1 }),
      25,
    );
    assert.equal(reconciliation.unexplained_gap, 0);

    const consistency = buildPostWriterStateConsistency(reconciliation);
    assert.equal(consistency.ok, true);
  });

  it('el metadata publica `final_state_consistency` post-writer y conserva el pre-writer aparte', () => {
    const result = reconcileApolloTwoRoundPersistedTruth(
      {
        run_metrics: { total_search_credits: 20, total_enrichment_credits: 5, persisted_candidates: 3 },
        target_reached: true,
        // El diagnóstico intermedio, con su nombre propio.
        pre_writer_state_consistency: { ok: false, computed_at: 'pre_writer', unclassified_unique_results: 1 },
      },
      truth({ targetEligibleCompanies: 1 }),
    );

    assert.ok(result !== null);
    const observability = result!.observability;

    const final = observability.final_state_consistency as Record<string, unknown>;
    assert.equal(final.computed_at, 'post_writer');
    assert.equal(final.ok, true);

    // Y el pre-writer sobrevive byte a byte, con su propio nombre: sigue siendo
    // un diagnóstico útil, sólo que ya no se llama «final».
    const preWriter = observability.pre_writer_state_consistency as Record<string, unknown>;
    assert.equal(preWriter.computed_at, 'pre_writer');
    assert.equal(preWriter.ok, false);
    assert.equal(preWriter.unclassified_unique_results, 1);
  });

  it('el runner ya no publica `final_state_consistency` desde la pasada PRE-writer', () => {
    const runnerSource = readFileSync(
      path.join(import.meta.dirname, '..', 'apollo-two-round', 'production-runner.server.ts'),
      'utf8',
    );

    // Dos fuentes con el mismo nombre semántico fue el defecto. El runner
    // (pre-writer) debe publicar sólo la clave marcada como pre-writer.
    assert.ok(runnerSource.includes('pre_writer_state_consistency:'));
    assert.equal(runnerSource.includes('final_state_consistency:'), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integración real del writer
// ─────────────────────────────────────────────────────────────────────────────

type FakeAdminStats = { candidateInsertCalls: Record<string, unknown>[] };

class ChainResult {
  constructor(private readonly payload: unknown) {}
  eq(): ChainResult { return this; }
  neq(): ChainResult { return this; }
  in(): ChainResult { return this; }
  not(): ChainResult { return this; }
  gte(): ChainResult { return this; }
  order(): ChainResult { return this; }
  limit(): ChainResult { return this; }
  select(): ChainResult { return this; }
  then<T>(
    onFulfilled: (v: unknown) => T | PromiseLike<T>,
    onRejected?: (r: unknown) => T | PromiseLike<T>,
  ): Promise<T> {
    return Promise.resolve(this.payload).then(onFulfilled, onRejected);
  }
}

function makeFakeAdmin(stats: FakeAdminStats): SupabaseClient {
  let candidateSeq = 0;
  return {
    // CUT-3B4-CORRECCIÓN — la 126 SIN aplicar se declara como lo hace la BASE.
    // Omitir `rpc` modelaría un cliente no soportado, y eso degrada CERRADO.
    rpc: preM126Rpc,
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select() {
            return {
              eq(col: string) {
                if (col === 'source') return new ChainResult({ data: [], error: null });
                return { single: () => Promise.resolve({ data: null, error: { message: 'Not found' } }) };
              },
            };
          },
          update() { return new ChainResult({ error: null }); },
          insert() {
            return {
              select() {
                return { single: () => Promise.resolve({ data: { id: 'batch-operability-1' }, error: null }) };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidates') {
        return {
          select() { return new ChainResult({ data: [], error: null }); },
          insert(data: Record<string, unknown>) {
            stats.candidateInsertCalls.push({ ...data });
            const id = `cand-operability-${++candidateSeq}`;
            return { select() { return { single: () => Promise.resolve({ data: { id }, error: null }) }; } };
          },
        };
      }
      if (table === 'prospect_candidate_audit') {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === 'provider_usage_logs') {
        return { select: () => new ChainResult({ data: [], error: null }) };
      }
      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

const FAKE_CATALOG_CONTEXT = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail y Consumo',
  recommendedSources: [],
  warnings: [],
  catalogVersion: null,
} as unknown as Parameters<typeof writeProspectingCandidates>[0]['pipelineOutput']['catalogContext'];

/**
 * Candidato con el patrón EXACTO de la corrida `b3afe066`: LinkedIn confirmado
 * por el proveedor, empleados confirmados, subindustria mapeada… y un scoring que
 * llega del pipeline con la advertencia de ausencia puesta, que es lo que este
 * hito tiene que reconciliar.
 */
function makeOperabilityCandidate(options: { withAbsentWarning: boolean }) {
  const name = 'Cadena Sintetica de Mercados';
  const domain = 'cadenasinteticademercados.com.co';
  const result = {
    title: name,
    url: `https://www.${domain}`,
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata: { industry: MAPPED_SUBINDUSTRY, city: 'Cali' },
  } as unknown as WebSearchResult;

  const precision = assessApolloSubindustryPrecisionForRequest(result, [MAPPED_SUBINDUSTRY]);
  const capture = captureApolloEnrichmentForPersistence({
    result,
    precision,
    provenance: {
      sourceProvider: 'apollo',
      sourceOperation: 'organization_enrichment',
      sourceRequestId: 'organization_enrichment:test-batch:test-request',
      observedAt: '2026-08-11T14:06:49.298Z',
    },
  });

  return {
    name,
    website: `https://www.${domain}`,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail y Consumo',
    sourceUrl: `https://www.${domain}`,
    sourceTitle: name,
    sourceSnippet: `Empresa: ${name} | Pais: Colombia`,
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: {
      domain,
      status: 'verified' as const,
      skipped: false,
      confidence: 88,
      redirected: false,
      httpStatus: 200,
      skipReason: null,
    },
    sectorEvidenceState: 'sector_evidence_confirmed',
    providerEnrichmentCapture: capture,
    companyLinkedInUrl: LINKEDIN_URL,
    employeeCount: 2000,
    providerCompanyFields: {
      linkedin: confirmedCapture(),
      employeeCount: {
        employeeCount: 2000,
        status: 'confirmed' as const,
        sourceProvider: 'apollo' as const,
        sourceOperation: 'organization_enrichment' as const,
        observedAt: '2026-08-11T14:06:49.298Z',
        rawValue: 2000,
        reason: null,
      },
    },
    duplicateCheck: {
      status: 'new_candidate' as const,
      confidence: 1,
      input: { name, website: null, domain: null },
      checkedSources: ['sellup' as const],
      summary: 'No match',
      matches: [],
    },
    scoring: {
      ...scoringWithAbsentWarning(),
      warnings: options.withAbsentWarning ? [LINKEDIN_ABSENT_WARNING] : [],
    },
  };
}

async function runWriter(
  candidates: ReturnType<typeof makeOperabilityCandidate>[],
  options: { dryRun?: boolean; batchName?: string } = {},
): Promise<Record<string, unknown>[]> {
  const stats: FakeAdminStats = { candidateInsertCalls: [] };
  const pipelineOutput = {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Retail y Consumo',
      webSearchProvider: 'apollo_organizations',
      mode: 'multi_query' as const,
      subindustries: [MAPPED_SUBINDUSTRY],
    },
    catalogContext: FAKE_CATALOG_CONTEXT,
    searchQuery: MAPPED_SUBINDUSTRY,
    webSearch: {
      provider: 'apollo_organizations',
      query: 'test',
      results: [],
      resultsCount: candidates.length,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates,
    summary: {
      requested: candidates.length,
      searched: candidates.length,
      returned: candidates.length,
      highQualityNew: 0,
      needsReview: candidates.length,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: {
      provider: 'apollo_organizations',
      pipelineVersion: 'apollo-two-round-1',
      executedAt: '2026-08-11T14:06:51.000Z',
      total_raw_evaluated: candidates.length,
      subindustries: [MAPPED_SUBINDUSTRY],
    },
  };

  const input = {
    pipelineOutput: pipelineOutput as unknown as CandidateWriterInput['pipelineOutput'],
    triggeredByUserId: 'aaaaaaaa-0000-0000-0000-000000000001',
    ownerId: 'aaaaaaaa-0000-0000-0000-000000000001',
    source: 'agent_1' as const,
    dryRun: options.dryRun ?? false,
    batchName: options.batchName,
    extraBatchMetadata: { subindustries: [MAPPED_SUBINDUSTRY] },
  } as unknown as CandidateWriterInput;

  await writeProspectingCandidates(input, makeFakeAdmin(stats));
  return stats.candidateInsertCalls;
}

describe('Integración real del writer — la fila que la corrida b3afe066 debería haber escrito', () => {
  it('§ A — el writer de producción escribe record_origin=production', async () => {
    const rows = await runWriter([makeOperabilityCandidate({ withAbsentWarning: true })]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].record_origin, 'production');
    // Y la fila así escrita PASA el gate de la cola limpia, que es el punto entero.
    const decision = evaluateApproveEligibility({
      status: rows[0].status as string,
      recordOrigin: rows[0].record_origin as string,
      duplicateStatus: rows[0].duplicate_status as string,
    });
    assert.equal(decision.decision, 'approve');
  });

  it('§ A — una corrida en seco no escribe ninguna fila (y por tanto no etiqueta nada)', async () => {
    const rows = await runWriter([makeOperabilityCandidate({ withAbsentWarning: true })], {
      dryRun: true,
    });
    assert.deepEqual(rows, []);
  });

  it('§ A — un lote con marcador de smoke NO produce filas operables', async () => {
    const rows = await runWriter([makeOperabilityCandidate({ withAbsentWarning: true })], {
      batchName: 'Agente 1 · SMOKE · Colombia',
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].record_origin, 'smoke_test');
    const decision = evaluateApproveEligibility({
      status: rows[0].status as string,
      recordOrigin: rows[0].record_origin as string,
      duplicateStatus: rows[0].duplicate_status as string,
    });
    assert.equal(decision.decision, 'reject');
    assert.equal((decision as { reason: string }).reason, 'not_clean_production');
  });

  it('§ F — la fila persistida NO contiene la advertencia «LinkedIn no disponible»', async () => {
    const rows = await runWriter([makeOperabilityCandidate({ withAbsentWarning: true })]);
    const metadata = rows[0].metadata as Record<string, unknown>;
    const scoring = metadata.scoring as Record<string, unknown>;

    assert.equal((scoring.warnings as string[]).includes(LINKEDIN_ABSENT_WARNING), false);
    // El componente canónico aplicado exactamente una vez: 75 → 80, 65 → 70.
    assert.equal(rows[0].confidence_score, 80);
    assert.equal(rows[0].data_completeness_score, 70);
  });

  it('§ E — la fila declara disponibilidad y verificación por separado', async () => {
    const rows = await runWriter([makeOperabilityCandidate({ withAbsentWarning: true })]);
    const metadata = rows[0].metadata as Record<string, unknown>;
    const availability = metadata.linkedin_availability as Record<string, unknown>;

    assert.equal(availability.is_available, true);
    assert.equal(availability.is_verified, false);
    assert.equal(availability.state, 'available_verification_pending');
    assert.equal(availability.absent_warning_removed, true);
  });

  it('§ G — missing_fields de la fila persistida no declara ninguna ausencia falsa', async () => {
    const rows = await runWriter([makeOperabilityCandidate({ withAbsentWarning: true })]);
    const metadata = rows[0].metadata as Record<string, unknown>;
    const richProfile = metadata.rich_profile as Record<string, unknown>;
    const notes = richProfile.notes as Record<string, unknown>;
    const missing = notes.missing_fields as string[];

    // La corrida real declaraba estos cuatro teniendo los cuatro.
    for (const field of ['linkedin_url', 'subindustry', 'city', 'size']) {
      assert.equal(missing.includes(field), false, `${field} no puede figurar ausente`);
    }

    // Y los cuatro están, de verdad, en el perfil.
    const company = richProfile.company as Record<string, unknown>;
    const classification = richProfile.classification as Record<string, unknown>;
    const location = richProfile.location as Record<string, unknown>;
    assert.equal(company.linkedin_url, LINKEDIN_URL);
    assert.equal(classification.subindustry, MAPPED_SUBINDUSTRY);
    assert.equal(location.city, 'Cali');

    // …y la nota ejecutiva no afirma lo contrario.
    assert.doesNotMatch(String(notes.executive_note), /sin perfil de LinkedIn/);
  });

  it('las columnas que #234 gobierna siguen escribiéndose igual', async () => {
    const rows = await runWriter([makeOperabilityCandidate({ withAbsentWarning: true })]);

    assert.equal(rows[0].employee_count, 2000);
    assert.equal(rows[0].employee_count_source, 'apollo');
    assert.equal(rows[0].linkedin_url, LINKEDIN_URL);
    assert.equal(rows[0].city, 'Cali');
    assert.equal(rows[0].subindustry, MAPPED_SUBINDUSTRY);
  });

  it('§ I — employee_count_status NO se escribe: su CHECK es de otra semántica', async () => {
    // Migración 108 lo declara explícitamente: la CHECK de `employee_count_status`
    // (045) sólo admite las clases de tamaño de fuentes estructuradas
    // (`confirmed_100_plus`, …), no el vocabulario confirmed/not_returned/invalid/
    // mapping_failed de esta captura. Ese estado vive en
    // `metadata.company_employee_count`, y ahí sigue.
    const rows = await runWriter([makeOperabilityCandidate({ withAbsentWarning: true })]);
    assert.equal('employee_count_status' in rows[0], false);

    const metadata = rows[0].metadata as Record<string, unknown>;
    const block = metadata.company_employee_count as Record<string, unknown>;
    assert.equal(block.employee_count_status, 'confirmed');
  });
});
