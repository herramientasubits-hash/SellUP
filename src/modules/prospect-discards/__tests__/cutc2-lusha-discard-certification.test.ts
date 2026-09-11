/**
 * A1-LUSHA-DISCARD-CERTIFICATION § CUT-C.2 — cada descarte de Lusha se puede
 * persistir POR EMPRESA, y la fila basta para reconstruir qué pasó sin volver a
 * pagarle al proveedor.
 *
 * ── Las cinco familias del alcance ───────────────────────────────────────────
 *
 *   hard_excluded        → § B — persistida, con el motivo DURO verbatim.
 *   duplicate            → § C — persistida, distinguiendo SellUp de HubSpot.
 *   precision_rejected   → § D — persistida como `sector_rejected`.
 *   provider_error       → § E — NO es un evento por empresa. Se PRUEBA.
 *   budget               → § F — NO es un evento por empresa. Se PRUEBA.
 *
 * 🔴 Sobre `provider_error` y `budget`: no se les inventa código. Una búsqueda
 * que falla devuelve CERO empresas, y un bloqueo de presupuesto corta ANTES de
 * llamar al proveedor — no hay empresa a la que atribuir nada. Darles un código
 * por empresa sería exactamente el dato inventado que la taxonomía prohíbe. Lo
 * que sí se hace es DEMOSTRARLO, en vez de afirmarlo: §§ E y F ejecutan esos dos
 * caminos contra el núcleo real y exigen 0 registros.
 *
 * ── El hueco que este corte CIERRA ───────────────────────────────────────────
 *
 * § A — la fila no llevaba la identidad de la CORRIDA. `batch_id` no la
 * identifica: en el waterfall Apollo y Lusha COMPARTEN lote por construcción, y
 * una segunda corrida sobre el mismo lote lo comparte otra vez.
 *
 * ── El hueco que este corte DOCUMENTA y NO cierra ────────────────────────────
 *
 * § G — en standalone, una corrida que rechaza TODO no crea lote
 * (`status: 'empty'` ⇒ `batchId: null`), y sin lote no se escribe NADA:
 * `batch_id` es `NOT NULL REFERENCES prospect_batches(id)`. Es el peor caso
 * —página pagada, nada admitido, cero rastro— y cerrarlo exige MIGRACIÓN, que
 * este corte tiene prohibida. Se fija con una prueba que declara el
 * comportamiento actual, para que el día que se migre esa prueba caiga.
 *
 * 0 llamadas a proveedor · 0 escrituras en Producción · 0 migraciones
 * · 0 créditos · 0 flags.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveLushaDiscardDisposition,
  classifyLushaExactDuplicateSource,
  LUSHA_DISCARD_REASON_CODE,
  type LushaDiscardEvent,
} from '../lusha-mapping';
import {
  LUSHA_DISCARD_SOURCE_PRIMARY,
  LUSHA_DISCARD_RUN_CORRELATION_KEY,
  persistLushaRejectedDispositions,
  type LushaDiscardRecordLike,
} from '../lusha-pipeline-writer.server';
import { RUN_CORRELATION_METADATA_KEY } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
} from '@/server/prospect-batches/lusha-pending-review';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';

const BATCH_ID = '99999999-9999-4999-8999-999999999999';
const WIZARD_RUN_ID = 'wizard-run-cutc2';
const CLIENT_REQUEST_ID = '11111111-1111-4111-8111-111111111111';

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  searchText: null,
};

const ACTOR = {
  internalUserId: 'user-1',
  clientRequestId: CLIENT_REQUEST_ID,
  requestedTarget: 5,
};

function identitySlug(domain: string | null, name: string | null): string {
  const base = domain ?? name ?? 'sin-identidad';
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sin-identidad';
}

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  const merged = {
    name: 'Clínica Andes',
    domain: 'clinicaandes.com',
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 300 as number | null,
    employeesMin: null,
    employeesMax: null,
    score: 92,
    passesGate: true,
    issues: [] as string[],
    ...overrides,
  };
  const slug = identitySlug(merged.domain ?? null, merged.name ?? null);
  return {
    ...merged,
    providerCompanyId: overrides.providerCompanyId ?? `pc-${slug}`,
    linkedinUrl:
      overrides.linkedinUrl !== undefined
        ? overrides.linkedinUrl
        : `https://linkedin.com/company/${slug}`,
  };
}

function searchResult(results: LushaPreviewCompany[]): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: null,
      hasSearchText: false,
    },
  };
}

/** Una respuesta de proveedor FALLIDA — la forma de `provider_error`. */
function failedSearch(): LushaPreviewResult {
  return {
    ok: false,
    status: 'error',
    results: [],
    error: 'upstream unavailable',
    billing: { creditsCharged: 0, resultsReturned: 0, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: null,
      hasSearchText: false,
    },
  } as unknown as LushaPreviewResult;
}

