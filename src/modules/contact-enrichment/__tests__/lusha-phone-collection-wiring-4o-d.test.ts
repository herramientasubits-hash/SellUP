/**
 * Agente 2A — El core del fallback Lusha, cableado a la escritura transaccional
 * (AGENT2A-PHONE-REVEAL-4O-D)
 *
 * Cubre las DOS rutas que el hito autorizó — waterfall completo y continuación
 * legacy — y lo hace con el MISMO core, que es lo que la auditoría previa
 * confirmó: las dos convergen en `runLushaPhoneFallbackReveal` con
 * `waterfallMode: true`, así que lo que distingue una corrida de otra es su
 * `run_mode`, no el camino de escritura.
 *
 * También fija lo que NO cambia: sin la dep inyectada, el camino anterior queda
 * intacto (es el disparo manual de administración, fuera de alcance).
 *
 * Sin red, sin base de datos, sin proveedor real, sin flag de entorno. Todos los
 * números son sintéticos 555.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runLushaPhoneFallbackReveal,
  LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
  type LushaPhoneFallbackCandidateRecord,
  type LushaPhoneFallbackCoreDeps,
  type LushaPhoneFallbackPersistencePatch,
  type LushaPhoneFallbackUsageLogEntry,
} from '../lusha-phone-fallback-core';
import type {
  CandidateLushaPhoneCollectionWriteRequest,
  CandidateLushaPhoneCollectionWriteResult,
} from '../candidate-lusha-phone-collection-writer';
import type { LushaPhoneFallbackClientResult } from '@/server/integrations/lusha-phone-fallback-client';
import {
  extractAllLushaPhones,
  selectPrimaryLushaPhone,
} from '@/server/integrations/lusha-phone-fallback-phones';
import { normalizeCandidatePhone } from '../phone-collection-core';

const NOW = '2026-08-06T10:00:00.000Z';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';

const MOBILE = '+15550000001';
const WORK = '+15550000002';
const HQ = '+15550000004';

const keyOf = (number: string) =>
  normalizeCandidatePhone({
    displayPhone: number,
    sanitizedPhone: number,
    countryCode: null,
  }).dedupeKey;

// ── Cliente falso, construido como lo hace el real ─────────────

function clientResult(
  rawPhones: unknown[],
  overrides: Partial<LushaPhoneFallbackClientResult> = {},
): LushaPhoneFallbackClientResult {
  const phones = extractAllLushaPhones({ results: [{ phones: rawPhones }] });
  const primary = selectPrimaryLushaPhone(phones);
  return {
    ok: true,
    httpStatus: 200,
    phones,
    phoneNumber: primary?.number ?? null,
    phoneType: primary?.phoneType ?? 'unknown',
    phoneRawType: primary?.rawType ?? null,
    creditsCharged: 5,
    candidateStatus: phones.length > 0 ? 'revealed' : 'no_phone_found',
    usageStatus: 'success',
    costSource: 'reported',
    errorCode: null,
    availabilitySource: null,
    phonesReturned: rawPhones.length,
    ...overrides,
  } as LushaPhoneFallbackClientResult;
}

const CANDIDATE: LushaPhoneFallbackCandidateRecord = {
  id: 'candidate-1',
  status: 'pending_review',
  source: 'lusha',
  sourceContactId: 'v1.abcdef1234567890',
  existingPhone: null,
  // Precondición dura del gate: el otro proveedor ya se agotó.
  phoneRevealStatus: 'no_phone_found',
  phoneRevealAttemptCount: 1,
  enrichmentMetadata: { email: 'x@example.com' } as never,
};

const OK_WRITE: CandidateLushaPhoneCollectionWriteResult = {
  status: 'persisted',
  inserted_phone_count: 2,
  updated_phone_count: 0,
  inserted_source_count: 2,
  suppressed_skipped_count: 0,
  primary_dedupe_key: keyOf(MOBILE),
  primary_persisted: true,
  candidate_scalar_updated: true,
  candidate_terminalized: true,
};

interface Harness {
  deps: LushaPhoneFallbackCoreDeps;
  writes: CandidateLushaPhoneCollectionWriteRequest[];
  persisted: LushaPhoneFallbackPersistencePatch[];
  logged: LushaPhoneFallbackUsageLogEntry[];
}

function harness(opts: {
  result: LushaPhoneFallbackClientResult;
  /** Ausente ⇒ dep NO cableada (disparo manual, fuera de alcance del hito). */
  write?: CandidateLushaPhoneCollectionWriteResult | (() => never);
  candidate?: Partial<LushaPhoneFallbackCandidateRecord>;
}): Harness {
  const writes: CandidateLushaPhoneCollectionWriteRequest[] = [];
  const persisted: LushaPhoneFallbackPersistencePatch[] = [];
  const logged: LushaPhoneFallbackUsageLogEntry[] = [];
  return {
    writes,
    persisted,
    logged,
    deps: {
      flagEnabled: true,
      actor: { internalUserId: ACTOR, roleKey: 'admin' },
      nowIso: NOW,
      waterfallMode: true,
      phoneRevealWaterfallId: RUN_ID,
      loadCandidate: async () => ({ ...CANDIDATE, ...opts.candidate }),
      callLusha: async () => opts.result,
      persist: async (_id, patch) => {
        persisted.push(patch);
      },
      logUsage: async (entry) => {
        logged.push(entry);
      },
      ...(opts.write === undefined
        ? {}
        : {
            persistPhoneCollection: async (
              request: CandidateLushaPhoneCollectionWriteRequest,
            ) => {
              writes.push(request);
              if (typeof opts.write === 'function') return opts.write();
              return opts.write as CandidateLushaPhoneCollectionWriteResult;
            },
            phoneCollectionReservationId: null,
          }),
    } as LushaPhoneFallbackCoreDeps,
  };
}

