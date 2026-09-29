/**
 * AGENT1-CONTINUATION-PROVIDER-SEEN-REHYDRATE-1 — la memoria provider-seen
 * sobrevive a la cola de continuaciones.
 *
 * El defecto, medido en Producción el 2026-09-29 (México × Tecnología, lote
 * `754e169e`): el `run_input` viaja como JSON, JSON convierte `Set`/`Map` en
 * `{}`, y al reanudar `isProviderSeenKnown` lanzaba
 * `a.providerEntityIds.has is not a function`. Toda corrida que se pausaba por
 * tiempo terminaba ahí.
 *
 *   § 1 · el defecto, reproducido con la forma EXACTA que quedó en la base;
 *   § 2 · restaurar el `run_input` deja una memoria que funciona;
 *   § 3 · encolar ya NO pierde los datos;
 *   § 4 · lo ilegible degrada a vacío, nunca lanza.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isProviderSeenKnown,
  type ProviderSeenMemory,
  type ProviderSeenObservation,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import {
  reviveProviderSeenMemory,
  serializeProviderSeenMemory,
} from '@/modules/prospect-batches/provider-seen/provider-seen-memory-serialization';
import { restoreContinuationRunInput } from '../continuation-worker';
import { enqueueApolloRoundContinuation } from '../continuation-worker.server';
import type { ApolloTwoRoundWizardRunInput } from '../production-runner.server';

/** La memoria tal como la construye la carga real: `Set` + `Set` + `Map`. */
function realMemory() {
  return {
    providerEntityIds: new Set(['apollo-org-1', 'apollo-org-2']),
    normalizedDomains: new Set(['acme.com', 'globex.mx']),
    domainLastSeenAt: new Map([
      ['acme.com', '2026-09-20T10:00:00.000Z'],
      ['globex.mx', '2026-09-25T10:00:00.000Z'],
    ]),
  };
}

/** Exactamente lo que se leyó de `apollo_round_continuation_jobs` en Producción. */
const PRODUCTION_STUCK_JOB_METADATA = {
  run_input: {
    country: 'México',
    countryCode: 'MX',
    industry: 'Tecnología',
    priorProviderSeen: {
      memory: { domainLastSeenAt: {}, normalizedDomains: {}, providerEntityIds: {} },
      available: true,
    },
  },
};

/** Una observación completa: el proveedor y el tipo forman parte del contrato. */
const observe = (providerEntityId: string | null, normalizedDomain: string | null): ProviderSeenObservation => ({
  provider: 'apollo',
  entityType: 'company',
  providerEntityId,
  normalizedDomain,
});
const OBSERVATION = observe('apollo-org-1', 'acme.com');

describe('§ 1 — el defecto, con la forma que quedó en la base', () => {
  it('🔴 JSON convierte la memoria en `{}` y `.has` deja de existir', () => {
    const roundTripped = JSON.parse(JSON.stringify(realMemory()));
    assert.deepEqual(roundTripped, { providerEntityIds: {}, normalizedDomains: {}, domainLastSeenAt: {} });
    assert.throws(
      () => isProviderSeenKnown(roundTripped as unknown as ProviderSeenMemory, OBSERVATION),
      /has is not a function/,
      'esto es lo que reventaba la continuación',
    );
  });
});

describe('§ 2 — restaurar el run_input deja una memoria que funciona', () => {
  it('🔴 la fila atascada de Producción (`{}`) ya no lanza al reanudar', () => {
    const restored = restoreContinuationRunInput(
      JSON.parse(JSON.stringify(PRODUCTION_STUCK_JOB_METADATA)),
    );
    assert.ok(restored);
    const prior = (restored.runInput as { priorProviderSeen: { available: true; memory: never } })
      .priorProviderSeen;
    assert.equal(prior.available, true);
    assert.doesNotThrow(() => isProviderSeenKnown(prior.memory, OBSERVATION));
    assert.equal(isProviderSeenKnown(prior.memory, OBSERVATION), false, '`{}` = memoria vacía');
  });

  it('el formato nuevo (listas) reconstruye Set/Map con todos sus datos', () => {
    const stored = JSON.parse(
      JSON.stringify({
        run_input: { priorProviderSeen: { available: true, memory: serializeProviderSeenMemory(realMemory()) } },
      }),
    );
    const restored = restoreContinuationRunInput(stored);
    const memory = (restored!.runInput as unknown as {
      priorProviderSeen: { memory: ReturnType<typeof realMemory> };
    }).priorProviderSeen.memory;
    assert.ok(memory.providerEntityIds instanceof Set);
    assert.ok(memory.normalizedDomains instanceof Set);
    assert.ok(memory.domainLastSeenAt instanceof Map);
    assert.equal(isProviderSeenKnown(memory, OBSERVATION), true);
    assert.equal(isProviderSeenKnown(memory, observe(null, 'globex.mx')), true);
    assert.equal(isProviderSeenKnown(memory, observe('otro', 'otro.com')), false);
    assert.equal(memory.domainLastSeenAt!.get('acme.com'), '2026-09-20T10:00:00.000Z');
  });

  it('`available: false` no se toca', () => {
    const prior = { available: false, unavailableReason: 'memory_not_loaded' };
    const restored = restoreContinuationRunInput({ run_input: { priorProviderSeen: prior } } as never);
    assert.deepEqual((restored!.runInput as { priorProviderSeen: unknown }).priorProviderSeen, prior);
  });

  it('sin `priorProviderSeen` no inventa uno', () => {
    const restored = restoreContinuationRunInput({ run_input: { country: 'México' } } as never);
    assert.equal('priorProviderSeen' in (restored!.runInput as object), false);
  });
});

