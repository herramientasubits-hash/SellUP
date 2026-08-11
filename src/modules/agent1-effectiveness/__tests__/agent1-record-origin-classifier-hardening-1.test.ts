/**
 * AGENT1-RECORD-ORIGIN-CLASSIFIER-HARDENING-1 — el clasificador canónico de
 * `record_origin` ya no puede afirmar `production` sobre evidencia que dice lo
 * contrario.
 *
 * QUÉ DEFECTO CIERRA. El backfill histórico de Agent 1 (14 filas remediadas, 30
 * que quedaron deliberadamente en NULL) demostró que
 * `deriveRecordOriginClassification`, aplicado a ciegas, produce falsos
 * `production`. Tres causas, medidas sobre datos reales:
 *
 *   A. EC-SCVS NO EJECUTADO. Un registro que declara
 *      `provider_calls_allowed=false`, `live_pilot_not_executed=true` y
 *      `execution_authorized=false` aterrizaba en R7 `production_status` con
 *      confianza 80, porque su `status='needs_review'` es legítimo y NINGUNA
 *      regla miraba esos tres campos. El status ganaba a la evidencia.
 *
 *   B. QA CLEANUP NO RECONOCIDO. `metadata.qa_cleanup` («Descartado por limpieza
 *      de QA visual: batch de prueba previo a v1.8.1») no era ningún marcador: la
 *      familia QA sólo leía `qa_only` / `do_not_use_for_sales` / `do_not_convert`
 *      y la de limpieza sólo la frase «limpieza histórica». Las 15 filas caían en
 *      R8 `discarded_unknown` ⇒ `unknown`.
 *
 *   C. NOTA COMERCIAL COMO PRUEBA DE PRODUCCIÓN. R6 `outside_icp` devolvía
 *      `production` por el SOLO hecho de que `review_notes` dijera «fuera del
 *      segmento». Una frase comercial legítima con basura de QA pegada
 *      («Fuera del segmento objetivo: axZXzxxZ») bastaba para afirmar procedencia
 *      de producción sobre una fila que no tenía ninguna.
 *
 * EL PRINCIPIO QUE SE FIJA:
 *
 *   evidencia explícita de NO-producción  >  inferencia QA/smoke/import/cleanup
 *     >  inferencia de producción por status  >  unknown
 *
 * LO QUE ESTE BLOQUE NO HACE: no remedia ninguna fila, no ejecuta ningún
 * backfill, no añade migraciones y no toca `classification_source` ni
 * `classification_confidence` persistidas (PR #238 / #241 § 7).
 *
 * Determinista y offline: sin Apollo, sin Tavily, sin Lusha, sin HubSpot, sin
 * Supabase, sin flags, sin créditos y sin escrituras en Producción. Los patrones
 * son sintéticos; ninguna empresa real está codificada.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveRecordOriginClassification,
  detectExplicitNonProductionExecution,
  hasPositiveProductionProvenance,
  type ClassifiableBatch,
  type ClassifiableCandidate,
} from '../classification';
import {
  CANONICAL_PRODUCTION_RECORD_ORIGIN,
  resolveCandidateRecordOriginForWriter,
  toCandidateRecordOriginColumns,
} from '@/server/agents/prospecting-toolkit/candidate-record-origin';
import { evaluateApproveEligibility } from '@/modules/prospect-review/approve-eligibility';
import { evaluateConvertApproveEligibility } from '@/modules/prospect-review/approve-and-convert-eligibility';
import { evaluateDiscardEligibility } from '@/modules/prospect-review/discard-eligibility';
import { evaluateDuplicateEligibility } from '@/modules/prospect-review/duplicate-eligibility';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — estructurales y anonimizados. Reproducen la FORMA de los casos
// reales del backfill, nunca sus datos.
// ─────────────────────────────────────────────────────────────────────────────

/** CASE A — piloto EC-SCVS que nunca corrió. */
const EC_SCVS_UNEXECUTED: ClassifiableCandidate = {
  status: 'needs_review',
  duplicate_status: 'no_match',
  source_primary: 'manual',
  review_notes: null,
  metadata: {
    provider_calls_allowed: false,
    runner_required: true,
    live_pilot_not_executed: true,
    execution_authorized: false,
    do_not_sync_hubspot: true,
  },
};