const INPUT = {
  candidateId: 'candidate-1',
  confirmCost: true,
  expectedMaxCredits: LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
};

// ═══════════════════════════════════════════════════════════════
// 1. Waterfall completo
// ═══════════════════════════════════════════════════════════════

describe('4O-D — waterfall completo: Lusha success con N teléfonos', () => {
  it('N teléfonos ⇒ N filas canónicas en UNA sola escritura', async () => {
    const h = harness({
      result: clientResult([
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
        { number: HQ, type: 'hq' },
      ]),
      write: { ...OK_WRITE, inserted_phone_count: 3, inserted_source_count: 3 },
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'revealed');
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].phones.length, 3);
    // El UPDATE suelto ya no se usa en este camino.
    assert.equal(h.persisted.length, 0);
  });

  it('el escalar propuesto es el MÓVIL, no el primero del payload', async () => {
    const h = harness({
      result: clientResult([
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ]),
      write: OK_WRITE,
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    const request = h.writes[0];
    assert.equal(request.terminal.legacyPhone, MOBILE);
    assert.equal(request.terminal.legacyPhoneType, 'mobile');
    assert.equal(request.primaryCandidates[0].dedupeKey, keyOf(MOBILE));
    assert.equal(request.primaryCandidates[0].phone, MOBILE);
  });

  it('la clave heredada corresponde al número heredado', async () => {
    const h = harness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: OK_WRITE,
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(h.writes[0].terminal.legacyDedupeKey, keyOf(MOBILE));
  });

  it('el estado terminal lleva el token de pertenencia y el request id que LIMPIA', async () => {
    const h = harness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: OK_WRITE,
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    const terminal = h.writes[0].terminal;
    assert.equal(terminal.expectedPhoneRevealStatus, 'no_phone_found');
    assert.equal(terminal.requestId, null);
    assert.equal(terminal.revealedBy, ACTOR);
    assert.equal(terminal.attemptCount, 2);
    assert.equal(terminal.costCredits, 5);
    assert.equal(terminal.costSource, 'reported');
  });

  it('la procedencia lleva el id de la corrida', async () => {
    const h = harness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: OK_WRITE,
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(h.writes[0].phones[0].sources[0].waterfallRunId, RUN_ID);
  });

  it('Lusha success sin teléfono ⇒ no_phone_found y 0 escrituras de colección', async () => {
    const h = harness({
      result: clientResult([], { creditsCharged: 0 }),
      write: OK_WRITE,
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'no_phone_found');
    assert.equal(h.writes.length, 0);
    // waterfallMode: el candidato NO se sobrescribe en los caminos que no revelan.
    assert.equal(h.persisted.length, 0);
  });

  it('reintento con el mismo resultado ⇒ idempotente, sin duplicar filas', async () => {
    const h = harness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: {
        ...OK_WRITE,
        status: 'idempotent',
        inserted_phone_count: 0,
        inserted_source_count: 0,
        candidate_terminalized: true,
      },
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'revealed');
    assert.equal(h.logged[0].metadata.phone_collection?.persistence_status, 'idempotent');
    assert.equal(h.logged[0].metadata.phone_collection?.candidate_terminalized, true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Legacy Lusha-only
// ═══════════════════════════════════════════════════════════════

describe('4O-D — continuación legacy: mismo core, mismas garantías', () => {
  it('N teléfonos ⇒ N filas canónicas, igual que el waterfall completo', async () => {
    const h = harness({
      result: clientResult([
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ]),
      write: OK_WRITE,
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'revealed');
    assert.equal(h.writes[0].phones.length, 2);
    assert.equal(h.writes[0].terminal.legacyPhone, MOBILE);
  });

  it('nunca llama a otro proveedor: la única dep de red es callLusha', async () => {
    let lushaCalls = 0;
    const h = harness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: OK_WRITE,
    });
    const deps = {
      ...h.deps,
      callLusha: async () => {
        lushaCalls += 1;
        return clientResult([{ number: MOBILE, type: 'mobile' }]);
      },
    };
    await runLushaPhoneFallbackReveal(INPUT, deps);
    assert.equal(lushaCalls, 1);
  });

  it('el tope de créditos y la confirmación siguen siendo obligatorios', async () => {
    const h = harness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: OK_WRITE,
    });
    const result = await runLushaPhoneFallbackReveal(
      { ...INPUT, expectedMaxCredits: 1 },
      h.deps,
    );
    assert.equal(result.status, 'missing_cost_confirmation');
    assert.equal(h.writes.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Contabilidad
// ═══════════════════════════════════════════════════════════════

describe('4O-D — el costo es POR RESPUESTA, nunca por número', () => {
  it('3 teléfonos, billing 5 ⇒ costo total 5 (no 15)', async () => {
    const h = harness({
      result: clientResult([
        { number: MOBILE, type: 'mobile' },
        { number: WORK, type: 'work' },
        { number: HQ, type: 'hq' },
      ]),
      write: OK_WRITE,
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.creditsCharged, 5);
    assert.equal(h.writes[0].terminal.costCredits, 5);
    assert.equal(h.logged.length, 1);
    assert.equal(h.logged[0].creditsUsed, 5);
  });

  it('el mismo teléfono repetido no cambia el costo', async () => {
    const h = harness({
      result: clientResult([
        { number: MOBILE, type: 'mobile' },
        { number: MOBILE, type: 'mobile' },
      ]),
      write: OK_WRITE,
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.creditsCharged, 5);
    assert.equal(h.writes[0].phones.length, 1);
  });

  it('ninguna fila canónica lleva una columna de costo', async () => {
    const h = harness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: OK_WRITE,
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(/credit/i.test(JSON.stringify(h.writes[0].phones)), false);
  });

  it('UN usage-log por pata, con el costo real', async () => {
    const h = harness({
      result: clientResult([
        { number: MOBILE, type: 'mobile' },
        { number: WORK, type: 'work' },
      ]),
      write: OK_WRITE,
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(h.logged.length, 1);
    assert.equal(h.logged[0].status, 'success');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Fail-closed
// ═══════════════════════════════════════════════════════════════

describe('4O-D — fallo de persistencia: fail-closed, sin perder el gasto', () => {
  it('si la transacción lanza, NO se reporta revealed y NO se reintenta Lusha', async () => {
    let lushaCalls = 0;
    const h = harness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: () => {
        throw new Error('rpc unavailable');
      },
    });
    const deps = {
      ...h.deps,
      callLusha: async () => {
        lushaCalls += 1;
        return clientResult([{ number: MOBILE, type: 'mobile' }]);
      },
    };
    const result = await runLushaPhoneFallbackReveal(INPUT, deps);

    assert.equal(result.ok, false);
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'collection_persistence_unavailable');
    assert.equal(lushaCalls, 1);
    // El candidato NO se escribe por la puerta de atrás.
    assert.equal(h.persisted.length, 0);
  });

  it('el gasto real SÍ queda registrado aunque la persistencia falle', async () => {
    const h = harness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: () => {
        throw new Error('rpc unavailable');
      },
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.creditsCharged, 5);
    assert.equal(h.logged.length, 1);
    assert.equal(h.logged[0].creditsUsed, 5);
    assert.equal(
      h.logged[0].metadata.phone_collection_error_code,
      'collection_persistence_unavailable',
    );
    // El fallo NO se disfraza de error del proveedor: Lusha respondió bien.
    assert.equal(h.logged[0].metadata.provider_error_code, undefined);
    assert.equal(h.logged[0].status, 'success');
  });

  it('`suppressed` no terminaliza ⇒ no se reporta revealed', async () => {
    const h = harness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: {
        ...OK_WRITE,
        status: 'suppressed',
        inserted_phone_count: 0,
        inserted_source_count: 0,
        suppressed_skipped_count: 1,
        primary_dedupe_key: null,
        primary_persisted: false,
        candidate_scalar_updated: false,
        candidate_terminalized: false,
      },
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'phone_suppressed');
    assert.equal(result.creditsCharged, 5);
  });

  it('`stale_event` no terminaliza ⇒ no se reporta revealed', async () => {
    const h = harness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: {
        ...OK_WRITE,
        status: 'stale_event',
        candidate_terminalized: false,
        candidate_scalar_updated: false,
      },
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'collection_stale_event');
  });

  it('el principal conservado por el incumbente sigue siendo un reveal correcto', async () => {
    const h = harness({
      result: clientResult([{ number: WORK, type: 'work' }]),
      write: {
        ...OK_WRITE,
        primary_dedupe_key: keyOf(MOBILE),
        candidate_scalar_updated: false,
        candidate_terminalized: true,
      },
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'revealed');
    assert.equal(h.logged[0].metadata.phone_collection?.candidate_scalar_updated, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Sin la dep: el camino anterior, intacto
// ═══════════════════════════════════════════════════════════════

describe('4O-D — sin persistPhoneCollection el camino previo no cambia', () => {
  it('escribe con el UPDATE de siempre y no construye colección', async () => {
    const h = harness({ result: clientResult([{ number: MOBILE, type: 'mobile' }]) });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'revealed');
    assert.equal(h.writes.length, 0);
    assert.equal(h.persisted.length, 1);
    assert.equal(h.persisted[0].phone, MOBILE);
    assert.equal(h.persisted[0].phone_reveal_provider, 'lusha');
    assert.equal(h.persisted[0].phone_reveal_request_id, null);
  });

  it('el escalar SÍ mejora incluso sin la dep: el cliente ya elige por ranking', async () => {
    const h = harness({
      result: clientResult([
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ]),
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(h.persisted[0].phone, MOBILE);
  });

  it('la metadata del usage-log conserva su forma anterior', async () => {
    const h = harness({ result: clientResult([{ number: MOBILE, type: 'mobile' }]) });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(h.logged[0].metadata.phone_collection, undefined);
    assert.equal(h.logged[0].metadata.phone_collection_error_code, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Privacidad
// ═══════════════════════════════════════════════════════════════

describe('4O-D — nada registrable contiene PII', () => {
  it('ni el número, ni el display, ni la dedupe_key llegan al usage-log', async () => {
    const h = harness({
      result: clientResult([
        { number: MOBILE, type: 'mobile' },
        { number: WORK, type: 'work' },
      ]),
      write: OK_WRITE,
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    const serialized = JSON.stringify(h.logged);
    for (const secret of [MOBILE, WORK, '5550000001', '5550000002', keyOf(MOBILE)]) {
      assert.equal(serialized.includes(secret), false, `filtró ${secret}`);
    }
    assert.equal(/@example\.com/.test(serialized), false);
    assert.equal(/linkedin/i.test(serialized), false);
  });

  it('las cifras de la colección SÍ están, porque son cifras', async () => {
    const h = harness({
      result: clientResult([
        { number: MOBILE, type: 'mobile' },
        { number: WORK, type: 'work' },
      ]),
      write: OK_WRITE,
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    const collection = h.logged[0].metadata.phone_collection;
    assert.equal(collection?.canonical_phone_count, 2);
    assert.equal(collection?.source_count, 2);
    assert.equal(collection?.collection_persisted, true);
    assert.equal(collection?.persistence_status, 'persisted');
  });
});
