/**
 * AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-2 REVIEW-1 § 5 —
 * AUTORIDAD DEL OBJETIVO GLOBAL, DE PUNTA A PUNTA.
 *
 * La pregunta que contesta esta suite: ¿QUIÉN establece el objetivo del lote?
 *
 * Antes de REVIEW-1 la respuesta era «el primer contribuyente que adopte». En
 * el mundo mixto eso miente: con 10 pedidos, 7 cerrados gratis y 3 de residual
 * de pago, el contribuyente de pago llega con `requested = 3` y sería ÉL quien
 * fijara el objetivo global. Un lote completo pasaría a anunciar que se pidieron
 * tres empresas.
 *
 * La respuesta correcta —y lo que se fija aquí— es: LA RESERVA DURABLE, antes de
 * que exista contribuyente alguno.
 *
 * Recorrido real, sin mocks de la política:
 *
 *   1. `reserveWizardExecutionSlot` (la reserva de verdad, con un cliente falso)
 *      ⇒ el INSERT del slot lleva `target_count = 10`.
 *   2. Esa MISMA fila se le entrega al escritor REAL como lote existente.
 *   3. El contribuyente de pago llega con residual 3.
 *   4. El PATCH adoptado NO lleva `target_count`, y la verdad final sigue 10.
 *
 * El aporte gratuito de 7 se contabiliza CONCEPTUALMENTE: CUT-5 (partición
 * gratis/pago y movimiento del slot) está explícitamente fuera de alcance.
 *
 * Offline y determinista: sin Supabase, sin red, sin credenciales, 0 créditos,
 * 0 migraciones, 0 proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  reserveWizardExecutionSlot,
  type IdempotencyDbClient,
  type WizardExecutionReservationInput,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-idempotency';
import { WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES } from '@/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor';
import { WIZARD_TARGET_PERSISTIBLE_CANDIDATES } from '@/modules/prospect-batches/chat-wizard-execution/wizard-tavily-executor';
import { WIZARD_SYSTEM_CONTROLS } from '@/modules/prospect-batches/chat-wizard-execution/wizard-pipeline-adapter';
import { resolveAdoptedBatchPatch } from '../adopted-batch-truth';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

const USER = 'aaaaaaaa-0000-0000-0000-000000000001';
const REQ = '11111111-0000-0000-0000-000000000001';
const SLOT_ID = 'batch-0001-0000-0000-0000-000000000001';

/** Objetivo PERSISTIBLE que el producto promete. */
const GLOBAL_PERSISTIBLE_TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;

// ─── Cliente falso que captura el INSERT del slot ────────────────────────────

function makeCapturingDb(captured: Record<string, unknown>[]): IdempotencyDbClient {
  return {
    from(_table: string) {
      return {
        insert(row: Record<string, unknown>) {
          captured.push({ ...row });
          return {
            select(_cols: string) {
              return {
                single: async () => ({ data: { id: SLOT_ID }, error: null }),
              };
            },
          };
        },
        select(_cols: string) {
          return {
            eq(_c1: string, _v1: string) {
              return {
                eq(_c2: string, _v2: string) {
                  return { single: async () => ({ data: { id: SLOT_ID }, error: null }) };
                },
              };
            },
          };
        },
      };
    },
  };
}

function reservationInput(): WizardExecutionReservationInput {
  return {
    userId: USER,
    clientRequestId: REQ,
    initialBatchPayload: {
      requestSource: 'chat_wizard',
      catalogVersionId: 'v2.0.0',
      industryId: 'pharma-001',
      subindustryIds: ['sub-a'],
      countryCode: 'CO',
      additionalCriteria: null,
      targetCount: GLOBAL_PERSISTIBLE_TARGET,
      country: 'Colombia',
      industry: 'Salud y Farma',
      searchDepth: 'standard',
    },
  };
}

// ─── § 3 — el objetivo global nace con el slot ───────────────────────────────

