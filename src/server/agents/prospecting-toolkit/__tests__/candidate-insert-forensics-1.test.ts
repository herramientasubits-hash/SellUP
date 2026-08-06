/**
 * AGENT1-APOLLO-CANDIDATE-INSERT-FORENSICS-1
 *
 * Corrida `9a9acf99-79e4-406f-a7cb-5784c88ac965` (2026-08-06T00:49:53Z, runtime
 * `68fe54ce`): 4 intentos de INSERT, 3 filas escritas, 1 perdida.
 *
 * La perdida era «Almacenes La 14» (`la14.com`) — el ÚNICO candidato de la
 * corrida con subindustria confirmada, es decir el único que contaba hacia el
 * objetivo. Postgres la rechazó a las 00:50:16.172Z con
 *
 *   ERROR: new row for relation "prospect_candidates" violates check constraint
 *          "prospect_candidates_classification_source_check"
 *
 * Causa: el proyector de § 4 escribía en la columna `classification_source` el
 * vocabulario de EVIDENCIA (`provider_industry`, `website_profile`, …), mientras
 * la CHECK de la migración 093 sólo admite el vocabulario de QUIÉN clasificó
 * (`writer`, `derived_*`, `manual`, `unknown`). Los dos conjuntos no comparten
 * ni un valor, así que TODO candidato con subindustria confirmada fallaba —
 * exactamente los que importan. Los tres ambiguos se salvaron porque en ellos el
 * proyector omite la clave.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  PROSPECT_CANDIDATE_CLASSIFICATION_SOURCES,
  captureApolloEnrichmentForPersistence,
  toApolloEnrichmentCandidateColumns,
  toApolloEnrichmentPersistenceMetadata,
} from '../apollo-enrichment-persistence-capture';
import type { ApolloSubindustryPrecisionAssessment } from '../apollo-subindustry-precision';
import {
  CANDIDATE_PERSISTENCE_FAILED_AUDIT_ACTION,
  classifyCandidateInsertFailureKind,
  extractDatabaseErrorDiagnostics,
  isRetryableInsertFailure,
  toCandidatePersistenceFailureAuditDetails,
} from '../candidate-persistence-failure-audit';
import { buildApolloPersistenceReconciliation } from '../apollo-persisted-candidate-truth';
import {
  resolvePersistenceStatus,
  toCandidatePersistenceOutcomeMetadata,
} from '../prospect-candidate-persistence-readiness';
import type { WebSearchResult } from '../types';

// ─── Fixture: la candidata que se perdió ──────────────────────────────────────

/** Veredicto de precisión de `la14.com`: ancla limpia en la industria declarada. */
const LA_14_PRECISION: ApolloSubindustryPrecisionAssessment = {
  requestedSubindustry: 'Supermercados e Hipermercados',
  subindustryMapped: true,
  // `confirmed` es el veredicto de industria declarada del vocabulario real
  // (`IndustryMatchVerdict`): la industria de Apollo trae el ancla `supermarkets`.
  industryMatch: 'confirmed',
  subindustryMatch: 'confirmed',
  subindustryConfidence: 90,
  subindustryEvidence: [
    { term: 'supermercado', field: 'apollo_profile.industry', source: 'provider_industry' },
  ],
  classificationSource: 'provider_industry',
  disqualifyingSignals: [],
  verdictReason: 'anchor_evidence_confirmed',
};

const LA_14_RESULT = {
  title: 'Almacenes La 14',
  url: 'http://www.la14.com',
  snippet: 'Cadena de supermercados e hipermercados en Colombia.',
  metadata: {
    city: 'Cali',
    industry: 'Retail y Consumo',
    apollo_profile: {
      city: 'Cali',
      industry: 'supermarkets',
      linkedin_url: 'https://www.linkedin.com/company/almacenes-la-14',
      estimated_num_employees: 4000,
    },
  },
} as unknown as WebSearchResult;