describe('§ 3 — encolar ya no pierde los datos', () => {
  it('🔴 lo que llega a la base conserva identidades y fechas (antes eran `{}`)', async () => {
    let inserted: { metadata?: { run_input?: { priorProviderSeen?: { memory?: unknown } } } } | null = null;
    const client = {
      from: () => ({
        insert: (row: typeof inserted) => {
          inserted = row;
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as SupabaseClient;

    const out = await enqueueApolloRoundContinuation({
      batchId: 'b1',
      wizardRunId: 'w1',
      idempotencyKey: 'k1',
      requestFingerprint: 'f1',
      client,
      runInput: {
        country: 'México',
        priorProviderSeen: { available: true, memory: realMemory() },
      } as unknown as ApolloTwoRoundWizardRunInput,
    });
    assert.equal(out.enqueued, true);

    const onTheWire = JSON.parse(JSON.stringify(inserted));
    assert.deepEqual(onTheWire.metadata.run_input.priorProviderSeen.memory, {
      providerEntityIds: ['apollo-org-1', 'apollo-org-2'],
      normalizedDomains: ['acme.com', 'globex.mx'],
      domainLastSeenAt: [
        ['acme.com', '2026-09-20T10:00:00.000Z'],
        ['globex.mx', '2026-09-25T10:00:00.000Z'],
      ],
    });

    // Y el viaje completo encolar → base → reanudar funciona de punta a punta.
    const restored = restoreContinuationRunInput(onTheWire.metadata);
    const memory = (restored!.runInput as unknown as {
      priorProviderSeen: { memory: ReturnType<typeof realMemory> };
    }).priorProviderSeen.memory;
    assert.equal(isProviderSeenKnown(memory, OBSERVATION), true);
  });

  it('un run_input sin memoria se encola tal cual', async () => {
    let inserted: { metadata?: { run_input?: Record<string, unknown> } } | null = null;
    const client = {
      from: () => ({
        insert: (row: typeof inserted) => {
          inserted = row;
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as SupabaseClient;
    await enqueueApolloRoundContinuation({
      batchId: 'b1',
      wizardRunId: 'w1',
      idempotencyKey: 'k1',
      requestFingerprint: 'f1',
      client,
      runInput: { country: 'México' } as unknown as ApolloTwoRoundWizardRunInput,
    });
    assert.equal('priorProviderSeen' in (inserted!.metadata!.run_input as object), false);
  });
});

describe('§ 4 — lo ilegible degrada a vacío, nunca lanza', () => {
  for (const [label, raw] of [
    ['null', null],
    ['undefined', undefined],
    ['una cadena', 'basura'],
    ['un número', 42],
    ['listas con tipos mezclados', { providerEntityIds: [1, null, 'ok', ''], normalizedDomains: 'no-es-lista' }],
    ['fechas mal formadas', { domainLastSeenAt: [['a'], ['b', 3], 'c', ['d.com', '2026-09-20T00:00:00Z']] }],
  ] as const) {
    it(label, () => {
      const memory = reviveProviderSeenMemory(raw);
      assert.ok(memory.providerEntityIds instanceof Set);
      assert.ok(memory.normalizedDomains instanceof Set);
      assert.doesNotThrow(() => isProviderSeenKnown(memory, OBSERVATION));
    });
  }

  it('sólo sobreviven las entradas válidas', () => {
    const memory = reviveProviderSeenMemory({
      providerEntityIds: [1, null, 'ok', ''],
      domainLastSeenAt: [['a'], ['b', 3], 'c', ['d.com', '2026-09-20T00:00:00Z']],
    });
    assert.deepEqual([...memory.providerEntityIds], ['ok']);
    assert.deepEqual([...(memory.domainLastSeenAt ?? [])], [['d.com', '2026-09-20T00:00:00Z']]);
  });

  it('serializar es idempotente y acepta instancias reales o listas ya planas', () => {
    const once = serializeProviderSeenMemory(realMemory());
    assert.deepEqual(serializeProviderSeenMemory(once), once);
  });
});