describe('CUT-2 REVIEW-1 § 3 — la reserva establece el objetivo ANTES de contribuyentes', () => {
  it('el INSERT del slot lleva `target_count = 10`', async () => {
    const captured: Record<string, unknown>[] = [];
    const result = await reserveWizardExecutionSlot(reservationInput(), makeCapturingDb(captured));

    assert.equal(result.status, 'reserved');
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!['target_count'], 10);
    assert.equal(GLOBAL_PERSISTIBLE_TARGET, 10);
  });

  it('§ 4 — el slot nace también con país, ISO, industria y profundidad', async () => {
    const captured: Record<string, unknown>[] = [];
    await reserveWizardExecutionSlot(reservationInput(), makeCapturingDb(captured));

    const row = captured[0]!;
    assert.equal(row['country'], 'Colombia');
    assert.equal(row['country_code'], 'CO');
    assert.equal(row['industry'], 'Salud y Farma');
    assert.equal(row['search_depth'], 'standard');
    // Lo que ya hacía antes sigue igual.
    assert.equal(row['status'], 'draft');
    assert.equal(row['source'], 'agent_1');
    assert.equal(row['created_by'], USER);
    assert.equal(row['client_request_id'], REQ);
  });

  it('el slot NO nace con estado terminal ni con candidatos (CUT-1 intacto)', async () => {
    const captured: Record<string, unknown>[] = [];
    await reserveWizardExecutionSlot(reservationInput(), makeCapturingDb(captured));
    assert.equal(captured[0]!['status'], 'draft');
    assert.equal('completed_at' in captured[0]!, false);
  });
});

// ─── § 3 — 10 es el objetivo PERSISTIBLE, 25 es AMPLITUD ─────────────────────

describe('CUT-2 REVIEW-1 § 3 — objetivo persistible (10) ≠ amplitud de búsqueda (25)', () => {
  it('las dos rutas del wizard prometen el MISMO objetivo persistible', () => {
    assert.equal(WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES, 10);
    assert.equal(WIZARD_TARGET_PERSISTIBLE_CANDIDATES, 10);
    assert.equal(
      WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
      WIZARD_TARGET_PERSISTIBLE_CANDIDATES,
      'el slot se reserva antes de saber el proveedor: los dos tienen que coincidir',
    );
  });

  it('`systemControls.targetCount` es 25 y NO es lo que se persiste', () => {
    assert.equal(WIZARD_SYSTEM_CONTROLS.targetCount, 25);
    assert.notEqual(WIZARD_SYSTEM_CONTROLS.targetCount, GLOBAL_PERSISTIBLE_TARGET);
  });

  it('el CALL SITE de la reserva pasa el objetivo persistible, no la amplitud', () => {
    const src = read('src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts');
    const call = src.indexOf('reservation = await deps.reserveSlot({');
    assert.ok(call > 0, 'la llamada a la reserva tiene que existir');
    const end = src.indexOf('\n    });', call);
    assert.ok(end > call);
    const block = src.slice(call, end);

    assert.ok(
      /targetCount:\s*WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES\b/.test(block),
      'el slot tiene que recibir el objetivo PERSISTIBLE',
    );
    assert.equal(
      /targetCount:\s*WIZARD_SYSTEM_CONTROLS/.test(block),
      false,
      'la amplitud de búsqueda no puede publicarse como objetivo',
    );
    assert.equal(/targetCount:\s*25\b/.test(block), false, 'ni el 25 literal');
    assert.ok(/country:\s*countryName\b/.test(block));
    assert.ok(/industry:\s*catalogResolution\.industry\.name\b/.test(block));
    assert.ok(/searchDepth:\s*WIZARD_PIPELINE_DEFAULTS\.searchDepth\b/.test(block));
  });

  it('la RESERVA persiste el objetivo recibido y no inventa ninguno', () => {
    const src = read('src/modules/prospect-batches/chat-wizard-execution/wizard-idempotency.ts');
    assert.ok(/target_count:\s*initialBatchPayload\.targetCount/.test(src));
    assert.equal(/target_count:\s*\d/.test(src), false, 'nada de literales numéricos');
  });
});

// ─── § 5 — el contrato mixto de punta a punta ────────────────────────────────

