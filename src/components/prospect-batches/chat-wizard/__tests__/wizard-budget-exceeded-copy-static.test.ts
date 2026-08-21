/**
 * Pruebas de la cadena de copy de `BUDGET_EXCEEDED` — AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1.
 *
 * Antes de este hito, «El presupuesto disponible para generación de prospectos
 * se agotó.» se mostraba SIEMPRE que la reserva atómica bloqueaba por
 * presupuesto — incluso con presupuesto > 0 pero insuficiente para el tamaño de
 * la corrida (el caso real de producción: available=5, required=25). «Se agotó»
 * es falso ahí: sugiere esperar al siguiente período cuando lo que bloquea es
 * el tamaño de ESTA corrida.
 *
 * Estas pruebas sostienen, igual que wizard-persistence-copy-static.test.ts para
 * PERSISTENCE_NOT_READY:
 *   1. la acción del servidor sólo LEE el período (nunca escribe presupuesto) y
 *      proyecta `budgetExceeded` estructurado hacia el cliente;
 *   2. el wizard cliente resuelve BUDGET_EXCEEDED por su vía estructurada, no
 *      por el mapa estático a secas;
 *   3. el gate de «Generar prospectos» y el selector de proveedor conocen el
 *      bloqueo de presupuesto, exactamente como ya conocen el de persistencia;
 *   4. `mapBudgetExceeded` (pura, sin DOM) elige el copy correcto por `reason` y
 *      cae al genérico cuando no hay detalle confiable.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapBudgetExceeded,
  mapExecutionError,
  BUDGET_EXHAUSTED_MESSAGE,
  BUDGET_INSUFFICIENT_FOR_RUN_MESSAGE,
} from '../wizard-execution-error-map';

const ROOT = process.cwd();

const FILES = {
  action: join(
    ROOT,
    'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts',
  ),
  wizard: join(ROOT, 'src/components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx'),
  summary: join(
    ROOT,
    'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx',
  ),
  reservations: join(
    ROOT,
    'src/modules/prospect-batches/chat-wizard-execution/wizard-budget-reservations.ts',
  ),
  types: join(
    ROOT,
    'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-types.ts',
  ),
};

const src = Object.fromEntries(
  Object.entries(FILES).map(([key, path]) => [key, readFileSync(path, 'utf8')]),
) as Record<keyof typeof FILES, string>;

describe('la lectura de diagnóstico es de sólo lectura', () => {
  it('el lector del período no escribe (no insert/update/upsert)', () => {
    assert.match(src.reservations, /readWizardBudgetPeriodSnapshot/);
    const start = src.reservations.indexOf('export async function readWizardBudgetPeriodSnapshot');
    assert.ok(start >= 0);
    const body = src.reservations.slice(start);
    assert.doesNotMatch(body, /\.insert\(/);
    assert.doesNotMatch(body, /\.update\(/);
    assert.doesNotMatch(body, /\.upsert\(/);
    assert.doesNotMatch(body, /\.delete\(/);
  });

  it('deriva `availableCredits` con la MISMA fórmula que la RPC (064: budget - consumed - reserved)', () => {
    assert.match(
      src.reservations,
      /availableCredits:\s*data\.budget_credits\s*-\s*data\.credits_consumed\s*-\s*data\.credits_reserved/,
    );
  });
});

describe('la acción proyecta budgetExceeded sólo desde lo que la RPC ya decidió', () => {
  it('lee el período únicamente cuando la RPC bloqueó por BUDGET_EXCEEDED', () => {
    assert.match(
      src.action,
      /rpcResult\.code === 'BUDGET_EXCEEDED'\s*\?\s*await readWizardBudgetPeriodSnapshot/,
    );
  });

  it('requiredCredits es el MISMO número ya reservado, nunca una estimación distinta', () => {
    const start = src.action.indexOf("if (budgetResult.status === 'blocked') {");
    const end = src.action.indexOf('const { reservationId, creditsReserved }');
    const block = src.action.slice(start, end);
    assert.ok(block.length > 0);
    assert.match(block, /requiredCredits:\s*requestedCredits/);
  });

  it('reason distingue exhausted (<=0) de insufficient_for_run (>0)', () => {
    assert.match(
      src.action,
      /budgetResult\.budgetSnapshot\.availableCredits\s*<=\s*0\s*\n?\s*\?\s*'exhausted'\s*\n?\s*:\s*'insufficient_for_run'/,
    );
  });

  it('el resultado de fallo declara budgetExceeded en su tipo', () => {
    assert.match(src.types, /budgetExceeded\?:\s*\{/);
    assert.match(src.types, /reason:\s*'exhausted'\s*\|\s*'insufficient_for_run'/);
  });
});

describe('el wizard cliente resuelve BUDGET_EXCEEDED por su vía estructurada', () => {
  it('no manda el código al mapa estático a secas', () => {
    assert.match(src.wizard, /result\.code === 'BUDGET_EXCEEDED'/);
    assert.match(src.wizard, /mapBudgetExceeded\(result\.budgetExceeded\)/);
  });
});

describe('el gate de generación conoce el bloqueo de presupuesto', () => {
  it('isBudgetBlocked existe y se deriva de executionError.code', () => {
    assert.match(src.summary, /isBudgetBlocked/);
    assert.match(src.summary, /executionError\?\.code === 'BUDGET_EXCEEDED'/);
  });

  it('el botón «Generar prospectos» y el selector de proveedor comparten ese gate', () => {
    assert.match(
      src.summary,
      /!isPersistenceBlocked &&\s*\n\s*!isBudgetBlocked && \(\s*<Button/,
      'el botón «Generar prospectos» debe estar gateado por !isBudgetBlocked',
    );
    assert.match(
      src.summary,
      /!isPersistenceBlocked &&\s*\n\s*!isBudgetBlocked &&\s*\n\s*onRequestedProviderChange !== undefined/,
      'el selector de proveedor debe estar gateado por !isBudgetBlocked',
    );
  });

  it('el nuevo gate NO rompe la conjunción que fija el gate de generación (prospect-wizard-route-static.test.ts)', () => {
    assert.match(
      src.summary,
      /!useLushaFinalSearch &&\s*discoveryAvailability\.available &&\s*executionEnabled &&\s*!isPersistenceBlocked/,
    );
  });
});

describe('mapBudgetExceeded — copy puro (sin DOM)', () => {
  it('sin detalle cae al mensaje genérico de siempre (agotó)', () => {
    const result = mapBudgetExceeded(undefined);
    assert.deepEqual(result, mapExecutionError('BUDGET_EXCEEDED'));
    assert.match(result.message, /se agotó/);
  });

  it('reason=exhausted usa el copy de «se agotó» + los números', () => {
    const result = mapBudgetExceeded({
      reason: 'exhausted',
      availableCredits: 0,
      requiredCredits: 25,
    });
    assert.match(result.message, new RegExp(BUDGET_EXHAUSTED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(result.message, /Disponibles: 0 créditos/);
    assert.match(result.message, /Requeridos: 25 créditos/);
    assert.equal(result.retryable, false);
  });

  it('reason=insufficient_for_run NUNCA dice «se agotó» y muestra ambos números', () => {
    // El caso real de producción: available=5, required=25.
    const result = mapBudgetExceeded({
      reason: 'insufficient_for_run',
      availableCredits: 5,
      requiredCredits: 25,
    });
    assert.doesNotMatch(result.message, /se agotó/);
    assert.match(
      result.message,
      new RegExp(BUDGET_INSUFFICIENT_FOR_RUN_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    assert.match(result.message, /Disponibles: 5 créditos/);
    assert.match(result.message, /Requeridos: 25 créditos/);
    assert.equal(result.retryable, false);
  });

  it('singular correcto para 1 crédito disponible o requerido', () => {
    const result = mapBudgetExceeded({
      reason: 'insufficient_for_run',
      availableCredits: 1,
      requiredCredits: 1,
    });
    assert.match(result.message, /Disponibles: 1 crédito\b/);
    assert.match(result.message, /Requeridos: 1 crédito\b/);
  });
});