/** CASE B — batch de QA visual descartado por limpieza. */
const QA_CLEANUP_CANDIDATE: ClassifiableCandidate = {
  status: 'discarded',
  source_primary: 'web_ai',
  metadata: {
    qa_cleanup: 'Descartado por limpieza de QA visual: batch de prueba previo a vX.Y.Z',
  },
};

/** CASE C — nota comercial ambigua SIN ninguna procedencia positiva. */
const AMBIGUOUS_COMMERCIAL_NOTE: ClassifiableCandidate = {
  status: 'discarded',
  source_primary: 'manual',
  review_notes: 'Fuera del segmento objetivo: aZxXzZxX',
};

/** CASE D — corrida Apollo real. */
const APOLLO_PRODUCTION: ClassifiableCandidate = {
  status: 'needs_review',
  duplicate_status: 'no_match',
  source_primary: 'apollo',
  review_notes: null,
  metadata: {},
};

/** CASE E — corrida web_ai / Tavily real. */
const WEB_AI_PRODUCTION: ClassifiableCandidate = {
  ...APOLLO_PRODUCTION,
  source_primary: 'web_ai',
};

const PRODUCTION_BATCH: ClassifiableBatch = {
  source: 'agent_1',
  name: 'Agente 1 · Pipeline · Colombia · Retail y Consumo',
  metadata: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// § 1 · CASE A — EC-SCVS no ejecutado
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 1 · CASE A — EC-SCVS no ejecutado NUNCA es production', () => {
  it('los tres marcadores juntos ⇒ NOT production, con la regla que lo explica', () => {
    const out = deriveRecordOriginClassification(EC_SCVS_UNEXECUTED);

    assert.notEqual(out.recordOrigin, 'production');
    assert.equal(out.recordOrigin, 'unknown');
    assert.equal(out.matchedRule, 'unexecuted_or_unauthorized');
    assert.ok(out.warnings.includes('explicit_nonproduction_marker'));
  });

  it('sigue sin ser production aunque el status y el duplicate_status sean legítimos', () => {
    // Es exactamente la combinación que antes devolvía production/80.
    for (const status of ['needs_review', 'approved', 'generated', 'normalized']) {
      const out = deriveRecordOriginClassification({ ...EC_SCVS_UNEXECUTED, status });
      assert.notEqual(out.recordOrigin, 'production', status);
      assert.equal(out.matchedRule, 'unexecuted_or_unauthorized', status);
    }
  });

  it('CASE H — execution_authorized=false SOLO ya basta', () => {
    const out = deriveRecordOriginClassification({
      status: 'needs_review',
      source_primary: 'manual',
      metadata: { execution_authorized: false },
    });
    assert.notEqual(out.recordOrigin, 'production');
    assert.equal(out.matchedRule, 'unexecuted_or_unauthorized');
  });

  it('CASE I — live_pilot_not_executed=true SOLO ya basta', () => {
    const out = deriveRecordOriginClassification({
      status: 'needs_review',
      source_primary: 'manual',
      metadata: { live_pilot_not_executed: true },
    });
    assert.notEqual(out.recordOrigin, 'production');
    assert.equal(out.matchedRule, 'unexecuted_or_unauthorized');
  });

  it('provider_calls_allowed=false SOLO ya basta', () => {
    const out = deriveRecordOriginClassification({
      status: 'needs_review',
      source_primary: 'manual',
      metadata: { provider_calls_allowed: false },
    });
    assert.notEqual(out.recordOrigin, 'production');
    assert.equal(out.matchedRule, 'unexecuted_or_unauthorized');
  });

  it('el marcador gana incluso con procedencia positiva de proveedor', () => {
    // Que el proveedor exista no prueba que la corrida ocurriera.
    const out = deriveRecordOriginClassification(
      { ...EC_SCVS_UNEXECUTED, source_primary: 'apollo' },
      PRODUCTION_BATCH,
    );
    assert.notEqual(out.recordOrigin, 'production');
  });

  it('el marcador se detecta anidado un nivel (contenedor tipo `context`)', () => {
    const out = deriveRecordOriginClassification({
      status: 'needs_review',
      source_primary: 'apollo',
      metadata: { context: { execution_authorized: false } },
    });
    assert.notEqual(out.recordOrigin, 'production');
    assert.equal(out.matchedRule, 'unexecuted_or_unauthorized');
  });

  it('el marcador también se detecta en el LOTE, y lo declara', () => {
    const out = deriveRecordOriginClassification(APOLLO_PRODUCTION, {
      ...PRODUCTION_BATCH,
      metadata: { live_pilot_not_executed: true },
    });
    assert.notEqual(out.recordOrigin, 'production');
    assert.ok(out.warnings.includes('batch_origin_used'));
  });

  it('el detector compartido es puro y no muta sus entradas', () => {
    const candidate = { ...EC_SCVS_UNEXECUTED, metadata: { ...EC_SCVS_UNEXECUTED.metadata } };
    const snapshot = JSON.stringify(candidate);
    assert.notEqual(detectExplicitNonProductionExecution(candidate), null);
    assert.equal(JSON.stringify(candidate), snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 2 · CASE B — QA cleanup
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 2 · CASE B — qa_cleanup se clasifica como no-producción', () => {
  it('la PRESENCIA estructurada de qa_cleanup ⇒ qa, ni unknown ni production', () => {
    const out = deriveRecordOriginClassification(QA_CLEANUP_CANDIDATE);

    // `qa` y no `historical_cleanup`: `record_origin` responde DE DÓNDE SALIÓ la
    // fila, y salió de un batch de QA. La limpieza es lo que le pasó después, y
    // eso lo cuenta `rejection_reason`. `historical_cleanup` se reserva para las
    // filas cuyo ORIGEN es la propia operación de limpieza (`logical_cleanup`).
    assert.equal(out.recordOrigin, 'qa');
    assert.notEqual(out.recordOrigin, 'unknown');
    assert.notEqual(out.recordOrigin, 'production');
    assert.equal(out.matchedRule, 'qa_marker');
    assert.equal(out.rejectionReason, 'test_record');
  });

  it('no depende del texto exacto: cualquier valor declarado basta', () => {
    for (const value of ['limpieza de QA visual', 'otro texto cualquiera', true]) {
      const out = deriveRecordOriginClassification({
        status: 'discarded',
        source_primary: 'web_ai',
        metadata: { qa_cleanup: value },
      });
      assert.equal(out.recordOrigin, 'qa', String(value));
    }
  });

  it('un qa_cleanup vacío NO clasifica: la ausencia no es un marcador', () => {
    const out = deriveRecordOriginClassification({
      status: 'discarded',
      source_primary: 'web_ai',
      metadata: { qa_cleanup: '   ' },
    });
    assert.notEqual(out.recordOrigin, 'qa');
  });

  it('el resto de la familia QA/test declarada también clasifica', () => {
    for (const key of ['qa', 'qa_run', 'test', 'is_test', 'test_run']) {
      const out = deriveRecordOriginClassification({
        status: 'needs_review',
        source_primary: 'web_ai',
        metadata: { [key]: true },
      });
      assert.equal(out.recordOrigin, 'qa', key);
    }
  });

  it('CASE G — la familia smoke declarada tampoco es production', () => {
    for (const key of ['smoke', 'is_smoke', 'smoke_run', 'smoke_test']) {
      const out = deriveRecordOriginClassification({
        status: 'needs_review',
        source_primary: 'apollo',
        metadata: { [key]: true },
      });
      assert.equal(out.recordOrigin, 'smoke_test', key);
    }
  });

  it('fixture / seed / synthetic declarados ⇒ synthetic, un valor que la CHECK 093 ya admite', () => {
    for (const key of ['synthetic', 'is_synthetic', 'fixture', 'is_fixture', 'seed', 'seeded']) {
      const out = deriveRecordOriginClassification({
        status: 'needs_review',
        source_primary: 'apollo',
        metadata: { [key]: true },
      });
      assert.equal(out.recordOrigin, 'synthetic', key);
      assert.equal(out.matchedRule, 'synthetic_marker', key);
      assert.notEqual(out.recordOrigin, 'production');
    }
  });

  it('cleanup / historical_cleanup declarados ⇒ historical_cleanup', () => {
    for (const key of ['cleanup', 'historical_cleanup']) {
      const out = deriveRecordOriginClassification({
        status: 'discarded',
        source_primary: 'web_ai',
        metadata: { [key]: true },
      });
      assert.equal(out.recordOrigin, 'historical_cleanup', key);
    }
  });

  it('import / external_import declarados ⇒ import', () => {
    for (const key of ['import', 'external_import']) {
      const out = deriveRecordOriginClassification({
        status: 'needs_review',
        source_primary: 'web_ai',
        metadata: { [key]: true },
      });
      assert.equal(out.recordOrigin, 'import', key);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 3 · CASE C — review_notes nunca prueba producción por sí sola
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 3 · CASE C — una nota de revisión no puede probar production', () => {
  it('nota comercial SIN procedencia positiva ⇒ NOT production, motivo conservado', () => {
    const out = deriveRecordOriginClassification(AMBIGUOUS_COMMERCIAL_NOTE);

    assert.notEqual(out.recordOrigin, 'production');
    assert.equal(out.recordOrigin, 'unknown');
    // El motivo comercial SÍ se conserva: es lo único que la nota aporta.
    assert.equal(out.rejectionReason, 'outside_icp');
    assert.equal(out.matchedRule, 'outside_icp_note');
    assert.ok(out.warnings.includes('production_evidence_insufficient'));
    assert.ok(out.warnings.includes('commercial_reason_low_confidence'));
  });

  it('el principio es general, no depende del texto basura concreto', () => {
    for (const note of [
      'fuera de segmento',
      'Fuera Del Segmento comercial objetivo',
      'fuera del segmento — pendiente de revisar',
    ]) {
      const out = deriveRecordOriginClassification({
        status: 'discarded',
        source_primary: 'manual',
        review_notes: note,
      });
      assert.notEqual(out.recordOrigin, 'production', note);
      assert.equal(out.rejectionReason, 'outside_icp', note);
    }
  });

  it('la MISMA nota con procedencia positiva de proveedor SÍ es production', () => {
    // Una empresa real de una corrida real, rechazada por motivo comercial, es
    // production con su motivo. Lo que cambia es de dónde sale la afirmación.
    const out = deriveRecordOriginClassification(
      { ...AMBIGUOUS_COMMERCIAL_NOTE, source_primary: 'apollo' },
      PRODUCTION_BATCH,
    );
    assert.equal(out.recordOrigin, 'production');
    assert.equal(out.rejectionReason, 'outside_icp');
    assert.equal(out.warnings.includes('production_evidence_insufficient'), false);
  });

  it('un lote de corrida real también acredita procedencia', () => {
    const out = deriveRecordOriginClassification(AMBIGUOUS_COMMERCIAL_NOTE, PRODUCTION_BATCH);
    assert.equal(out.recordOrigin, 'production');
  });

  it('hasPositiveProductionProvenance distingue humano de corrida automatizada', () => {
    assert.equal(hasPositiveProductionProvenance({ source_primary: 'apollo' }), true);
    assert.equal(hasPositiveProductionProvenance({ source_primary: 'web_ai' }), true);
    assert.equal(hasPositiveProductionProvenance({ source_primary: 'lusha' }), true);
    assert.equal(hasPositiveProductionProvenance({ status: 'converted_to_account' }), true);

    assert.equal(hasPositiveProductionProvenance({ source_primary: 'manual' }), false);
    assert.equal(hasPositiveProductionProvenance({ source_primary: 'other' }), false);
    assert.equal(hasPositiveProductionProvenance({ source_primary: null }), false);
    assert.equal(hasPositiveProductionProvenance({}), false);
    assert.equal(hasPositiveProductionProvenance({}, { source: 'manual' }), false);
    assert.equal(hasPositiveProductionProvenance({}, { source: 'imported' }), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 4 · CASE J — las pistas débiles se declaran y NO deciden
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 4 · CASE J — do_not_sync_hubspot / runner_required no fuerzan nada', () => {
  it('do_not_sync_hubspot=true SOLO no convierte una corrida real en no-producción', () => {
    // Una corrida REAL puede pedir deliberadamente no sincronizar con HubSpot.
    const out = deriveRecordOriginClassification(
      { ...APOLLO_PRODUCTION, metadata: { do_not_sync_hubspot: true } },
      PRODUCTION_BATCH,
    );
    assert.equal(out.recordOrigin, 'production');
    assert.equal(out.matchedRule, 'production_status');
    // Pero se declara que se vio y que no bastó.
    assert.ok(out.warnings.includes('nonproduction_hint_not_decisive'));
  });

  it('runner_required=true SOLO tampoco decide', () => {
    const out = deriveRecordOriginClassification(
      { ...APOLLO_PRODUCTION, metadata: { runner_required: true } },
      PRODUCTION_BATCH,
    );
    assert.equal(out.recordOrigin, 'production');
    assert.ok(out.warnings.includes('nonproduction_hint_not_decisive'));
  });

  it('las dos pistas juntas, sin ningún marcador fuerte, siguen sin decidir', () => {
    const out = deriveRecordOriginClassification(
      {
        ...APOLLO_PRODUCTION,
        metadata: { do_not_sync_hubspot: true, runner_required: true },
      },
      PRODUCTION_BATCH,
    );
    assert.equal(out.recordOrigin, 'production');
  });

  it('con un marcador fuerte al lado, la clasificación la decide el fuerte', () => {
    const out = deriveRecordOriginClassification({
      ...APOLLO_PRODUCTION,
      metadata: { do_not_sync_hubspot: true, runner_required: true, execution_authorized: false },
    });
    assert.notEqual(out.recordOrigin, 'production');
    assert.equal(out.matchedRule, 'unexecuted_or_unauthorized');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 5 · CASE D/E — la producción REAL sigue siendo producción
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 5 · CASE D/E — el clasificador no se volvió inservible', () => {
  it('Apollo real ⇒ production limpio', () => {
    const out = deriveRecordOriginClassification(APOLLO_PRODUCTION, PRODUCTION_BATCH);
    assert.equal(out.recordOrigin, 'production');
    assert.equal(out.rejectionReason, null);
    assert.equal(out.matchedRule, 'production_status');
    assert.equal(out.warnings.length, 0);
  });

  it('web_ai / Tavily real ⇒ production limpio', () => {
    const out = deriveRecordOriginClassification(WEB_AI_PRODUCTION, PRODUCTION_BATCH);
    assert.equal(out.recordOrigin, 'production');
    assert.equal(out.rejectionReason, null);
  });

  it('Lusha real, con el mismo contrato, ⇒ production limpio', () => {
    const out = deriveRecordOriginClassification(
      { ...APOLLO_PRODUCTION, source_primary: 'lusha' },
      PRODUCTION_BATCH,
    );
    assert.equal(out.recordOrigin, 'production');
  });

  it('los cuatro status de producción siguen resolviendo production', () => {
    for (const status of ['needs_review', 'approved', 'generated', 'normalized', 'converted_to_account']) {
      const out = deriveRecordOriginClassification({ ...APOLLO_PRODUCTION, status }, PRODUCTION_BATCH);
      assert.equal(out.recordOrigin, 'production', status);
    }
  });

  it('un duplicado de una corrida real sigue siendo production con su motivo', () => {
    const out = deriveRecordOriginClassification(
      { ...APOLLO_PRODUCTION, status: 'duplicate' },
      PRODUCTION_BATCH,
    );
    assert.equal(out.recordOrigin, 'production');
    assert.equal(out.rejectionReason, 'duplicate');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 6 · PRECEDENCIA explícita
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 6 · explicit_nonproduction gana a production_status', () => {
  it('needs_review + execution_authorized=false + live_pilot_not_executed=true ⇒ NOT production', () => {
    const out = deriveRecordOriginClassification({
      status: 'needs_review',
      source_primary: 'apollo',
      metadata: { execution_authorized: false, live_pilot_not_executed: true },
    });
    assert.notEqual(out.recordOrigin, 'production');
  });

  it('needs_review + qa_cleanup ⇒ NOT production', () => {
    const out = deriveRecordOriginClassification({
      status: 'needs_review',
      source_primary: 'apollo',
      metadata: { qa_cleanup: 'limpieza de QA visual' },
    });
    assert.notEqual(out.recordOrigin, 'production');
    assert.equal(out.recordOrigin, 'qa');
  });

  it('needs_review + contexto real limpio de Agent 1 ⇒ production', () => {
    const out = deriveRecordOriginClassification(APOLLO_PRODUCTION, PRODUCTION_BATCH);
    assert.equal(out.recordOrigin, 'production');
  });

  it('el orden entre familias es estable: smoke > qa > synthetic > cleanup > import > unexecuted', () => {
    // Cada paso quita el marcador que acaba de ganar; el siguiente de la lista
    // toma el relevo. Todos los desenlaces son no-producción, así que el ORDEN es
    // una cuestión de PRECISIÓN del diagnóstico, no de seguridad.
    const layers: [Record<string, unknown>, string][] = [
      [
        { smoke: true, qa: true, synthetic: true, cleanup: true, import: true, execution_authorized: false },
        'smoke_marker',
      ],
      [{ qa: true, synthetic: true, cleanup: true, import: true, execution_authorized: false }, 'qa_marker'],
      [{ synthetic: true, cleanup: true, import: true, execution_authorized: false }, 'synthetic_marker'],
      [{ cleanup: true, import: true, execution_authorized: false }, 'historical_cleanup_note'],
      [{ import: true, execution_authorized: false }, 'external_import'],
      [{ execution_authorized: false }, 'unexecuted_or_unauthorized'],
    ];

    for (const [metadata, expectedRule] of layers) {
      const out = deriveRecordOriginClassification({ status: 'needs_review', metadata });
      assert.equal(out.matchedRule, expectedRule, JSON.stringify(metadata));
      assert.notEqual(out.recordOrigin, 'production', JSON.stringify(metadata));
    }
  });

  it('NINGÚN camino de evidencia explícita de no-producción puede devolver production', () => {
    const nonProductionMetadatas: Record<string, unknown>[] = [
      { smoke_test: true },
      { smoke: true },
      { qa_only: true },
      { qa_cleanup: 'x' },
      { do_not_convert: true },
      { synthetic: true },
      { fixture: true },
      { seeded: true },
      { historical_cleanup: true },
      { import: true },
      { execution_authorized: false },
      { provider_calls_allowed: false },
      { live_pilot_not_executed: true },
    ];

    for (const metadata of nonProductionMetadatas) {
      for (const status of ['needs_review', 'approved', 'duplicate', 'converted_to_account']) {
        const out = deriveRecordOriginClassification(
          { ...APOLLO_PRODUCTION, status, metadata },
          PRODUCTION_BATCH,
        );
        assert.notEqual(out.recordOrigin, 'production', `${status} · ${JSON.stringify(metadata)}`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 7 · REGRESIÓN del writer de PR #256
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 7 · el contrato del writer de #256 sigue en pie', () => {
  it('corrida real, dry_run=false, sin marcadores ⇒ record_origin=production', () => {
    const resolution = resolveCandidateRecordOriginForWriter({
      dryRun: false,
      candidate: APOLLO_PRODUCTION,
      batch: PRODUCTION_BATCH,
    });

    assert.equal(resolution.recordOrigin, CANONICAL_PRODUCTION_RECORD_ORIGIN);
    assert.equal(resolution.isCleanProduction, true);
    assert.deepEqual(toCandidateRecordOriginColumns(resolution), { record_origin: 'production' });
  });

  it('CASE F — dry_run=true ⇒ ausencia, no production', () => {
    const resolution = resolveCandidateRecordOriginForWriter({
      dryRun: true,
      candidate: APOLLO_PRODUCTION,
      batch: PRODUCTION_BATCH,
    });

    assert.equal(resolution.recordOrigin, null);
    assert.equal(resolution.isCleanProduction, false);
    assert.deepEqual(toCandidateRecordOriginColumns(resolution), {});
  });

  it('smoke / fixture / synthetic / QA cleanup / no-ejecutado NUNCA ascienden a production', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['smoke', { smoke_test: true }],
      ['fixture', { fixture: true }],
      ['synthetic', { synthetic: true }],
      ['qa_cleanup', { qa_cleanup: 'limpieza de QA visual' }],
      ['unexecuted', { execution_authorized: false }],
    ];

    for (const [label, metadata] of cases) {
      const resolution = resolveCandidateRecordOriginForWriter({
        dryRun: false,
        candidate: { ...APOLLO_PRODUCTION, metadata },
        batch: PRODUCTION_BATCH,
      });
      assert.notEqual(resolution.recordOrigin, 'production', label);
      assert.equal(resolution.isCleanProduction, false, label);
    }
  });

  it('la proyección sigue sin escribir classification_source ni classification_confidence', () => {
    // PR #238 / #241 § 7: esas columnas tienen otro escritor y otra semántica.
    // Escribirlas desde aquí reprodujo una vez el 23514 de la CHECK 093.
    for (const metadata of [{}, { qa_cleanup: 'x' }, { execution_authorized: false }]) {
      const columns = toCandidateRecordOriginColumns(
        resolveCandidateRecordOriginForWriter({
          dryRun: false,
          candidate: { ...APOLLO_PRODUCTION, metadata },
          batch: PRODUCTION_BATCH,
        }),
      );
      assert.equal('classification_source' in columns, false);
      assert.equal('classification_confidence' in columns, false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 8 · los cuatro gates de la cola limpia, sin tocarlos
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 8 · los cuatro gates de revisión', () => {
  const gates = [
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

  for (const gate of gates) {
    it(`${gate.name} — production PASA`, () => {
      assert.equal(gate.run(CANONICAL_PRODUCTION_RECORD_ORIGIN).decision, gate.pass);
    });

    it(`${gate.name} — NULL y todo origen no-production siguen BLOQUEADOS`, () => {
      for (const origin of [
        null,
        'smoke_test',
        'qa',
        'historical_cleanup',
        'import',
        'synthetic',
        'unknown',
      ]) {
        const decision = gate.run(origin);
        assert.equal(decision.decision, 'reject', String(origin));
        assert.equal((decision as { reason: string }).reason, 'not_clean_production', String(origin));
      }
    });
  }

  it('lo que el clasificador endurecido produce sobre los casos A/B/C queda BLOQUEADO', () => {
    for (const candidate of [EC_SCVS_UNEXECUTED, QA_CLEANUP_CANDIDATE, AMBIGUOUS_COMMERCIAL_NOTE]) {
      const origin = deriveRecordOriginClassification(candidate).recordOrigin;
      for (const gate of gates) {
        assert.equal(gate.run(origin).decision, 'reject', `${gate.name} · ${origin}`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 9 · pureza y tolerancia
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 9 · pureza, tolerancia y ausencia de I/O', () => {
  it('no muta candidato ni lote, incluida la metadata anidada', () => {
    const candidate: ClassifiableCandidate = {
      status: 'needs_review',
      source_primary: 'apollo',
      metadata: { context: { execution_authorized: false }, do_not_sync_hubspot: true },
      review_flags: { runner_required: true },
    };
    const batch: ClassifiableBatch = { source: 'agent_1', name: 'x', metadata: { nested: { qa: true } } };
    const candidateSnapshot = JSON.stringify(candidate);
    const batchSnapshot = JSON.stringify(batch);

    deriveRecordOriginClassification(candidate, batch);

    assert.equal(JSON.stringify(candidate), candidateSnapshot);
    assert.equal(JSON.stringify(batch), batchSnapshot);
  });

  it('nunca lanza sobre datos parciales, nulos o de tipo inesperado', () => {
    assert.doesNotThrow(() => deriveRecordOriginClassification({}));
    assert.doesNotThrow(() => deriveRecordOriginClassification({ metadata: null, review_flags: null }));
    assert.doesNotThrow(() =>
      deriveRecordOriginClassification({ metadata: [] as unknown as Record<string, unknown> }),
    );
    assert.doesNotThrow(() =>
      deriveRecordOriginClassification({ status: 'needs_review', metadata: { context: null } }, {
        source: null,
        name: null,
        metadata: null,
      }),
    );
    assert.doesNotThrow(() => detectExplicitNonProductionExecution({}));
    assert.doesNotThrow(() => hasPositiveProductionProvenance({}));
  });

  it('la confianza sigue dentro del rango que la CHECK 093 admite (0–100)', () => {
    const samples: ClassifiableCandidate[] = [
      EC_SCVS_UNEXECUTED,
      QA_CLEANUP_CANDIDATE,
      AMBIGUOUS_COMMERCIAL_NOTE,
      APOLLO_PRODUCTION,
      WEB_AI_PRODUCTION,
      {},
    ];
    for (const candidate of samples) {
      const { classificationConfidence } = deriveRecordOriginClassification(candidate, PRODUCTION_BATCH);
      assert.ok(Number.isInteger(classificationConfidence));
      assert.ok(classificationConfidence >= 0 && classificationConfidence <= 100);
    }
  });
});
