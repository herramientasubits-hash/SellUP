/**
 * A1-CERTIFICATION-BASELINE § CUT-C.3 — una corrida de Apollo y una de Lusha se
 * pueden conservar y comparar DESPUÉS, sin volver a pagarles.
 *
 * ── Lo que esta suite afirma ─────────────────────────────────────────────────
 *
 *   A  El catálogo de campos cubre TODO el alcance pedido, sin omisiones.
 *   B  Apollo se proyecta desde su fila de gasto REAL.
 *   C  Lusha se proyecta desde la suya.
 *   D  🔴 La asimetría que hace hoy IMPOSIBLE comparar rendimiento útil:
 *      Apollo no publica `accepted_for_target` y Lusha sí.
 *   E  Las métricas devuelven `null` —no 0— cuando su insumo falta.
 *   F  Un proveedor NUEVO entra escribiendo su adaptador, sin recorrer los dos
 *      anteriores: se prueba con uno inventado.
 *   G  Trinquetes de mutación.
 *
 * ── Lo que esta suite NO afirma ──────────────────────────────────────────────
 *
 * · Nada sobre `coverage` ni `overlap`: son propiedades del CONJUNTO de
 *   identidades de dos corridas, no de una fila, y por eso salen `null`.
 * · Nada sobre una migración: este corte no la ejecuta. El diseño mínimo vive en
 *   `docs/CERTIFICATION_BASELINE.md` y § A lo fija.
 *
 * 0 llamadas a proveedor · 0 escrituras · 0 migraciones · 0 créditos · 0 flags.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CERTIFICATION_BASELINE_FIELDS,
  CERTIFICATION_METRICS,
  buildCertificationBaselineRow,
  computeCertificationMetrics,
  CERT_SEAM_ACCEPTED_NOT_CORRELATED,
  CERT_SEAM_NO_CERTIFICATION_RUN_ID,
  CERT_SEAM_PROVIDER_ORDER_DERIVED_FROM_CLOCK,
  type CertificationBaselineInput,
} from '../certification-baseline';
import {
  apolloUsageLogToCertificationBaseline,
  lushaUsageLogToCertificationBaseline,
  deriveProviderOrder,
  type ProviderUsageLogLike,
} from '../usage-log-adapters';

// ── Fixtures: la FORMA REAL de Producción (verificada 11-09-2026) ─────────────

/**
 * `apollo/organizations_search`. `accepted_for_target: null` no es un descuido
 * del fixture: es lo que Producción trae en 16 de 16 filas, y el propio bloque
 * lo declara con su costura.
 */
const APOLLO_LOG: ProviderUsageLogLike = {
  provider_key: 'apollo',
  operation_key: 'organizations_search',
  credits_used: 1,
  results_returned: 3,
  duration_ms: 1820,
  wizard_run_id: '294298cdd4fa9c37baf9a33543cb1355',
  request_fingerprint: 'organization_locations=colombia|per_page=100',
  batch_id: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-09-08T12:50:07.978Z',
  metadata: {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'technology',
    apollo_benchmark_funnel: {
      paid_raw: 3,
      unique: 3,
      duplicate: 0,
      provider_seen_hit: 3,
      historical_known: null,
      precision_rejected: 0,
      accepted_for_target: null,
      fields_missing: ['historical_known', 'accepted_for_target'],
    },
    apollo_pagination: {
      pages_processed: 1,
      effective_request_fingerprint_sent: 'organization_locations=colombia|page=1',
      normalization: { duplicates_removed_count: 21 },
    },
  },
};

/** `lusha/company_prospecting_v3`. */
const LUSHA_LOG: ProviderUsageLogLike = {
  provider_key: 'lusha',
  operation_key: 'company_prospecting_v3',
  credits_used: 2,
  results_returned: 5,
  duration_ms: 940,
  wizard_run_id: '294298cdd4fa9c37baf9a33543cb1355',
  request_fingerprint: 'lusha|CO|technology',
  batch_id: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-09-08T12:50:40.863Z',
  metadata: {
    lusha_run_observability: {
      country_code: 'CO',
      macro_industry_key: 'technology',
      credits_settled: 2,
      reviewable_found_total: 8,
      accepted_for_target_total: 5,
      target_overflow_discarded: 3,
      precision_rejected: 0,
      exact_duplicates: 0,
      run: {
        rawResultsTotal: 50,
        providerRequestsUsed: 2,
        crossBranchDuplicatesRemoved: 2,
      },
    },
  },
};