describe('CUT-2 REVIEW-1 § 5 — 10 pedidos, 7 gratis, 3 de pago: el lote sigue pidiendo 10', () => {
  it('la reserva fija 10; el residual de pago 3 NO lo reescribe', async () => {
    // 1. Reserva REAL: el slot nace con el objetivo global.
    const captured: Record<string, unknown>[] = [];
    await reserveWizardExecutionSlot(reservationInput(), makeCapturingDb(captured));
    const slotRow = captured[0]!;
    assert.equal(slotRow['target_count'], 10);

    // 2. El aporte gratuito cierra 7 conceptualmente (CUT-5 fuera de alcance).
    const freeContribution = 7;
    const paidResidual = GLOBAL_PERSISTIBLE_TARGET - freeContribution;
    assert.equal(paidResidual, 3);

    // 3. El contribuyente de PAGO adopta esa misma fila con su residual.
    const adopted = resolveAdoptedBatchPatch({
      existingBatch: {
        name: slotRow['name'] as string,
        country: slotRow['country'] as string,
        country_code: slotRow['country_code'] as string,
        industry: slotRow['industry'] as string,
        target_count: slotRow['target_count'] as number,
        search_depth: slotRow['search_depth'] as string,
        metadata: slotRow['metadata'],
      },
      incoming: {
        name: 'Agente 1 · Pipeline · Colombia · Salud y Farma · 17 jun 2026',
        country: 'Colombia',
        country_code: 'CO',
        industry: 'healthcare',
        target_count: paidResidual,
        search_depth: 'standard',
        writerOwnedMetadata: { pipeline_summary: { requested: paidResidual } },
        passthroughMetadata: {},
      },
    });

    // 4. El PATCH no puede llevar el objetivo.
    assert.equal('target_count' in adopted.patch, false);
    assert.ok(adopted.preservedColumns.includes('target_count'));

    // 5. La verdad final del lote: sigue siendo 10.
    const finalRow = { ...slotRow, ...adopted.patch };
    assert.equal(finalRow['target_count'], 10);
    assert.equal(finalRow['country'], 'Colombia');
    assert.equal(finalRow['industry'], 'Salud y Farma');
    // Y la etiqueta humana sí se canonicaliza (§ 6).
    assert.equal(
      String(finalRow['name']).startsWith('Wizard: '),
      false,
      'el rótulo técnico de la reserva no puede quedar visible',
    );
  });

  it('la metadata del wizard que dejó la reserva sobrevive a la adopción', async () => {
    const captured: Record<string, unknown>[] = [];
    await reserveWizardExecutionSlot(reservationInput(), makeCapturingDb(captured));
    const slotRow = captured[0]!;

    const adopted = resolveAdoptedBatchPatch({
      existingBatch: { target_count: slotRow['target_count'] as number, metadata: slotRow['metadata'] },
      incoming: {
        name: 'Agente 1 · Pipeline · Colombia · Salud y Farma · 17 jun 2026',
        country: 'Colombia',
        country_code: 'CO',
        industry: 'healthcare',
        target_count: 3,
        search_depth: 'standard',
        writerOwnedMetadata: { generated_by: 'agent_1_candidate_writer' },
        passthroughMetadata: {},
      },
    });

    const meta = adopted.metadata;
    assert.equal(meta['request_source'], 'chat_wizard');
    assert.equal(meta['catalog_version_id'], 'v2.0.0');
    assert.equal(meta['industry_id'], 'pharma-001');
    assert.deepEqual(meta['subindustry_ids'], ['sub-a']);
    assert.equal(meta['generated_by'], 'agent_1_candidate_writer');
  });
});

// ─── § 15 — el slot NO se mueve, sólo se completa ────────────────────────────

describe('CUT-2 REVIEW-1 § 15 — el slot sigue donde estaba en el orden de ejecución', () => {
  it('la reserva sigue ocurriendo en el paso 9, después de la capa gratuita y del presupuesto', () => {
    const src = read('src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts');
    const freeLayer = src.indexOf('deps.runPrePaidNoveltyDiscovery');
    const reserveSlot = src.indexOf('reservation = await deps.reserveSlot({');
    assert.ok(freeLayer > 0 && reserveSlot > freeLayer, 'la capa gratuita sigue ANTES del slot');
    assert.ok(src.includes('// 9. Reserve durable execution slot (idempotency anchor).'));
  });

  it('la reserva sigue sin llamar a ningún proveedor ni tocar créditos', () => {
    // 🔴 Sobre el CÓDIGO. La clave de metadata `apollo_discovery_taxonomy` es un
    // NOMBRE DE CAMPO que la reserva ya persistía antes de este hito, no una
    // llamada a Apollo: un grep de «apollo» sería un falso positivo.
    const code = read('src/modules/prospect-batches/chat-wizard-execution/wizard-idempotency.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'fetch(',
      'reserveWizardPilotCredits',
      'credits_reserved',
      'provider_usage_logs',
      'runWizardApolloSearch',
      'runWizardTavilySearch',
      'runLusha',
    ]) {
      assert.equal(code.includes(forbidden), false, `${forbidden} no pertenece a la reserva del slot`);
    }
  });
});
