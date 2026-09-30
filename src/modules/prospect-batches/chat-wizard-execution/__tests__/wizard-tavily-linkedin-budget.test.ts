/**
 * AGENT1-TAVILY-V2-1 § 3 — el gasto de LinkedIn de una corrida Tavily entra
 * en la reserva y en la liquidación del presupuesto mensual del asistente.
 *
 * Autorizado por la dueña el 2026-09-29 («sí» a corregir la cuenta del
 * presupuesto de Tavily). No toca la base ni los valores del presupuesto: sólo
 * hace que lo que ya se gastaba de verdad se reserve y se confirme.
 *
 * Datos de Producción que fijan los números: `wizard_pilot_settings.
 * max_credits_per_execution = 25`, así que 20 (descubrimiento) + 5 (LinkedIn)
 * cabe sin bloquear ninguna corrida.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WIZARD_TAVILY_LINKEDIN_MAX_CREDITS,
  estimateWizardAdaptiveMaxCredits,
  estimateWizardTavilyRunMaxCredits,
  readWizardConsumedCreditsFromDb,
  type ConsumedCreditsDbClient,
} from '../wizard-budget-reconciliation';
import { estimateCreditsForProvider } from '../wizard-budget-estimate';
import { TAVILY_RECONCILED_OPERATIONS, reconcileWizardRunSpend } from '../wizard-run-reconciliation';
import { LINKEDIN_SEARCH_STRICT_CONFIG } from '@/server/agents/prospecting-toolkit/incremental-search';

const PROD_MAX_CREDITS_PER_EXECUTION = 25;

async function withLinkedInFlag<T>(value: string | undefined, fn: () => T | Promise<T>): Promise<T> {
  const saved = process.env.ENABLE_LINKEDIN_COMPANY_SEARCH;
  if (value === undefined) delete process.env.ENABLE_LINKEDIN_COMPANY_SEARCH;
  else process.env.ENABLE_LINKEDIN_COMPANY_SEARCH = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.ENABLE_LINKEDIN_COMPANY_SEARCH;
    else process.env.ENABLE_LINKEDIN_COMPANY_SEARCH = saved;
  }
}

describe('estimación de una corrida Tavily', () => {
  it('el tope de LinkedIn coincide con la config real (5 candidatos × 1 búsqueda)', () => {
    assert.equal(
      WIZARD_TAVILY_LINKEDIN_MAX_CREDITS,
      LINKEDIN_SEARCH_STRICT_CONFIG.maxPerBatch * (LINKEDIN_SEARCH_STRICT_CONFIG.maxQueriesPerCandidate ?? 1),
    );
  });

  it('con LinkedIn apagado reserva lo de siempre (20)', async () => {
    await withLinkedInFlag(undefined, () => {
      assert.equal(estimateCreditsForProvider('tavily'), estimateWizardAdaptiveMaxCredits());
      assert.equal(estimateCreditsForProvider('tavily'), 20);
    });
  });

  it('con LinkedIn encendido reserva 25 = descubrimiento + LinkedIn', async () => {
    await withLinkedInFlag('true', () => {
      assert.equal(estimateCreditsForProvider('tavily'), 25);
    });
  });

  it('cabe en el tope por corrida de Producción (25): no bloquea ninguna corrida', () => {
    assert.ok(estimateWizardTavilyRunMaxCredits({ linkedInSearchEnabled: true }) <= PROD_MAX_CREDITS_PER_EXECUTION);
  });
});

describe('liquidación: las filas de LinkedIn cuentan', () => {
  const correlation = {
    wizardRunId: 'run-1',
    clientRequestId: 'req-1',
    batchId: 'batch-1',
    reservationId: 'res-1',
    agentRunId: null,
    providerKey: 'tavily',
    requestFingerprint: 'fp',
    idempotencyKey: 'idem',
  };

  it('LinkedIn es una operación reconciliada de Tavily', () => {
    assert.ok((TAVILY_RECONCILED_OPERATIONS as readonly string[]).includes('linkedin_company_search'));
  });

  it('16 de búsqueda + 3 de LinkedIn del mismo lote ⇒ 19, sin anomalía de operación', () => {
    const result = reconcileWizardRunSpend({
      batchId: 'batch-1',
      correlation,
      discoveryProvider: 'tavily',
      estimatedCredits: 25,
      reservedCredits: 25,
      rows: [
        { provider_key: 'tavily', operation_key: 'multi_query_web_search', credits_used: 16, usage_key: 'a', batch_id: 'batch-1' },
        { provider_key: 'tavily', operation_key: 'linkedin_company_search', credits_used: 1, usage_key: 'b', batch_id: 'batch-1' },
        { provider_key: 'tavily', operation_key: 'linkedin_company_search', credits_used: 1, usage_key: 'c', batch_id: 'batch-1' },
        { provider_key: 'tavily', operation_key: 'linkedin_company_search', credits_used: 1, usage_key: 'd', batch_id: 'batch-1' },
      ],
    } as Parameters<typeof reconcileWizardRunSpend>[0]);
    assert.equal(result.creditsToConfirm, 19);
    assert.ok(!result.anomalies.includes('unexpected_operation_for_provider'));
  });
});

describe('lector de respaldo (sin reconcileRunSpend)', () => {
  function fakeDb(rowsByOperation: Record<string, Array<{ credits_used: number | null }> | 'error'>): ConsumedCreditsDbClient {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: async (_col: string, op: string) => {
                const rows = rowsByOperation[op];
                if (rows === 'error') return { data: null, error: { message: 'boom' } };
                return { data: rows ?? [], error: null };
              },
            }),
          }),
        }),
      }),
    } as unknown as ConsumedCreditsDbClient;
  }

  it('suma búsqueda + LinkedIn', async () => {
    const total = await readWizardConsumedCreditsFromDb('b', fakeDb({
      multi_query_web_search: [{ credits_used: 4 }, { credits_used: 4 }],
      linkedin_company_search: [{ credits_used: 1 }],
    }));
    assert.equal(total, 9);
  });

  it('sin filas de LinkedIn suma sólo la búsqueda', async () => {
    const total = await readWizardConsumedCreditsFromDb('b', fakeDb({ multi_query_web_search: [{ credits_used: 4 }] }));
    assert.equal(total, 4);
  });

  it('si la lectura de LinkedIn falla, no inventa un total (null ⇒ se confirma lo reservado)', async () => {
    const total = await readWizardConsumedCreditsFromDb('b', fakeDb({
      multi_query_web_search: [{ credits_used: 4 }],
      linkedin_company_search: 'error',
    }));
    assert.equal(total, null);
  });
});