function captureLa14() {
  return captureApolloEnrichmentForPersistence({
    result: LA_14_RESULT,
    precision: LA_14_PRECISION,
    provenance: {
      sourceProvider: 'apollo',
      sourceOperation: 'organization_enrichment',
      sourceRequestId: 'apollo_org:5d9b5c4bc5502300d5aff63e',
      observedAt: '2026-08-06T00:50:14.000Z',
    },
  });
}

/** El mismo candidato pero ambiguo — la cohorte que SÍ se persistió. */
function captureAmbiguous() {
  return captureApolloEnrichmentForPersistence({
    result: LA_14_RESULT,
    precision: {
      ...LA_14_PRECISION,
      subindustryMatch: 'ambiguous',
      subindustryConfidence: 55,
      classificationSource: 'provider_description',
      verdictReason: 'broad_industry_only',
    },
    provenance: {
      sourceProvider: 'apollo',
      sourceOperation: 'organization_enrichment',
      sourceRequestId: 'apollo_org:55696af97369642525da2300',
      observedAt: '2026-08-06T00:50:14.000Z',
    },
  });
}

// ─── § 3 — dominio real de la columna ─────────────────────────────────────────

/** Valores que la CHECK admite, leídos de la migración y no de la memoria. */
function allowedSourcesFromMigration(): string[] {
  const sql = readFileSync(
    path.join(
      process.cwd(),
      'supabase/migrations/093_add_record_origin_classification_to_prospect_candidates.sql',
    ),
    'utf8',
  );
  const block =
    /ADD CONSTRAINT prospect_candidates_classification_source_check[\s\S]*?\)\s*NOT VALID;/.exec(
      sql,
    );
  assert.ok(block, 'la migración 093 debe declarar la CHECK de classification_source');
  return [...block[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('FORENSICS-1 § 3 — el proyector respeta el dominio de la columna', () => {
  it('la lista del código es EXACTAMENTE la de la migración 093', () => {
    assert.deepEqual(
      [...PROSPECT_CANDIDATE_CLASSIFICATION_SOURCES].sort(),
      allowedSourcesFromMigration().sort(),
    );
  });

  it('el payload de la candidata perdida ya no viola la CHECK', () => {
    const columns = toApolloEnrichmentCandidateColumns(captureLa14());
    assert.ok(
      columns.classification_source !== undefined,
      'una subindustria confirmada debe seguir escribiendo la columna',
    );
    assert.ok(
      allowedSourcesFromMigration().includes(columns.classification_source as string),
      `"${columns.classification_source}" no existe en el dominio de la CHECK`,
    );
  });

  it('NINGUNA fuente de evidencia se cuela en la columna', () => {
    const allowed = new Set(allowedSourcesFromMigration());
    for (const source of [
      'provider_industry',
      'provider_keywords',
      'provider_description',
      'commercial_name',
      'website_profile',
      'catalog_classification',
    ] as const) {
      const columns = toApolloEnrichmentCandidateColumns({
        ...captureLa14(),
        classificationSource: source,
      });
      assert.ok(
        allowed.has(columns.classification_source as string),
        `la evidencia ${source} llegó cruda a la columna`,
      );
    }
  });

  it('la evidencia exacta NO se pierde: sigue entera en la metadata', () => {
    const metadata = toApolloEnrichmentPersistenceMetadata(captureLa14());
    assert.equal(metadata.classification_source, 'provider_industry');
    assert.equal(metadata.subindustry, 'Supermercados e Hipermercados');
  });

  it('la confianza persistida cabe en el rango 0–100 de su propia CHECK', () => {
    const { classification_confidence: confidence } = toApolloEnrichmentCandidateColumns(
      captureLa14(),
    );
    assert.ok(typeof confidence === 'number' && confidence >= 0 && confidence <= 100);
  });

  it('una subindustria ambigua no escribe subindustria ni clasificación', () => {
    const columns = toApolloEnrichmentCandidateColumns(captureAmbiguous());
    assert.equal(columns.subindustry, undefined);
    assert.equal(columns.classification_source, undefined);
    assert.equal(columns.classification_confidence, undefined);
  });
});

// ─── § 2 — el diagnóstico del motor se conserva ───────────────────────────────

/** El error tal y como PostgREST lo devolvió aquella noche. */
const REAL_CHECK_VIOLATION = {
  code: '23514',
  message:
    'new row for relation "prospect_candidates" violates check constraint "prospect_candidates_classification_source_check"',
  details: null,
  hint: null,
};

describe('FORENSICS-1 § 2 — código y constraint sobreviven al fallo', () => {
  it('extrae código, mensaje y constraint del error real', () => {
    const diagnostics = extractDatabaseErrorDiagnostics(REAL_CHECK_VIOLATION);
    assert.equal(diagnostics.code, '23514');
    assert.equal(diagnostics.constraint, 'prospect_candidates_classification_source_check');
    assert.match(diagnostics.message ?? '', /violates check constraint/);
  });

  it('un error sin forma reconocible no inventa diagnóstico', () => {
    const diagnostics = extractDatabaseErrorDiagnostics('boom');
    assert.deepEqual(diagnostics, {
      code: null,
      message: null,
      details: null,
      hint: null,
      constraint: null,
    });
  });

  it('una violación de CHECK NO es reintentable con el mismo payload', () => {
    assert.equal(isRetryableInsertFailure(extractDatabaseErrorDiagnostics(REAL_CHECK_VIOLATION)), false);
  });

  it('una columna que aún no existe SÍ es reintentable tras desplegar', () => {
    for (const code of ['42703', 'PGRST204']) {
      assert.equal(
        isRetryableInsertFailure(extractDatabaseErrorDiagnostics({ code, message: 'x' })),
        true,
        `${code} debería ser reintentable`,
      );
    }
  });
});

// ─── § 4 — duplicidad tardía ≠ avería técnica ─────────────────────────────────

describe('FORENSICS-1 § 4 — el duplicado tardío se clasifica como duplicado', () => {
  it('un choque contra índice único es duplicate, no persistence_failure', () => {
    const diagnostics = extractDatabaseErrorDiagnostics({
      code: '23505',
      message: 'duplicate key value violates unique constraint "prospect_candidates_domain_key"',
    });
    assert.equal(classifyCandidateInsertFailureKind(diagnostics), 'duplicate');
    assert.equal(diagnostics.constraint, 'prospect_candidates_domain_key');
  });

  it('la violación real de la corrida SÍ es un fallo técnico', () => {
    assert.equal(
      classifyCandidateInsertFailureKind(extractDatabaseErrorDiagnostics(REAL_CHECK_VIOLATION)),
      'persistence_failure',
    );
  });
});

// ─── § 8 — auditoría sin candidate_id ─────────────────────────────────────────

describe('FORENSICS-1 § 8 — el fallo queda auditado aunque no exista la fila', () => {
  const details = toCandidatePersistenceFailureAuditDetails({
    stage: 'candidate_insert',
    errorCode: 'prospect_candidate_write_failed',
    diagnostics: extractDatabaseErrorDiagnostics(REAL_CHECK_VIOLATION),
    companyName: 'Almacenes La 14',
    normalizedDomain: 'la14.com',
    identityKey: 'domain:la14.com',
    countryCode: 'CO',
    occurredAt: '2026-08-06T00:50:16.172Z',
  });

  it('nombra a la empresa perdida y la constraint que la tumbó', () => {
    assert.equal(details.company_name, 'Almacenes La 14');
    assert.equal(details.normalized_domain, 'la14.com');
    assert.equal(details.identity_key, 'domain:la14.com');
    assert.equal(details.failed_constraint, 'prospect_candidates_classification_source_check');
    assert.equal(details.database_error_code, '23514');
    assert.equal(details.stage, 'candidate_insert');
    assert.equal(details.retryable, false);
    assert.equal(details.occurred_at, '2026-08-06T00:50:16.172Z');
  });

  it('la huella no depende de identity_key, que puede ser null', () => {
    const withoutIdentity = toCandidatePersistenceFailureAuditDetails({
      stage: 'candidate_insert',
      errorCode: 'prospect_candidate_write_failed',
      diagnostics: extractDatabaseErrorDiagnostics(REAL_CHECK_VIOLATION),
      companyName: 'Almacenes La 14',
      normalizedDomain: 'la14.com',
      identityKey: null,
      countryCode: 'CO',
      occurredAt: '2026-08-06T00:50:16.172Z',
    });
    assert.equal(withoutIdentity.candidate_fingerprint, details.candidate_fingerprint);
    assert.ok(withoutIdentity.candidate_fingerprint.length > 0);
  });

  it('no filtra secretos', () => {
    const serialized = JSON.stringify(details);
    assert.doesNotMatch(serialized, /api[_-]?key/i);
    assert.doesNotMatch(serialized, /authorization/i);
    assert.doesNotMatch(serialized, /bearer/i);
  });

  it('la acción de auditoría tiene nombre propio', () => {
    assert.equal(CANDIDATE_PERSISTENCE_FAILED_AUDIT_ACTION, 'candidate_persistence_failed');
  });
});

// ─── § 7 — éxito parcial con nombre propio ────────────────────────────────────

describe('FORENSICS-1 § 7 — persistencia parcial es un estado, no un booleano', () => {
  it('la corrida 9a9acf99 es partial_failure, no success ni failed', () => {
    assert.equal(resolvePersistenceStatus({ succeededCount: 3, failedCount: 1 }), 'partial_failure');
  });

  it('cero guardados con fallos es failed', () => {
    assert.equal(resolvePersistenceStatus({ succeededCount: 0, failedCount: 1 }), 'failed');
  });

  it('cero fallos es success aunque no se guardara nada', () => {
    assert.equal(resolvePersistenceStatus({ succeededCount: 0, failedCount: 0 }), 'success');
  });

  it('la metadata publica intentados, guardados, fallidos y hueco', () => {
    const metadata = toCandidatePersistenceOutcomeMetadata({
      eligibleBeforePersistence: 4,
      persistedCandidates: 3,
      persistenceFailureCount: 1,
      persistenceFailed: true,
      persistenceErrorCode: 'prospect_candidate_write_failed',
      persistenceErrorStage: 'candidate_insert',
      persistenceStatus: 'partial_failure',
      persistenceAttemptedCount: 4,
      persistenceSucceededCount: 3,
      persistenceFailedCount: 1,
      persistenceGap: 1,
    });
    assert.equal(metadata.persistence_status, 'partial_failure');
    assert.equal(metadata.persistence_attempted_count, 4);
    assert.equal(metadata.persistence_succeeded_count, 3);
    assert.equal(metadata.persistence_failed_count, 1);
    assert.equal(metadata.persistence_gap, 1);
  });

  it('la candidata COMPLETA que no se guardó no cuenta hacia el objetivo', () => {
    // Cifras exactas de la corrida: 4 elegibles, 3 filas, y la única completa
    // perdida en el INSERT. Contarla habría anunciado un objetivo inexistente.
    const reconciliation = buildApolloPersistenceReconciliation(
      {
        eligibleBeforePersistence: 4,
        persistedCandidates: 3,
        completeValidCandidates: 0,
        targetEligibleCompanies: 5,
        gapCauses: { persistence_failed: 1 },
      },
      25,
    );
    assert.equal(reconciliation.persisted_candidates, 3);
    assert.equal(reconciliation.complete_valid_candidates, 0);
    assert.equal(reconciliation.review_only_candidates, 3);
    assert.equal(reconciliation.target_count, 0);
    assert.equal(reconciliation.target_reached, false);
    assert.equal(reconciliation.persistence_gap, 1);
    assert.equal(reconciliation.unexplained_gap, 0);
  });
});