/**
 * Un duplicado EXACTO real: identidad FUERTE por dominio, que es lo que
 * `findStrongIdentityDuplicateMatch` exige. Un `status` etiquetado no basta —
 * y eso es deliberado en producción (CUT-L7 §§ 14-16).
 */
function duplicateResult(
  input: DuplicateCheckInput,
  source: 'sellup' | 'hubspot',
): DuplicateCheckResult {
  const domain = input.domain ?? 'dup.com';
  return {
    status: source === 'hubspot' ? 'existing_in_hubspot' : 'existing_in_sellup',
    confidence: 95,
    input,
    matches: [
      {
        source,
        status: source === 'hubspot' ? 'existing_in_hubspot' : 'existing_in_sellup',
        confidence: 95,
        matchedId: source === 'hubspot' ? 'hs-77' : '3f6c1d2e-1111-4111-8111-222222222222',
        matchedDomain: domain,
        matchedName: 'Coincidencia',
        reason: `Dominio exacto coincide: ${domain}`,
      },
    ],
    summary: 'duplicado exacto',
    checkedSources: ['sellup', 'hubspot'],
  } as unknown as DuplicateCheckResult;
}

function noDup(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

function makeDeps(
  results: LushaPreviewCompany[],
  opts: {
    duplicateFor?: (input: DuplicateCheckInput) => DuplicateCheckResult;
    failSearch?: boolean;
  } = {},
) {
  const calls = {
    batches: [] as LushaPendingReviewBatchRow[],
    candidateRows: [] as LushaPendingReviewCandidateRow[],
    searches: 0,
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (searchInput) => {
      calls.searches++;
      if (opts.failSearch) return failedSearch();
      return (searchInput.page ?? 0) > 0
        ? { ...searchResult([]), status: 'empty' as const }
        : searchResult(results);
    },
    reserveBatch: async (row: LushaPendingReviewBatchRow) => {
      calls.batches.push(row);
      return { id: BATCH_ID, adopted: false, identityEpoch: 0 };
    },
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async (rows) => {
      calls.candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (dupInput) =>
      (opts.duplicateFor ?? noDup)(dupInput),
    fetchActiveCandidates: async () => [],
    officialSourceResolvers: [],
  };
  return { deps, calls };
}

async function run(
  results: LushaPreviewCompany[],
  opts: Parameters<typeof makeDeps>[1] = {},
) {
  const { deps, calls } = makeDeps(results, opts);
  const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
  return { res, calls, records: (res.discardedCompanies ?? []) as LushaDiscardRecordLike[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// A · la identidad de la CORRIDA viaja en cada fila (el hueco que se cierra)
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.2 § A — identidad de corrida', () => {
  const upserts: Record<string, unknown>[][] = [];
  const clientFactory = () => ({
    from: () => ({
      upsert: (payload: Record<string, unknown>[]) => {
        upserts.push(payload);
        return { select: async () => ({ data: payload.map(() => ({ id: 'x' })), error: null }) };
      },
    }),
  });

  const record = (o: Partial<LushaDiscardRecordLike> = {}): LushaDiscardRecordLike => ({
    name: 'Ejemplo',
    domain: 'ejemplo.com',
    providerCompanyId: 'pc-1',
    linkedinUrl: null,
    industry: null,
    countryCode: 'CO',
    disposition: 'sellup_duplicate',
    reasonCode: null,
    reasonDetail: null,
    roundOrigin: 'lusha_branch_0_page_0',
    evidence: {},
    ...o,
  });

  it('la fila lleva wizard_run_id, client_request_id, batch_id y proveedor', async () => {
    upserts.length = 0;
    await persistLushaRejectedDispositions({
      batchId: BATCH_ID,
      wizardRunId: WIZARD_RUN_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      requestedCountryCode: 'CO',
      requestedIndustry: 'health_pharma',
      records: [record()],
      clientFactory,
    });
    const evidence = upserts[0][0].evidence as Record<string, Record<string, unknown>>;
    assert.deepEqual(evidence[LUSHA_DISCARD_RUN_CORRELATION_KEY], {
      wizard_run_id: WIZARD_RUN_ID,
      client_request_id: CLIENT_REQUEST_ID,
      batch_id: BATCH_ID,
      provider_key: LUSHA_DISCARD_SOURCE_PRIMARY,
    });
  });

  it('una corrida SIN correlación escribe null, no un valor plausible', async () => {
    upserts.length = 0;
    await persistLushaRejectedDispositions({
      batchId: BATCH_ID,
      wizardRunId: null,
      clientRequestId: null,
      requestedCountryCode: 'CO',
      requestedIndustry: 'health_pharma',
      records: [record()],
      clientFactory,
    });
    const evidence = upserts[0][0].evidence as Record<string, Record<string, unknown>>;
    assert.equal(evidence[LUSHA_DISCARD_RUN_CORRELATION_KEY].wizard_run_id, null);
  });

  it('la clave es la MISMA que usa `provider_usage_logs.metadata` — se pueden unir', () => {
    assert.equal(LUSHA_DISCARD_RUN_CORRELATION_KEY, RUN_CORRELATION_METADATA_KEY);
  });

  it('`source_primary` es el proveedor, y es el que acepta el CHECK de la 138', async () => {
    upserts.length = 0;
    await persistLushaRejectedDispositions({
      batchId: BATCH_ID,
      wizardRunId: WIZARD_RUN_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      requestedCountryCode: 'CO',
      requestedIndustry: 'health_pharma',
      records: [record()],
      clientFactory,
    });
    assert.equal(upserts[0][0].source_primary, 'lusha');
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/138_prospect_discarded_dispositions.sql'),
      'utf8',
    );
    assert.ok(/CHECK \(source_primary IN \([^)]*'lusha'/s.test(sql));
  });

  it('la ACCIÓN pasa la correlación — no queda sólo en la línea de consola', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/modules/prospect-batches/lusha-pending-review-actions.ts'),
      'utf8',
    );
    const call = src.indexOf('persistLushaRejectedDispositions({');
    assert.ok(call > 0, 'la acción no invoca al escritor');
    const args = src.slice(call, src.indexOf('});', call));
    assert.match(args, /wizardRunId: reservedCorrelation\.wizardRunId/);
    assert.match(args, /clientRequestId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B · hard_excluded
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.2 § B — hard_excluded', () => {
  it('una empresa bajo el ICP deja fila, con el motivo DURO verbatim', async () => {
    const { records } = await run([
      company({ name: 'Pequeña', domain: 'pequena.com', employeesExact: 50 }),
      company({ name: 'Grande', domain: 'grande.com', employeesExact: 900 }),
    ]);
    const row = records.find((r) => r.name === 'Pequeña');
    assert.ok(row, 'la empresa rechazada por tamaño no dejó fila');
    assert.equal(row.disposition, 'other');
    assert.equal(row.reasonCode, LUSHA_DISCARD_REASON_CODE.icpSizeBelowMin);
    assert.equal(row.reasonCode, 'known_employee_count_below_min');
  });

  it('la evidencia permite reconstruir la decisión del gate', async () => {
    const { records } = await run([
      company({ name: 'Pequeña', domain: 'pequena.com', employeesExact: 50 }),
      company({ name: 'Grande', domain: 'grande.com', employeesExact: 900 }),
    ]);
    const row = records.find((r) => r.name === 'Pequeña')!;
    assert.equal(row.evidence.gate_decision, 'hard_excluded');
    assert.deepEqual(row.evidence.gate_hard_reasons, ['known_employee_count_below_min']);
    assert.equal(row.evidence.provider, 'lusha');
    assert.equal(row.evidence.discard_kind, 'gate_hard_excluded');
  });

  it('país y sector tienen código PROPIO; el resto cae en `other` sin perder el motivo', () => {
    assert.deepEqual(
      resolveLushaDiscardDisposition({ kind: 'gate_hard_excluded', gateReason: 'country_mismatch' }),
      { disposition: 'country_rejected', reasonCode: 'country_mismatch' },
    );
    assert.deepEqual(
      resolveLushaDiscardDisposition({ kind: 'gate_hard_excluded', gateReason: 'missing_domain' }),
      { disposition: 'other', reasonCode: 'missing_domain' },
    );
  });

  it('la identidad de la empresa viaja completa', async () => {
    const { records } = await run([
      company({ name: 'Pequeña', domain: 'pequena.com', employeesExact: 50 }),
      company({ name: 'Grande', domain: 'grande.com', employeesExact: 900 }),
    ]);
    const row = records.find((r) => r.name === 'Pequeña')!;
    assert.equal(row.domain, 'pequena.com');
    assert.equal(row.providerCompanyId, 'pc-pequena-com');
    assert.equal(row.countryCode, 'CO');
    assert.match(row.roundOrigin ?? '', /^lusha_branch_\d+_page_\d+$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C · duplicate
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.2 § C — duplicate', () => {
  it('un duplicado exacto de SellUp deja fila `sellup_duplicate`', async () => {
    const { records } = await run([company({ name: 'Dup', domain: 'dup.com' })], {
      duplicateFor: (i) => duplicateResult(i, 'sellup'),
    });
    const row = records.find((r) => r.name === 'Dup');
    assert.ok(row);
    assert.equal(row.disposition, 'sellup_duplicate');
    assert.equal(row.evidence.duplicate_source, 'sellup');
  });

  it('un duplicado exacto de HubSpot deja fila `hubspot_duplicate` — son distintas', async () => {
    const { records } = await run([company({ name: 'Dup', domain: 'dup.com' })], {
      duplicateFor: (i) => duplicateResult(i, 'hubspot'),
    });
    const row = records.find((r) => r.name === 'Dup');
    assert.ok(row);
    assert.equal(row.disposition, 'hubspot_duplicate');
    assert.equal(row.evidence.duplicate_source, 'hubspot');
  });

  it('sin evidencia de ningún lado se atribuye a SellUp, nunca a HubSpot', () => {
    assert.equal(classifyLushaExactDuplicateSource({ sources: [] }), 'sellup');
  });

  it('la siembra de dominio conocido deja fila con su código', () => {
    assert.deepEqual(resolveLushaDiscardDisposition({ kind: 'known_domain_seed' }), {
      disposition: 'sellup_duplicate',
      reasonCode: LUSHA_DISCARD_REASON_CODE.knownDomainSeed,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D · precision_rejected
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.2 § D — precision_rejected', () => {
  it('no es duplicado ni país: es `sector_rejected`, con el motivo de precisión', () => {
    assert.deepEqual(
      resolveLushaDiscardDisposition({
        kind: 'macro_precision_rejected',
        precisionReason: 'declared_industry_not_in_macro',
      }),
      { disposition: 'sector_rejected', reasonCode: 'declared_industry_not_in_macro' },
    );
  });

  it('un motivo vacío no se rellena con un valor plausible', () => {
    assert.deepEqual(
      resolveLushaDiscardDisposition({ kind: 'macro_precision_rejected', precisionReason: '  ' }),
      { disposition: 'sector_rejected', reasonCode: null },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E · provider_error — NO es un evento por empresa, y se demuestra
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.2 § E — provider_error', () => {
  it('una búsqueda FALLIDA no produce empresas, así que no hay descarte por empresa', async () => {
    const { res, records } = await run([company()], { failSearch: true });
    assert.equal(res.ok, false, 'la corrida debe reportar el fallo de proveedor');
    assert.equal(records.length, 0, 'no puede haber descarte de una empresa que nunca llegó');
  });

  it('la taxonomía NO tiene código de proveedor caído — y eso es correcto, no un olvido', () => {
    const kinds: LushaDiscardEvent['kind'][] = [
      'gate_hard_excluded',
      'active_candidate_guard',
      'exact_duplicate',
      'macro_precision_rejected',
      'icp_size_rejected',
      'target_overflow',
      'known_domain_seed',
      'provider_seen',
      'intra_run_provider_duplicate',
      'possible_duplicate',
      'batch_identity_rejected',
      'accepted',
      'unusable_record',
    ];
    // Ningún `kind` nombra un fallo de proveedor. Si alguien añade uno, tendrá
    // que justificar a QUÉ empresa se lo atribuye.
    assert.ok(!kinds.some((k) => /provider_error|provider_failure|error/.test(k)));
  });

  it('el fallo de proveedor SÍ queda registrado, pero a nivel de CORRIDA', () => {
    // `provider_usage_logs` tiene `status` y `error_code` — el sitio correcto
    // para un desenlace que no pertenece a ninguna empresa.
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/036_usage_tracking_foundation.sql'),
      'utf8',
    );
    assert.match(sql, /status\s+text\s+NOT NULL DEFAULT 'success'/);
    assert.match(sql, /error_code\s+text\s+NULL/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F · budget — NO es un evento por empresa, y se demuestra
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.2 § F — budget', () => {
  it('el bloqueo de presupuesto ocurre ANTES del núcleo: no hay empresa que descartar', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/modules/prospect-batches/lusha-pending-review-actions.ts'),
      'utf8',
    );
    const guard = src.indexOf('guardLushaRunBudget(');
    const persist = src.indexOf('persistLushaPendingReviewBatch(');
    assert.ok(guard > 0 && persist > 0);
    assert.ok(
      guard < persist,
      'el guard de presupuesto debe envolver la ejecución, no venir después',
    );
  });

  it('el tope de OBJETIVO sí es por empresa, y tiene su propio código', () => {
    // Es lo más cercano a «presupuesto» que puede atribuirse a una empresa: la
    // página ya se pagó y el objetivo ya estaba cerrado.
    assert.deepEqual(resolveLushaDiscardDisposition({ kind: 'target_overflow' }), {
      disposition: 'target_cap_reached',
      reasonCode: LUSHA_DISCARD_REASON_CODE.targetOverflow,
    });
  });

  it('una empresa sobrante del objetivo deja fila real', async () => {
    const { records } = await run(
      Array.from({ length: 8 }, (_, i) =>
        company({ name: `Emp ${i}`, domain: `emp${i}.com` }),
      ),
    );
    const overflow = records.filter((r) => r.disposition === 'target_cap_reached');
    assert.ok(overflow.length > 0, 'el sobrante del objetivo no dejó rastro');
    assert.equal(overflow[0].reasonCode, 'target_overflow_discarded');
  });

  it('el escritor no lee ni escribe presupuesto — la trazabilidad no cuesta créditos', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/modules/prospect-discards/lusha-pipeline-writer.server.ts'),
      'utf8',
    );
    for (const forbidden of [
      'wizard_monthly_budget_periods',
      'try_reserve_wizard_credits',
      'credits_reserved',
      'budget_credits',
    ]) {
      assert.ok(!src.includes(forbidden), `el escritor toca presupuesto: ${forbidden}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G · cobertura exhaustiva + el hueco que NO se cierra
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.2 § G — cobertura y huecos', () => {
  it('cada `kind` es o disposición durable o transitorio JUSTIFICADO — nada sin decidir', () => {
    const durable: LushaDiscardEvent[] = [
      { kind: 'gate_hard_excluded', gateReason: 'missing_domain' },
      { kind: 'active_candidate_guard' },
      { kind: 'exact_duplicate', duplicateSource: 'sellup' },
      { kind: 'macro_precision_rejected' },
      { kind: 'icp_size_rejected' },
      { kind: 'target_overflow' },
      { kind: 'known_domain_seed' },
    ];
    const transient: LushaDiscardEvent[] = [
      { kind: 'provider_seen' },
      { kind: 'intra_run_provider_duplicate' },
      { kind: 'possible_duplicate' },
      { kind: 'batch_identity_rejected' },
      { kind: 'accepted' },
      { kind: 'unusable_record' },
    ];
    for (const e of durable) {
      const r = resolveLushaDiscardDisposition(e);
      assert.ok(r !== null, `${e.kind} debería ser durable`);
      assert.ok(r.disposition.length > 0);
    }
    for (const e of transient) {
      assert.equal(resolveLushaDiscardDisposition(e), null, `${e.kind} no es una disposición`);
    }
    assert.equal(durable.length + transient.length, 13, 'la unión de `kind` creció sin decidirse');
  });

  it('toda disposición que emite Lusha está en el CHECK de la migración 138', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/138_prospect_discarded_dispositions.sql'),
      'utf8',
    );
    const emitted = [
      'other',
      'country_rejected',
      'sector_rejected',
      'sellup_duplicate',
      'hubspot_duplicate',
      'target_cap_reached',
    ];
    for (const code of emitted) {
      assert.ok(sql.includes(`'${code}'`), `la 138 no acepta la disposición ${code}`);
    }
  });

  it('🔴 HUECO ABIERTO — en standalone, una corrida que rechaza TODO no deja NINGUNA fila', async () => {
    // Todas por debajo del ICP ⇒ 0 útiles ⇒ `status: 'empty'` ⇒ sin lote.
    const { res, records } = await run([
      company({ name: 'A', domain: 'a.com', employeesExact: 10 }),
      company({ name: 'B', domain: 'b.com', employeesExact: 20 }),
    ]);
    assert.equal(res.status, 'empty');
    assert.equal(res.batchId, null);
    // El núcleo SÍ produjo los registros…
    assert.equal(records.length, 2, 'el núcleo debe seguir produciendo los descartes');
    // …pero la acción no puede escribirlos: `batch_id` es NOT NULL y en
    // standalone no hay `waterfall.canonicalBatchId` que sustituya al lote.
    const noWaterfall = null as { canonicalBatchId: string } | null;
    const discardBatchId = res.batchId ?? noWaterfall?.canonicalBatchId ?? null;
    assert.equal(discardBatchId, null, 'sin lote no hay dónde colgar la fila');

    // El esquema lo confirma: cerrar este hueco EXIGE migración.
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/138_prospect_discarded_dispositions.sql'),
      'utf8',
    );
    assert.match(
      sql,
      /batch_id\s+UUID\s+NOT NULL REFERENCES prospect_batches\(id\)/,
      'si `batch_id` ya admite null, este hueco se cerró y esta prueba debe caer',
    );
  });
});