function baseInput(o: Partial<CertificationBaselineInput> = {}): CertificationBaselineInput {
  return {
    provider: 'apollo',
    providerOrder: 1,
    wizardRunId: 'run-1',
    batchId: 'batch-1',
    certificationRunId: null,
    country: 'CO',
    macroIndustry: 'technology',
    requestFingerprint: 'fp',
    pages: 1,
    credits: 1,
    latencyMs: 100,
    companiesSeen: 10,
    companiesAccepted: 4,
    companiesRejected: 6,
    employeeCountKnown: 7,
    identityResolved: 9,
    dedupeRemoved: 1,
    dispositions: { other: 2 },
    startedAt: '2026-09-08T12:00:00.000Z',
    finishedAt: '2026-09-08T12:00:10.000Z',
    ...o,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A · el catálogo cubre el alcance pedido
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.3 § A — catálogo', () => {
  it('están TODOS los campos del alcance, sin omisiones', () => {
    const required = [
      'country',
      'macro_industry',
      'provider',
      'provider_order',
      'certification_run_id',
      'wizard_run_id',
      'batch_id',
      'request_fingerprint',
      'pages',
      'credits',
      'companies_seen',
      'companies_accepted',
      'companies_rejected',
      'employee_count_known',
      'identity_resolved',
      'dedupe_removed',
      'dispositions',
      'started_at',
      'finished_at',
    ] as const;
    for (const field of required) {
      assert.ok(
        (CERTIFICATION_BASELINE_FIELDS as readonly string[]).includes(field),
        `falta el campo ${field} del alcance`,
      );
    }
  });

  it('están TODAS las métricas que la certificación debe poder calcular', () => {
    for (const metric of [
      'useful_yield',
      'precision',
      'coverage',
      'overlap',
      'cost_per_useful',
      'pages',
      'latency_ms',
    ] as const) {
      assert.ok((CERTIFICATION_METRICS as readonly string[]).includes(metric));
    }
  });

  it('el diseño de la migración mínima está escrito y NO ejecutado', () => {
    const doc = path.join(process.cwd(), 'docs/CERTIFICATION_BASELINE.md');
    assert.ok(fs.existsSync(doc), 'falta el documento de diseño');
    const text = fs.readFileSync(doc, 'utf8');
    assert.match(text, /MIGRACIONES\s*=\s*0/);
    // 🔴 Y no hay migración nueva en el repo: este corte no migra.
    const migrations = fs
      .readdirSync(path.join(process.cwd(), 'supabase/migrations'))
      .filter((f) => /^1[3-9][0-9]_.*certification.*\.sql$/i.test(f));
    assert.deepEqual(migrations, [], 'este corte no puede traer una migración');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B/C · las dos proyecciones, desde la fila de gasto real
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.3 § B — Apollo', () => {
  const row = apolloUsageLogToCertificationBaseline(APOLLO_LOG, { providerOrder: 1 });

  it('identidad, país e industria salen de la fila que ya existe', () => {
    assert.equal(row.values.provider, 'apollo');
    assert.equal(row.values.wizard_run_id, '294298cdd4fa9c37baf9a33543cb1355');
    assert.equal(row.values.batch_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(row.values.country, 'CO');
    assert.equal(row.values.macro_industry, 'technology');
  });

  it('economía y esfuerzo: páginas, créditos y latencia', () => {
    assert.equal(row.values.pages, 1);
    assert.equal(row.values.credits, 1);
    assert.equal(row.values.latency_ms, 1820);
  });

  it('embudo: vistas y rechazadas sí; dedupe también', () => {
    assert.equal(row.values.companies_seen, 3);
    assert.equal(row.values.companies_rejected, 0);
    assert.equal(row.values.dedupe_removed, 0);
  });

  it('🔴 `companies_accepted` sale null — y la costura queda NOMBRADA', () => {
    assert.equal(row.values.companies_accepted, null);
    assert.equal(row.field_sources.companies_accepted, 'missing');
    assert.equal(
      row.missing_correlation_seams.companies_accepted,
      CERT_SEAM_ACCEPTED_NOT_CORRELATED,
    );
  });

  it('NO se sustituye por `unique` ni por `results_returned`', () => {
    // Las dos cifras están a mano en el fixture y valen 3. Usar cualquiera sería
    // responder OTRA pregunta con el mismo nombre.
    assert.notEqual(row.values.companies_accepted, 3);
  });
});

describe('CUT-C.3 § C — Lusha', () => {
  const row = lushaUsageLogToCertificationBaseline(LUSHA_LOG, { providerOrder: 2 });

  it('país e industria salen de su bloque de observabilidad', () => {
    assert.equal(row.values.country, 'CO');
    assert.equal(row.values.macro_industry, 'technology');
  });

  it('economía y embudo completos', () => {
    assert.equal(row.values.pages, 2);
    assert.equal(row.values.credits, 2);
    assert.equal(row.values.companies_seen, 50);
    assert.equal(row.values.companies_accepted, 5);
    // 0 precisión + 0 duplicados exactos + 3 sobrantes de objetivo
    assert.equal(row.values.companies_rejected, 3);
    assert.equal(row.values.dedupe_removed, 2);
  });

  it('`companies_accepted` es OBSERVADO, no derivado', () => {
    assert.equal(row.field_sources.companies_accepted, 'observed');
    assert.equal(row.missing_correlation_seams.companies_accepted, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D · la asimetría: el hallazgo central de la auditoría
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.3 § D — asimetría Apollo/Lusha', () => {
  it('🔴 el rendimiento útil es calculable para Lusha y NO para Apollo', () => {
    const apollo = computeCertificationMetrics(
      apolloUsageLogToCertificationBaseline(APOLLO_LOG),
    );
    const lusha = computeCertificationMetrics(
      lushaUsageLogToCertificationBaseline(LUSHA_LOG),
    );
    assert.equal(apollo.useful_yield, null, 'Apollo no puede calcular rendimiento útil hoy');
    assert.equal(lusha.useful_yield, 5 / 50);
    // …y lo mismo con el coste por empresa útil.
    assert.equal(apollo.cost_per_useful, null);
    assert.equal(lusha.cost_per_useful, 2 / 5);
  });

  it('las dos corridas de la MISMA ejecución se unen por `wizard_run_id`', () => {
    // Es la correlación que ya funciona: una corrida real de Producción
    // (08-09-2026) tiene 2 filas Apollo y 1 Lusha bajo el mismo id.
    assert.equal(APOLLO_LOG.wizard_run_id, LUSHA_LOG.wizard_run_id);
    const order = deriveProviderOrder([LUSHA_LOG, APOLLO_LOG]);
    assert.equal(order.get(APOLLO_LOG), 1, 'Apollo corrió primero por reloj');
    assert.equal(order.get(LUSHA_LOG), 2);
  });

  it('`certification_run_id` NO existe en ninguna de las dos, y se nombra', () => {
    for (const row of [
      apolloUsageLogToCertificationBaseline(APOLLO_LOG),
      lushaUsageLogToCertificationBaseline(LUSHA_LOG),
    ]) {
      assert.equal(row.values.certification_run_id, null);
      assert.equal(
        row.missing_correlation_seams.certification_run_id,
        CERT_SEAM_NO_CERTIFICATION_RUN_ID,
      );
    }
  });

  it('`provider_order` nunca es `observed`: sale del reloj', () => {
    const row = apolloUsageLogToCertificationBaseline(APOLLO_LOG, { providerOrder: 1 });
    assert.equal(row.field_sources.provider_order, 'derived');
    const sinOrden = apolloUsageLogToCertificationBaseline(APOLLO_LOG);
    assert.equal(
      sinOrden.missing_correlation_seams.provider_order,
      CERT_SEAM_PROVIDER_ORDER_DERIVED_FROM_CLOCK,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E · métricas: null, nunca 0
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.3 § E — métricas', () => {
  it('sin `companies_accepted` no hay rendimiento útil ni coste — y son null', () => {
    const m = computeCertificationMetrics(
      buildCertificationBaselineRow(baseInput({ companiesAccepted: null })),
    );
    assert.equal(m.useful_yield, null);
    assert.equal(m.precision, null);
    assert.equal(m.cost_per_useful, null);
  });

  it('🔴 un 0 legítimo NO se confunde con un null', () => {
    const m = computeCertificationMetrics(
      buildCertificationBaselineRow(baseInput({ companiesAccepted: 0, companiesRejected: 10 })),
    );
    assert.equal(m.useful_yield, 0, '0 aceptadas de 10 vistas es CERO, no desconocido');
    assert.equal(m.precision, 0);
    // El coste por útil sí es indefinido: dividir entre 0 no es 0.
    assert.equal(m.cost_per_useful, null);
  });

  it('`coverage` y `overlap` son de conjunto: una fila no las responde', () => {
    const m = computeCertificationMetrics(buildCertificationBaselineRow(baseInput()));
    assert.equal(m.coverage, null);
    assert.equal(m.overlap, null);
  });

  it('con todo presente, todas las demás se calculan', () => {
    const m = computeCertificationMetrics(buildCertificationBaselineRow(baseInput()));
    assert.equal(m.useful_yield, 4 / 10);
    assert.equal(m.precision, 4 / 10);
    assert.equal(m.cost_per_useful, 1 / 4);
    assert.equal(m.pages, 1);
    assert.equal(m.latency_ms, 100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F · un proveedor NUEVO entra sin volver a pagar los anteriores
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.3 § F — proveedor nuevo', () => {
  it('se compara contra Apollo y Lusha usando SÓLO sus filas conservadas', () => {
    // El proveedor nuevo aporta su fila; los dos anteriores se leen de lo que ya
    // está persistido. Cero llamadas, cero créditos para Apollo y Lusha.
    const nuevo = buildCertificationBaselineRow(
      baseInput({
        provider: 'proveedor_nuevo',
        providerOrder: 3,
        companiesSeen: 40,
        companiesAccepted: 12,
        companiesRejected: 28,
        credits: 3,
      }),
    );
    const lusha = lushaUsageLogToCertificationBaseline(LUSHA_LOG, { providerOrder: 2 });

    const mNuevo = computeCertificationMetrics(nuevo);
    const mLusha = computeCertificationMetrics(lusha);

    assert.equal(mNuevo.useful_yield, 12 / 40);
    assert.equal(mLusha.useful_yield, 5 / 50);
    assert.ok(
      (mNuevo.useful_yield as number) > (mLusha.useful_yield as number),
      'la comparación tiene que ser posible con los dos números a la vez',
    );
  });

  it('un proveedor nuevo que NO publique aceptadas queda declarado, no estimado', () => {
    const row = buildCertificationBaselineRow(
      baseInput({ provider: 'proveedor_opaco', companiesAccepted: null }),
    );
    assert.ok(row.fields_missing.includes('companies_accepted'));
    assert.equal(computeCertificationMetrics(row).useful_yield, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G · trinquetes de mutación
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.3 § G — trinquetes', () => {
  it('MUTACIÓN — colapsar null en 0 haría comparable lo incomparable', () => {
    // Si `companies_accepted` se rellenara con 0 cuando falta, el rendimiento
    // útil de Apollo saldría 0 y una certificación lo leería como «midió y no
    // sirvió», que es exactamente la conclusión falsa.
    const row = apolloUsageLogToCertificationBaseline(APOLLO_LOG);
    assert.notEqual(row.values.companies_accepted, 0);
    assert.equal(row.values.companies_accepted, null);
  });

  it('MUTACIÓN — todo campo ausente tiene que aparecer en `fields_missing`', () => {
    const row = buildCertificationBaselineRow(
      baseInput({ credits: null, pages: null, latencyMs: null }),
    );
    for (const f of ['credits', 'pages', 'latency_ms'] as const) {
      assert.ok(row.fields_missing.includes(f), `${f} ausente pero no declarado`);
      assert.equal(row.field_sources[f], 'missing');
    }
  });

  it('MUTACIÓN — `fields_missing` y `field_sources` no pueden discrepar', () => {
    for (const row of [
      buildCertificationBaselineRow(baseInput()),
      buildCertificationBaselineRow(baseInput({ companiesAccepted: null, dispositions: null })),
      apolloUsageLogToCertificationBaseline(APOLLO_LOG),
      lushaUsageLogToCertificationBaseline(LUSHA_LOG),
    ]) {
      const missingBySource = CERTIFICATION_BASELINE_FIELDS.filter(
        (f) => row.field_sources[f] === 'missing',
      );
      assert.deepEqual([...row.fields_missing], missingBySource);
    }
  });

  it('GUARDA ESTÁTICA — el módulo no escribe, no lee base y no llama proveedor', () => {
    const dir = path.join(process.cwd(), 'src/modules/provider-certification');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const forbidden of [
        'createClient',
        'supabase',
        'fetch(',
        'insert(',
        'upsert(',
        'apiKey',
      ]) {
        assert.ok(
          !src.includes(forbidden),
          `${file} contiene \`${forbidden}\`: la línea base debe ser una proyección PURA`,
        );
      }
    }
  });
});
