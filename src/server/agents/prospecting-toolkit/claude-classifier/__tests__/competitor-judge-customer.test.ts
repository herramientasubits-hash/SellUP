/**
 * Agente 1 · «Competidores» — juez más estricto tras la QA en Prod del 21-10
 * (VECOL × Colombia, lote 5128e0d0): de la bolsa libre de HubSpot entraron Pfizer
 * y Novo Nordisk como competidoras de un laboratorio VETERINARIO, las dos con el
 * motivo «Vacunas y productos biológicos farmacéuticos».
 *
 *   A — El mensaje lleva las palabras clave de la ficha y la regla del cliente final.
 *   B — Sólo entra lo que Claude marca como del MISMO cliente final.
 *   C — HubSpot y Apollo piden más prueba; en HubSpot un motivo repetido es plantilla.
 *   D — El sellado vuelve a dejar «Competidores de X · país · industria».
 *
 * Puro: la conversación se inyecta. LIVE_ANTHROPIC_CALLS = 0.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompetitorJudgeRequestBody,
  judgeCompetitors,
  readCompetitorJudgeVerdicts,
  SUBMIT_COMPETITOR_SELECTION_TOOL_NAME,
  withoutRepeatedReasons,
  type CompetitorJudgeInput,
  type CompetitorJudgeItem,
} from '../competitor-judge';
import type { AnthropicConversationResult, AnthropicRequestBody } from '../anthropic-messages-client';
import { MACRO_INDUSTRY_CATALOG_VERSION } from '@/modules/macro-industry-catalog/macro-industries';
import {
  buildCompetitorSealName,
  executeCompetitorSearchRun,
  type CompetitorRunDeps,
  type CompetitorRunInput,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-competitor-run';

const VECOL = {
  name: 'VECOL S.A.',
  domain: 'vecol.com.co',
  description: 'Fabrica y comercializa vacunas veterinarias, productos biológicos y agroquímicos para ganadería.',
  keywords: ['veterinary vaccines', 'livestock biologics', 'animal health products'],
};

const HUBSPOT_ITEMS: CompetitorJudgeItem[] = [
  { key: 'b1', name: 'Pfizer', activity: 'Prescription medicines and vaccines', activityCode: null, domain: 'pfizer.com' },
  { key: 'b2', name: 'Novo Nordisk', activity: 'Diabetes care and biopharmaceuticals', activityCode: null, domain: 'novonordisk.com' },
  { key: 'b3', name: 'Grupo Amarey', activity: 'Distribución de productos biotecnológicos', activityCode: null, domain: 'grupoamarey.com' },
];

function input(listSource?: CompetitorJudgeInput['listSource'], items = HUBSPOT_ITEMS): CompetitorJudgeInput {
  return { reference: VECOL, countryName: 'Colombia', industryName: 'Salud & Farmacéuticos', items, ...(listSource ? { listSource } : {}) };
}

function message(body: AnthropicRequestBody): string {
  return String((body.messages[0] as { content: string }).content);
}

function reply(competitors: Array<Record<string, unknown>>): AnthropicConversationResult['content'] {
  return [{ type: 'tool_use', name: SUBMIT_COMPETITOR_SELECTION_TOOL_NAME, input: { competitors } }] as AnthropicConversationResult['content'];
}

describe('A — lo que ve el juez', () => {
  it('A1: el mensaje lleva las palabras clave de la ficha', () => {
    const body = buildCompetitorJudgeRequestBody(input(), 'm');
    assert.match(message(body), /Lo que vende la referencia \(palabras clave\): veterinary vaccines, livestock biologics, animal health products/);
  });

  it('A2: sin palabras clave (fichas viejas) no aparece la línea', () => {
    const body = buildCompetitorJudgeRequestBody({ ...input(), reference: { ...VECOL, keywords: undefined } }, 'm');
    assert.doesNotMatch(message(body), /palabras clave/);
  });

  it('A3: la regla del mismo cliente final está en el sistema y el esquema la exige', () => {
    const body = buildCompetitorJudgeRequestBody(input(), 'm');
    assert.match(String(body.system), /MISMO CLIENTE FINAL/);
    const schema = JSON.stringify(body.tools);
    assert.match(schema, /"same_customer"/);
    assert.match(schema, /"required":\["key","shared_offering","customer","same_customer","confidence"\]/);
  });

  it('A4: HubSpot y Apollo piden más prueba; el registro oficial y el banco no cambian', () => {
    assert.match(message(buildCompetitorJudgeRequestBody(input('hubspot_free_pool'), 'm')), /Esta lista viene de HubSpot/);
    assert.match(message(buildCompetitorJudgeRequestBody(input('apollo'), 'm')), /Esta lista viene de Apollo/);
    assert.doesNotMatch(message(buildCompetitorJudgeRequestBody(input('free_layer'), 'm')), /Esta lista viene/);
    assert.doesNotMatch(message(buildCompetitorJudgeRequestBody(input(), 'm')), /Esta lista viene/);
  });
});

describe('B — mismo cliente final', () => {
  it('B1: sólo entra la que Claude marca «yes»; «no», «unclear» o sin campo quedan fuera', () => {
    const verdicts = readCompetitorJudgeVerdicts(
      reply([
        { key: 'b1', shared_offering: 'Vacunas', customer: 'hospitales y pacientes', same_customer: 'no', confidence: 'high' },
        { key: 'b2', shared_offering: 'Biológicos', customer: '¿?', same_customer: 'unclear', confidence: 'high' },
        { key: 'b3', shared_offering: 'Biotecnológicos', confidence: 'high' },
      ]),
      HUBSPOT_ITEMS,
    );
    assert.deepEqual(verdicts, []);
  });
});

describe('C — HubSpot: un motivo repetido es una plantilla', () => {
  // Lo que pasó en Prod: Claude dijo «yes» a todo y repitió el motivo en Pfizer y Novo.
  const prodLike = reply([
    { key: 'b1', shared_offering: 'Vacunas y productos biológicos farmacéuticos', customer: 'salud', same_customer: 'yes', confidence: 'high' },
    { key: 'b2', shared_offering: 'Vacunas y productos biológicos farmacéuticos', customer: 'salud', same_customer: 'yes', confidence: 'high' },
    { key: 'b3', shared_offering: 'Distribución de productos biotecnológicos', customer: 'salud', same_customer: 'yes', confidence: 'high' },
  ]);

  it('C1: en la bolsa de HubSpot se caen las dos con el mismo motivo', () => {
    assert.deepEqual(
      readCompetitorJudgeVerdicts(prodLike, HUBSPOT_ITEMS, 'hubspot_free_pool').map((v) => v.key),
      ['b3'],
    );
  });

  it('C2: en el registro oficial el motivo repetido es normal (Alura y Kyrovet) y se queda', () => {
    const official: CompetitorJudgeItem[] = [
      { key: 'e1', name: 'ALURA ANIMAL HEALTH', activity: 'Fabricación de productos farmacéuticos', activityCode: '2100' },
      { key: 'e2', name: 'KYROVET LABORATORIES', activity: 'Fabricación de productos farmacéuticos', activityCode: '2100' },
    ];
    const content = reply([
      { key: 'e1', shared_offering: 'Productos farmacéuticos y biológicos para salud animal', customer: 'ganaderos', same_customer: 'yes', confidence: 'high' },
      { key: 'e2', shared_offering: 'Productos farmacéuticos y biológicos para salud animal', customer: 'ganaderos', same_customer: 'yes', confidence: 'high' },
    ]);
    assert.deepEqual(readCompetitorJudgeVerdicts(content, official, 'free_layer').map((v) => v.key), ['e1', 'e2']);
  });

  it('C3: la comparación del motivo ignora mayúsculas y espacios', () => {
    assert.deepEqual(
      withoutRepeatedReasons([
        { key: 'a', reason: 'Vacunas  y biológicos' },
        { key: 'b', reason: 'vacunas y biológicos' },
        { key: 'c', reason: 'Otra cosa' },
      ]).map((v) => v.key),
      ['c'],
    );
  });

  it('C4: el lote pasa su fuente hasta la lectura (judgeCompetitors)', async () => {
    const outcome = await judgeCompetitors(input('hubspot_free_pool'), 'm', {
      runConversation: async () => ({
        content: prodLike,
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, webFetchRequests: 0 },
        requests: 1,
      }),
    });
    assert.deepEqual(outcome.competitors.map((v) => v.key), ['b3']);
  });
});

describe('D — el nombre del lote al cerrar', () => {
  const RUN: CompetitorRunInput = {
    userId: 'u1',
    clientRequestId: '11111111-0000-4000-8000-000000000002',
    countryCode: 'CO',
    countryName: 'Colombia',
    additionalCriteria: null,
    reference: { ...VECOL, accountId: null },
    catalogResolution: {
      country: { code: 'CO', name: 'Colombia' },
      catalog: { version: MACRO_INDUSTRY_CATALOG_VERSION },
      industry: { id: 'aaaaaaaa-0000-4000-8000-000000000009', slug: 'salud', name: 'Salud & Farmacéuticos' },
      subindustries: [],
    } as unknown as CompetitorRunInput['catalogResolution'],
    target: 5,
  };

  it('D1: el nombre es «Competidores de X · país · industria»', () => {
    assert.equal(buildCompetitorSealName(RUN), 'Competidores de VECOL S.A. · Colombia · Salud & Farmacéuticos');
  });

  it('D2: sólo con lo gratuito (sin web), el sellado lleva el nombre', async () => {
    const seals: Array<{ name?: string }> = [];
    const deps: CompetitorRunDeps = {
      reserveSlot: async () => ({ status: 'reserved', batchId: 'b1' }),
      checkPersistenceReadiness: async () => ({ status: 'available' }),
      resolveClaudeSearchLeg: () => true,
      runClaudeCompanySearchLeg: async () => ({ executed: false, reason: 'not_run' }),
      runCompetitorFreeSources: async () => ({ persistedCount: 5, acceptedCount: 5, telemetry: {} }),
      countCompetitorBatchOutcome: async () => ({ reviewable: 5, hubspotDuplicates: 0, sellupDuplicates: 0 }),
      sealFreeOnlyBatchStatus: async (seal) => {
        seals.push(seal);
      },
      markBatchFailed: async () => undefined,
      actionStartedAtMs: 1_000,
      nowMs: () => 6_000,
    };
    const result = await executeCompetitorSearchRun(RUN, deps);
    assert.equal(result.ok, true);
    assert.equal(seals.length, 1);
    assert.equal(seals[0].name, 'Competidores de VECOL S.A. · Colombia · Salud & Farmacéuticos');
  });
});
