/**
 * Agente 2A — El disparo MANUAL de Lusha persiste TODOS los teléfonos de la misma
 * respuesta pagada (AGENT2A-PHONE-REVEAL-4O-F)
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ DEFECTO CIERRA
 * ═══════════════════════════════════════════════════════════════════
 *
 * 4O-D hizo que el cliente devolviera `results[0].phones[]` COMPLETO y cableó la
 * escritura transaccional en la pata del waterfall. El disparo manual de
 * administración se quedó fuera de ese hito: seguía recibiendo los N teléfonos y
 * escribiendo UNO. Los demás ya estaban pagados —Lusha cobra por RESPUESTA— así que
 * perderlos al guardarlos obliga a pagar otra vez para recuperar un número que ya
 * habíamos comprado.
 *
 * Esta suite fija que el camino manual pasa por la MISMA transacción, con las MISMAS
 * reglas, y que hacerlo no aflojó ninguna de las puertas de privacidad ni multiplicó
 * la factura.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ PRUEBA — Y QUÉ NO
 * ═══════════════════════════════════════════════════════════════════
 *
 * Aquí se prueba el CONTRATO: qué colección se construye, qué llega al writer, qué
 * se cobra, qué se registra y qué se bloquea. La ATOMICIDAD, el merge REAL entre
 * proveedores, los tombstones y la concurrencia no se pueden demostrar con un doble
 * en TypeScript —no tiene transacciones— y se prueban contra un PostgreSQL de verdad
 * en `manual-lusha-multi-phone-postgres-4o-f.test.ts`, con el MISMO camino manual.
 *
 * El writer es el REAL en su forma: el fake recibe exactamente
 * `CandidateLushaPhoneCollectionWriteRequest` y devuelve exactamente
 * `CandidateLushaPhoneCollectionWriteResult`, así que si el contrato cambiara este
 * archivo dejaría de compilar.
 *
 * Sin red, sin base de datos, sin proveedor real, sin flag de entorno, sin reloj.
 * Todos los números son sintéticos 555.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  runLushaPhoneFallbackReveal,
  LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
  LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE,
  type LushaPhoneFallbackCandidateRecord,
  type LushaPhoneFallbackCoreDeps,
  type LushaPhoneFallbackPersistencePatch,
  type LushaPhoneFallbackUsageLogEntry,
} from '../lusha-phone-fallback-core';
import type {
  CandidateLushaPhoneCollectionWriteRequest,
  CandidateLushaPhoneCollectionWriteResult,
} from '../candidate-lusha-phone-collection-writer';
import type { TerminalPhoneSuppressionPatch } from '../phone-reveal-suppression-guard';
import type { PhoneRevealWaterfallSuppressionState } from '../phone-reveal-waterfall-core';
import type { LushaPhoneFallbackClientResult } from '@/server/integrations/lusha-phone-fallback-client';
import {
  extractAllLushaPhones,
  selectPrimaryLushaPhone,
} from '@/server/integrations/lusha-phone-fallback-phones';
import { normalizeCandidatePhone } from '../phone-collection-core';

// ═══════════════════════════════════════════════════════════════
// Constantes
// ═══════════════════════════════════════════════════════════════

const NOW = '2026-08-10T10:00:00.000Z';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const CANDIDATE_ID = 'candidate-manual-1';

const MOBILE = '+15550000001';
const WORK = '+15550000002';
const DIRECT = '+15550000003';

/** El MISMO número en dos formatos: prueba que la clave no depende del formato. */
const MOBILE_FORMATTED = '+1 (555) 000-0001';

const keyOf = (number: string) =>
  normalizeCandidatePhone({
    displayPhone: number,
    sanitizedPhone: number,
    countryCode: null,
  }).dedupeKey;

// ═══════════════════════════════════════════════════════════════
// Cliente falso, construido como lo hace el real
// ═══════════════════════════════════════════════════════════════

/**
 * Pasa el payload crudo por los MISMOS lectores puros que usa el cliente de
 * producción (`extractAllLushaPhones` + `selectPrimaryLushaPhone`). Fabricar la lista
 * a mano dejaría sin probar precisamente la parte que decide qué teléfonos existen.
 */
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
    // Una sola respuesta ⇒ un solo cargo, sea cual sea el número de teléfonos.
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
  id: CANDIDATE_ID,
  status: 'pending_review',
  source: 'lusha',
  sourceContactId: 'v1.abcdef1234567890',
  existingPhone: null,
  // Precondición dura del gate canónico: el otro proveedor ya se agotó.
  phoneRevealStatus: 'no_phone_found',
  phoneRevealAttemptCount: 1,
  enrichmentMetadata: { email: 'x@example.com' } as never,
};

function okWrite(
  overrides: Partial<CandidateLushaPhoneCollectionWriteResult> = {},
): CandidateLushaPhoneCollectionWriteResult {
  return {
    status: 'persisted',
    inserted_phone_count: 0,
    updated_phone_count: 0,
    inserted_source_count: 0,
    suppressed_skipped_count: 0,
    primary_dedupe_key: null,
    primary_persisted: true,
    candidate_scalar_updated: true,
    candidate_terminalized: true,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// Arnés: EXACTAMENTE la forma de deps del disparo manual
// ═══════════════════════════════════════════════════════════════

interface ManualHarness {
  deps: LushaPhoneFallbackCoreDeps;
  /** Peticiones que llegaron al writer transaccional. */
  writes: CandidateLushaPhoneCollectionWriteRequest[];
  /** Parches del UPDATE escalar suelto. En el camino manual debe quedar VACÍO. */
  persisted: LushaPhoneFallbackPersistencePatch[];
  logged: LushaPhoneFallbackUsageLogEntry[];
  /** Cierres terminales por supresión (escritura CONDICIONAL de 4O-E1). */
  terminalSuppressions: Array<{ candidateId: string; patch: TerminalPhoneSuppressionPatch }>;
  /** Cuántas veces se llamó al proveedor. Es la métrica de gasto. */
  providerCalls: number;
  /** Cuántas veces se consultó la puerta de privacidad (pre + post). */
  gateCalls: number;
}

/**
 * Construye las deps TAL COMO las cablea `lusha-phone-fallback-actions.ts` tras 4O-F:
 * `waterfallMode` ausente (modo manual), la puerta de privacidad inyectada, el cierre
 * terminal condicional inyectado y la colección transaccional inyectada, con corrida
 * y reserva a null porque el disparo manual no pertenece a ninguna.
 */
function manualHarness(opts: {
  result: LushaPhoneFallbackClientResult | (() => LushaPhoneFallbackClientResult);
  write?: CandidateLushaPhoneCollectionWriteResult | (() => never);
  candidate?: Partial<LushaPhoneFallbackCandidateRecord>;
  /** Veredictos de la puerta, en orden: [pre-call, post-call]. */
  gate?: readonly PhoneRevealWaterfallSuppressionState[];
}): ManualHarness {
  const h: ManualHarness = {
    writes: [],
    persisted: [],
    logged: [],
    terminalSuppressions: [],
    providerCalls: 0,
    gateCalls: 0,
    deps: undefined as never,
  };
  const gateVerdicts = opts.gate ?? (['clear', 'clear'] as const);

  h.deps = {
    flagEnabled: true,
    actor: { internalUserId: ACTOR, roleKey: 'admin' },
    nowIso: NOW,
    // Modo MANUAL: `waterfallMode` deliberadamente ausente.
    phoneRevealWaterfallId: null,
    phoneCollectionReservationId: null,

    checkPrivacyGate: async () => {
      const verdict = gateVerdicts[h.gateCalls] ?? 'clear';
      h.gateCalls += 1;
      return verdict;
    },

    persistTerminalSuppression: async (candidateId, patch) => {
      h.terminalSuppressions.push({ candidateId, patch });
      return { applied: true };
    },

    persistPhoneCollection: async (request) => {
      h.writes.push(request);
      if (typeof opts.write === 'function') return opts.write();
      return opts.write ?? okWrite();
    },

    loadCandidate: async () => ({ ...CANDIDATE, ...opts.candidate }),

    callLusha: async () => {
      h.providerCalls += 1;
      return typeof opts.result === 'function' ? opts.result() : opts.result;
    },

    persist: async (_id, patch) => {
      h.persisted.push(patch);
    },

    logUsage: async (entry) => {
      h.logged.push(entry);
    },
  };

  return h;
}

const INPUT = {
  candidateId: CANDIDATE_ID,
  confirmCost: true,
  expectedMaxCredits: LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
};

/** Claves canónicas que llegaron al writer, en el orden en que se enviaron. */
const writtenKeys = (request: CandidateLushaPhoneCollectionWriteRequest) =>
  request.phones.map((p) => p.dedupeKey);

// ═══════════════════════════════════════════════════════════════
// § 24.1 / § 24.2 — TODOS los teléfonos de la respuesta
// ═══════════════════════════════════════════════════════════════

describe('4O-F · § 24.1 — dos teléfonos en una respuesta', () => {
  it('WORK + MOBILE ⇒ 2 filas canónicas, MOBILE principal, 1 evento de facturación', async () => {
    const h = manualHarness({
      result: clientResult([
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ]),
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.ok, true);
    assert.equal(result.status, 'revealed');

    // UNA sola escritura, y NINGÚN UPDATE escalar suelto: el camino manual dejó de
    // pasar por `deps.persist` en el desenlace `revealed`.
    assert.equal(h.writes.length, 1);
    assert.equal(h.persisted.length, 0);

    const [request] = h.writes;
    assert.equal(request.phones.length, 2, 'los DOS teléfonos pagados se persisten');
    assert.deepEqual(new Set(writtenKeys(request)), new Set([keyOf(WORK), keyOf(MOBILE)]));

    // El principal preferido es el MÓVIL, no el primero del array.
    assert.equal(request.primaryCandidates[0]?.dedupeKey, keyOf(MOBILE));
    assert.equal(request.primaryCandidates[0]?.phone, MOBILE);
    assert.equal(request.terminal.legacyPhone, MOBILE);
    assert.equal(request.terminal.legacyPhoneType, 'mobile');

    // UN evento económico con el costo REPORTADO por respuesta.
    assert.equal(h.providerCalls, 1);
    assert.equal(h.logged.length, 1);
    assert.equal(h.logged[0].creditsUsed, 5);
    assert.equal(result.creditsCharged, 5);
  });

  it('la corrida y la reserva viajan como null: no se inventa correlación', async () => {
    const h = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    for (const phone of h.writes[0].phones) {
      for (const source of phone.sources) {
        assert.equal(source.waterfallRunId, null);
        assert.equal(source.reservationId, null);
        assert.equal(source.providerUsageLogId, null);
        // La procedencia sigue siendo del PROVEEDOR: «manual» describe quién apretó
        // el botón, no quién entregó el número.
        assert.equal(source.provider, 'lusha');
        assert.equal(source.acquisitionMode, 'reveal');
      }
    }
  });
});

describe('4O-F · § 24.2 — tres teléfonos en una respuesta', () => {
  it('work + direct_dial + mobile ⇒ 3 canónicos y mobile principal', async () => {
    const h = manualHarness({
      result: clientResult([
        { number: WORK, type: 'work' },
        { number: DIRECT, type: 'direct_dial' },
        { number: MOBILE, type: 'mobile' },
      ]),
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'revealed');
    const [request] = h.writes;
    assert.equal(request.phones.length, 3);
    assert.deepEqual(
      new Set(writtenKeys(request)),
      new Set([keyOf(WORK), keyOf(DIRECT), keyOf(MOBILE)]),
    );
    assert.equal(request.primaryCandidates[0]?.dedupeKey, keyOf(MOBILE));

    // El ranking completo se respeta también en las candidatas siguientes: el marcado
    // directo va por delante de la línea de trabajo.
    assert.deepEqual(
      request.primaryCandidates.map((c) => c.dedupeKey),
      [keyOf(MOBILE), keyOf(DIRECT), keyOf(WORK)],
    );

    // Tres teléfonos, UN cargo. La cardinalidad no altera la factura.
    assert.equal(h.logged.length, 1);
    assert.equal(h.logged[0].creditsUsed, 5);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 24.3 — duplicado dentro de la MISMA respuesta
// ═══════════════════════════════════════════════════════════════

describe('4O-F · § 24.3 — el mismo número repetido en la respuesta', () => {
  it('mismo número normalizado dos veces ⇒ UNA fila canónica', async () => {
    const h = manualHarness({
      result: clientResult([
        { number: MOBILE, type: 'mobile' },
        { number: MOBILE_FORMATTED, type: 'mobile' },
      ]),
    });

    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    const [request] = h.writes;
    assert.equal(request.phones.length, 1, 'dos formatos del mismo número son UNA fila');
    assert.equal(request.phones[0].dedupeKey, keyOf(MOBILE));
    // Mismo número Y mismo tipo ⇒ es el mismo dicho dos veces: UNA procedencia.
    assert.equal(request.phones[0].sources.length, 1);
  });

  it('mismo número con tipos DISTINTOS ⇒ una fila y DOS procedencias', async () => {
    const h = manualHarness({
      result: clientResult([
        { number: MOBILE, type: 'mobile' },
        { number: MOBILE_FORMATTED, type: 'work' },
      ]),
    });

    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    const [request] = h.writes;
    assert.equal(request.phones.length, 1);
    assert.equal(request.phones[0].sources.length, 2, 'cada dicho conserva su raw type');
    assert.deepEqual(
      new Set(request.phones[0].sources.map((s) => s.rawProviderType)),
      new Set(['mobile', 'work']),
    );
  });

  it('entradas vacías o malformadas se ignoran sin invalidar a sus hermanas', async () => {
    const h = manualHarness({
      result: clientResult([
        { number: '   ', type: 'mobile' },
        null,
        { type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ]),
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'revealed');
    assert.equal(h.writes[0].phones.length, 1);
    assert.equal(h.writes[0].phones[0].dedupeKey, keyOf(MOBILE));
  });
});

// ═══════════════════════════════════════════════════════════════
// § 24.4 / § 24.5 / § 24.6 — cruce con el otro proveedor
// ═══════════════════════════════════════════════════════════════
//
// La FUSIÓN real ocurre dentro de la transacción y se mide contra PostgreSQL en la
// suite hermana. Lo que se fija aquí es lo que el camino manual tiene que ENVIAR
// para que esa fusión sea posible, y lo que tiene que hacer con la respuesta.

describe('4O-F · § 24.4 — mismo número visto por los dos proveedores', () => {
  it('envía la clave canónica compartida, no una clave propia de Lusha', async () => {
    const h = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    // La clave se calcula con el MISMO normalizador que usa la captura del otro
    // proveedor: es lo único que hace que el número acabe en UNA fila con DOS
    // procedencias en vez de en dos filas que nadie relaciona.
    assert.equal(h.writes[0].phones[0].dedupeKey, keyOf(MOBILE));
    assert.equal(h.writes[0].terminal.legacyDedupeKey, keyOf(MOBILE));
  });
});

describe('4O-F · § 24.5 — el principal del otro proveedor es MEJOR y sobrevive', () => {
  it('la transacción conserva el principal previo ⇒ el escalar NO se toca', async () => {
    const h = manualHarness({
      result: clientResult([{ number: WORK, type: 'work' }]),
      // Lo que devuelve la función cuando el principal vivo era mejor: se persistió la
      // colección, pero el escalar sigue describiendo al principal conservado.
      write: okWrite({
        inserted_phone_count: 1,
        inserted_source_count: 1,
        primary_dedupe_key: keyOf(MOBILE),
        candidate_scalar_updated: false,
      }),
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'revealed');
    // El teléfono `work` SÍ se guarda como secundario: es información pagada.
    assert.equal(h.writes[0].phones.length, 1);
    assert.equal(h.writes[0].phones[0].dedupeKey, keyOf(WORK));
    // Y el core NO compensa con un UPDATE escalar por su cuenta.
    assert.equal(h.persisted.length, 0);

    // La observabilidad refleja que el visible no cambió de dueño.
    const fields = h.logged[0].metadata.phone_collection;
    assert.equal(fields?.candidate_scalar_updated, false);
    assert.equal(fields?.collection_persisted, true);
  });
});

describe('4O-F · § 24.6 — el teléfono de Lusha es MEJOR y promueve', () => {
  it('mobile de Lusha sobre work previo ⇒ escalar actualizado', async () => {
    const h = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: okWrite({
        inserted_phone_count: 1,
        inserted_source_count: 1,
        primary_dedupe_key: keyOf(MOBILE),
        candidate_scalar_updated: true,
      }),
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'revealed');
    assert.equal(h.writes[0].primaryCandidates[0]?.dedupeKey, keyOf(MOBILE));
    assert.equal(h.logged[0].metadata.phone_collection?.candidate_scalar_updated, true);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 24.7 — tombstone
// ═══════════════════════════════════════════════════════════════

describe('4O-F · § 24.7 — un número tombstoneado no resucita', () => {
  it('la transacción responde `suppressed` ⇒ NO se declara `revealed` y se cierra terminal', async () => {
    const h = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: okWrite({
        status: 'suppressed',
        inserted_phone_count: 0,
        inserted_source_count: 0,
        suppressed_skipped_count: 1,
        primary_dedupe_key: null,
        primary_persisted: false,
        candidate_scalar_updated: false,
        candidate_terminalized: false,
      }),
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.ok, false);
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE);

    // 4O-E1: el candidato recibe rastro terminal, y CONDICIONAL — el token de
    // pertenencia es el estado que autorizó la pata.
    assert.equal(h.terminalSuppressions.length, 1);
    assert.deepEqual(h.terminalSuppressions[0].patch.expectedStatuses, ['no_phone_found']);

    // El escalar NO se escribe por la puerta de atrás.
    assert.equal(h.persisted.length, 0);
    // Y el gasto REAL no se borra: el número se retiene, el cargo no.
    assert.equal(result.creditsCharged, 5);
    assert.equal(h.logged[0].creditsUsed, 5);
  });

  it('`stale_event` tampoco se reporta como revelado', async () => {
    const h = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: okWrite({ status: 'stale_event', candidate_terminalized: false }),
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'collection_stale_event');
    // No es un veredicto de privacidad: no se cierra nada por supresión.
    assert.equal(h.terminalSuppressions.length, 0);
    assert.equal(result.creditsCharged, 5);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 24.8 / § 24.9 — puertas ANTES de gastar
// ═══════════════════════════════════════════════════════════════

describe('4O-F · § 24.8 — do_not_contact', () => {
  it('0 llamadas al proveedor, 0 créditos, 0 escrituras', async () => {
    const h = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      gate: ['do_not_contact'],
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.ok, false);
    assert.equal(result.status, 'do_not_contact');
    assert.equal(h.providerCalls, 0, 'no se puede llamar a un proveedor por alguien no contactable');
    assert.equal(result.creditsCharged, 0);
    assert.equal(h.writes.length, 0);
    assert.equal(h.persisted.length, 0);
    assert.equal(h.terminalSuppressions.length, 0);
  });
});

describe('4O-F · § 24.9 — supresión ANTES de la llamada', () => {
  it('0 llamadas, 0 créditos, código `blocked_suppressed`', async () => {
    const h = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      gate: ['blocked_suppressed'],
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'blocked_suppressed');
    assert.equal(h.providerCalls, 0);
    assert.equal(result.creditsCharged, 0);
    assert.equal(h.writes.length, 0);
  });

  it('una lectura de supresión que FALLA también bloquea (fail-closed)', async () => {
    const h = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      gate: ['check_unavailable'],
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.ok, false);
    assert.equal(h.providerCalls, 0);
    assert.equal(h.writes.length, 0);
    assert.equal(h.logged[0].status, 'error');
  });

  // ── El punto exacto que 4O-F no podía romper ────────────────
  //
  // La transacción re-comprueba tombstones y supresión POR PERSONA bajo el lock,
  // pero NO lee `do_not_contact`. Si la puerta posterior hubiera quedado dentro de
  // la rama escalar, cablear la colección habría perdido esta protección en silencio.
  it('una DSAR registrada MIENTRAS Lusha respondía retiene el número, no el cargo', async () => {
    const h = manualHarness({
      result: clientResult([
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ]),
      gate: ['clear', 'blocked_suppressed'],
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'blocked_suppressed');
    assert.equal(h.gateCalls, 2, 'la puerta se consulta antes Y después de la respuesta');
    assert.equal(h.providerCalls, 1);
    // NINGUNA escritura de teléfonos, ni por la transacción ni por el escalar.
    assert.equal(h.writes.length, 0, 'la colección no se escribe tras un veredicto de privacidad');
    assert.equal(h.persisted.length, 0);
    // Rastro terminal condicional + el cargo REAL preservado.
    assert.equal(h.terminalSuppressions.length, 1);
    assert.equal(result.creditsCharged, 5);
    assert.equal(h.logged[0].creditsUsed, 5);
  });

  it('un do_not_contact en vuelo bloquea la colección y NO cierra terminal', async () => {
    const h = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      gate: ['clear', 'do_not_contact'],
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'do_not_contact');
    assert.equal(h.writes.length, 0);
    // `do_not_contact` no afirma un veredicto de privacidad definitivo sobre el
    // número: el siguiente intento lo para la puerta PREVIA, con 0 créditos.
    assert.equal(h.terminalSuppressions.length, 0);
    assert.equal(result.creditsCharged, 5, 'el cargo ya incurrido no se borra');
  });
});

// ═══════════════════════════════════════════════════════════════
// § 24.10 — reintento tras `phone_suppressed`
// ═══════════════════════════════════════════════════════════════

describe('4O-F · § 24.10 — el reintento tras un `phone_suppressed` pagado', () => {
  it('el costo real se conserva y el SEGUNDO intento no llama ni cobra', async () => {
    // Primer intento: se paga, la transacción declara `suppressed`, el candidato
    // recibe el cierre terminal `error` + `blocked_suppressed`.
    const first = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: okWrite({
        status: 'suppressed',
        suppressed_skipped_count: 1,
        primary_persisted: false,
        candidate_scalar_updated: false,
        candidate_terminalized: false,
      }),
    });
    const firstResult = await runLushaPhoneFallbackReveal(INPUT, first.deps);

    assert.equal(firstResult.errorCode, LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE);
    assert.equal(firstResult.creditsCharged, 5, 'el gasto REAL se preserva');
    assert.equal(first.providerCalls, 1);

    // Segundo intento sobre el candidato YA cerrado. El gate canónico lo declara
    // inelegible por su estado: `no_phone_found` era la única puerta de entrada.
    const second = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      candidate: { phoneRevealStatus: 'error' },
    });
    const secondResult = await runLushaPhoneFallbackReveal(INPUT, second.deps);

    assert.equal(secondResult.ok, false);
    assert.equal(second.providerCalls, 0, '0 llamadas adicionales');
    assert.equal(second.writes.length, 0);
    assert.equal(second.logged.length, 0, '0 créditos adicionales');
  });
});

// ═══════════════════════════════════════════════════════════════
// § 24.11 / § 24.12 — desenlaces sin cambios
// ═══════════════════════════════════════════════════════════════

describe('4O-F · § 24.11 — error genérico: sin cambios', () => {
  it('un 5xx no escribe colección y no asume costo', async () => {
    const h = manualHarness({
      result: clientResult([], {
        candidateStatus: 'error',
        usageStatus: 'error',
        errorCode: 'provider_error',
        creditsCharged: null,
        costSource: null,
      }),
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'provider_error');
    assert.equal(h.writes.length, 0);
    // El desenlace SÍ se persiste en el candidato: modo manual, no waterfall.
    assert.equal(h.persisted.length, 1);
    assert.equal(h.persisted[0].phone_reveal_status, 'error');
    assert.equal(h.persisted[0].phone, undefined, 'no se toca el teléfono previo');
    assert.equal(result.creditsCharged, null, 'nunca se asume 0 como «no se sabe»');
  });

  it('un fallo de red no asume costo ni escribe colección', async () => {
    const h = manualHarness({
      result: { ok: false, errorMessage: 'timeout' } as LushaPhoneFallbackClientResult,
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.errorCode, 'provider_network_error');
    assert.equal(h.writes.length, 0);
    assert.equal(result.creditsCharged, null);
  });
});

describe('4O-F · § 24.12 — no_phone_found: sin cambios', () => {
  it('0 teléfonos ⇒ terminal `no_phone_found`, 0 filas canónicas', async () => {
    const h = manualHarness({ result: clientResult([]) });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.ok, true);
    assert.equal(result.status, 'no_phone_found');
    assert.equal(h.writes.length, 0, 'no hay colección que escribir');
    assert.equal(h.persisted.length, 1);
    assert.equal(h.persisted[0].phone_reveal_status, 'no_phone_found');
    assert.equal(h.logged.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 17 / § 18 — facturación y observabilidad
// ═══════════════════════════════════════════════════════════════

describe('4O-F · § 17 — la factura NO depende del número de teléfonos', () => {
  for (const count of [1, 2, 3, 5]) {
    it(`${count} teléfono(s) en la respuesta ⇒ 1 llamada, 1 log, ${5} créditos`, async () => {
      const raw = Array.from({ length: count }, (_, i) => ({
        number: `+1555000${String(1000 + i)}`,
        type: i === 0 ? 'work' : 'mobile',
      }));
      const h = manualHarness({ result: clientResult(raw) });

      const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

      assert.equal(result.status, 'revealed');
      assert.equal(h.writes[0].phones.length, count);
      assert.equal(h.providerCalls, 1, 'una respuesta, una llamada');
      assert.equal(h.logged.length, 1, 'una respuesta, un evento económico');
      // El costo es el REPORTADO, sin multiplicar ni dividir por la cardinalidad.
      assert.equal(h.logged[0].creditsUsed, 5);
      assert.equal(result.creditsCharged, 5);
    });
  }

  it('un `creditsCharged` de 0 (ya disponible) se registra tal cual, no se infiere', async () => {
    const h = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }], {
        creditsCharged: 0,
        availabilitySource: 'already_available',
      }),
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.status, 'revealed');
    assert.equal(result.creditsCharged, 0);
    assert.equal(h.writes[0].terminal.costCredits, 0);
  });
});

describe('4O-F · § 18 — el usage log lleva cifras, nunca números de teléfono', () => {
  it('la metadata de la colección es el vocabulario cerrado de 4O-D', async () => {
    const h = manualHarness({
      result: clientResult([
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
        { number: MOBILE_FORMATTED, type: 'mobile' },
      ]),
      write: okWrite({ inserted_phone_count: 2, inserted_source_count: 2 }),
    });

    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    const fields = h.logged[0].metadata.phone_collection;
    assert.ok(fields);
    assert.equal(fields.canonical_phone_count, 2);
    assert.equal(fields.duplicate_phone_count, 1);
    assert.equal(fields.collection_persisted, true);
    assert.equal(fields.persistence_status, 'persisted');
    assert.equal(fields.candidate_terminalized, true);

    // Ni un número, ni una `dedupe_key`, en TODO el log.
    const serialized = JSON.stringify(h.logged[0]);
    for (const secret of [WORK, MOBILE, MOBILE_FORMATTED, keyOf(MOBILE), keyOf(WORK)]) {
      assert.equal(serialized.includes(secret), false, `se filtró ${secret.slice(0, 4)}…`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// § 12 — fallo de persistencia: fail-closed
// ═══════════════════════════════════════════════════════════════

describe('4O-F · § 12 — si la transacción falla, nada se declara escrito', () => {
  it('el candidato NO se cierra, el gasto SÍ se registra y no se vuelve a llamar', async () => {
    const h = manualHarness({
      result: clientResult([
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ]),
      write: () => {
        throw new Error('database unavailable');
      },
    });

    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'collection_persistence_unavailable');
    // NO hay respaldo secuencial: reintentar por el camino viejo reintroduciría
    // exactamente el defecto que este hito corrige.
    assert.equal(h.persisted.length, 0);
    assert.equal(h.providerCalls, 1, 'no se reintenta contra el proveedor');
    // El gasto ocurrió y queda registrado fuera de la transacción que falló.
    assert.equal(h.logged.length, 1);
    assert.equal(h.logged[0].creditsUsed, 5);
    assert.equal(h.logged[0].metadata.phone_collection_error_code, 'collection_persistence_unavailable');
  });
});

// ═══════════════════════════════════════════════════════════════
// § 13 / § 14 — compatibilidad del escalar
// ═══════════════════════════════════════════════════════════════

describe('4O-F · § 13 — el escalar del candidato sigue existiendo y describe al principal', () => {
  it('el teléfono heredado que va al terminal es el ELECTO, no el primero del array', async () => {
    const h = manualHarness({
      result: clientResult([
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ]),
    });

    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    const { terminal } = h.writes[0];
    assert.equal(terminal.legacyPhone, MOBILE);
    assert.equal(terminal.legacyDedupeKey, keyOf(MOBILE));
    // El token de pertenencia y la higiene del id de correlación no cambian.
    assert.equal(terminal.expectedPhoneRevealStatus, 'no_phone_found');
    assert.equal(terminal.requestId, null, 'un null que LIMPIA el id Apollo anterior');
    assert.equal(terminal.revealedBy, ACTOR);
    assert.equal(terminal.attemptCount, 2);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 33 — guardas de MUTACIÓN sobre el camino manual ejecutado
// ═══════════════════════════════════════════════════════════════
//
// Cada guarda ejecuta el camino REAL y compara su resultado contra el que produciría
// la mutación descrita. Si la mutación se colase, el resultado real coincidiría con el
// mutante y la aserción caería. Misma convención que las guardas de 4O-E4.1: se mide
// comportamiento, no se reescribe el fuente.

describe('4O-F · § 33 — mutaciones que tienen que ser detectadas', () => {
  const THREE = [
    { number: WORK, type: 'work' },
    { number: DIRECT, type: 'direct_dial' },
    { number: MOBILE, type: 'mobile' },
  ];

  it('M1 — volver a quedarse SOLO con el primer teléfono de Lusha', async () => {
    const h = manualHarness({ result: clientResult(THREE) });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    const sent = writtenKeys(h.writes[0]);
    // El mutante enviaría exactamente una clave, la del PRIMER elemento del array.
    const mutant = [keyOf(WORK)];
    assert.notDeepEqual(sent.slice().sort(), mutant, 'la mutación «phones[0]» pasó desapercibida');
    assert.equal(sent.length, 3);
  });

  it('M2 — multiplicar el costo por el número de teléfonos', async () => {
    const h = manualHarness({ result: clientResult(THREE) });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    const mutant = 5 * h.writes[0].phones.length;
    assert.notEqual(result.creditsCharged, mutant, 'el costo se multiplicó por la cardinalidad');
    assert.notEqual(h.writes[0].terminal.costCredits, mutant);
    assert.equal(result.creditsCharged, 5, 'el costo es el REPORTADO, por respuesta');
    assert.equal(h.logged.length, 1, 'un evento económico, no uno por teléfono');
  });

  it('M3 — omitir la deduplicación (misma clave para todos los proveedores)', async () => {
    const h = manualHarness({
      result: clientResult([
        { number: MOBILE, type: 'mobile' },
        { number: MOBILE_FORMATTED, type: 'work' },
      ]),
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    // El mutante produciría DOS filas canónicas para el mismo número real, que es
    // exactamente lo que impide que el otro proveedor las reconozca como suyas.
    assert.equal(h.writes[0].phones.length, 1, 'la deduplicación se omitió');
    // Y la clave es la del normalizador COMPARTIDO, no una propia de Lusha.
    assert.equal(h.writes[0].phones[0].dedupeKey, keyOf(MOBILE));
    assert.notEqual(h.writes[0].phones[0].dedupeKey, keyOf(MOBILE_FORMATTED.replace(/\s/g, '')) + ':lusha');
  });

  it('M4 — omitir la re-elección de principal (quedarse con el orden del payload)', async () => {
    const h = manualHarness({ result: clientResult(THREE) });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    const preference = h.writes[0].primaryCandidates.map((c) => c.dedupeKey);
    // El mutante conservaría el orden en que Lusha los mandó.
    const mutant = [keyOf(WORK), keyOf(DIRECT), keyOf(MOBILE)];
    assert.notDeepEqual(preference, mutant, 'el orden del payload decidió el principal');
    assert.deepEqual(preference, [keyOf(MOBILE), keyOf(DIRECT), keyOf(WORK)]);
  });

  it('M5 — permitir que un tombstone resucite', async () => {
    const h = manualHarness({
      result: clientResult([{ number: MOBILE, type: 'mobile' }]),
      write: okWrite({
        status: 'suppressed',
        suppressed_skipped_count: 1,
        primary_persisted: false,
        candidate_scalar_updated: false,
        candidate_terminalized: false,
      }),
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    // El mutante reportaría `revealed` pese a que la transacción no cerró nada, y
    // compensaría con un UPDATE escalar que devolvería el número suprimido a la vista.
    assert.notEqual(result.status, 'revealed', 'un `suppressed` se reportó como revelado');
    assert.equal(h.persisted.length, 0, 'un UPDATE escalar resucitó el número');
  });

  it('M6 — saltarse la puerta de do_not_contact', async () => {
    const h = manualHarness({
      result: clientResult(THREE),
      gate: ['do_not_contact'],
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);

    // El mutante llamaría igualmente y gastaría.
    assert.equal(h.providerCalls, 0, 'se llamó al proveedor pese al do_not_contact');
    assert.notEqual(result.status, 'revealed');
    assert.equal(result.creditsCharged, 0);
  });

  it('M7 — saltarse la puerta de supresión (antes y en vuelo)', async () => {
    const before = manualHarness({ result: clientResult(THREE), gate: ['blocked_suppressed'] });
    await runLushaPhoneFallbackReveal(INPUT, before.deps);
    assert.equal(before.providerCalls, 0, 'se llamó pese a la supresión previa');

    const inFlight = manualHarness({
      result: clientResult(THREE),
      gate: ['clear', 'blocked_suppressed'],
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, inFlight.deps);
    // El mutante escribiría la colección: la transacción no lee `do_not_contact` y la
    // supresión por persona depende de un id que un candidato de Lusha puede no tener.
    assert.equal(inFlight.writes.length, 0, 'se escribió la colección tras una DSAR en vuelo');
    assert.notEqual(result.status, 'revealed');
  });

  it('M8 — dejar que un `work` de Lusha desplace a un móvil mejor ya guardado', async () => {
    const h = manualHarness({
      result: clientResult([{ number: WORK, type: 'work' }]),
      write: okWrite({
        primary_dedupe_key: keyOf(MOBILE),
        candidate_scalar_updated: false,
      }),
    });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);

    // El mutante compensaría el `candidate_scalar_updated: false` escribiendo el
    // escalar por su cuenta, que es justo lo que pondría el `work` delante del móvil.
    assert.equal(h.persisted.length, 0, 'el core sobrescribió un principal mejor');
    assert.equal(h.logged[0].metadata.phone_collection?.candidate_scalar_updated, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 32 / § 36 — cableado del check y deudas que NO cierra 4O-F
// ═══════════════════════════════════════════════════════════════

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const readRepo = (relative: string) => readFileSync(join(repoRoot, relative), 'utf8');

describe('4O-F · § 32 — la suite está cableada al check obligatorio', () => {
  it('los dos scripts existen en package.json', () => {
    const pkg = JSON.parse(readRepo('package.json')) as { scripts: Record<string, string> };
    assert.match(
      pkg.scripts['test:agent2a:manual-lusha-multi-phone'],
      /manual-lusha-multi-phone-4o-f\.test\.ts/,
    );
    assert.match(
      pkg.scripts['test:agent2a:manual-lusha-multi-phone-postgres'],
      /manual-lusha-multi-phone-postgres-4o-f\.test\.ts/,
    );
  });

  it('el workflow ejecuta la suite nueva', () => {
    assert.match(
      readRepo('.github/workflows/automatic-routing-tests.yml'),
      /^\s*run: npm run test:agent2a:manual-lusha-multi-phone\s*$/m,
      'un test que no se cablea no protege nada',
    );
  });

  it('el workflow SIGUE ejecutando E1, E2, E3, E4 y E4.1', () => {
    const workflow = readRepo('.github/workflows/automatic-routing-tests.yml');
    for (const script of [
      // E1 — política terminal de supresión.
      'test:agent2a:phone-suppression-terminal',
      // E2 — propagación DSAR a la colección.
      'test:agent2a:phone-suppression-propagation',
      // E3 — carreras de privacidad y puertas.
      'test:agent2a:phone-privacy-race-gates',
      // E4 — borrado del teléfono del contacto oficial.
      'test:agent2a:contacts-phone-privacy-erasure',
      // E4.1 — procedencia de mobile_phone.
      'test:agent2a:mobile-phone-provenance-erasure',
      'test:agent2a:contact-phone-provenance',
      // 4O-C / 4O-D — las dos colecciones de proveedor.
      'test:agent2a:apollo-phone-collection-capture',
      'test:agent2a:lusha-phone-collection',
      'test:agent2a:candidate-phone-collection',
    ]) {
      assert.ok(workflow.includes(`npm run ${script}`), `${script} debe seguir en el check`);
    }
  });
});

describe('4O-F · § 36 — las deudas fuera de alcance siguen abiertas', () => {
  it('el PRINCIPAL sigue siendo el escalar, y el drawer NO lee la colección por su cuenta', () => {
    // 4O-F declaró esta deuda como abierta y prohibía toda UI de la colección. Cada hito
    // posterior la ha ESTRECHADO en vez de borrarla, y éste hace lo mismo:
    //
    //   * 4O-G cerró la mitad de LECTURA (mostrar los números adicionales ya almacenados en
    //     un disclosure aparte), así que eso dejó de prohibirse aquí;
    //   * AGENT2A-SEARCH-MORE-PHONES-1 cierra la mitad PAGADA. «Buscar más números» ya
    //     existe, está autorizado, y tiene su propia confirmación explícita con proveedor y
    //     techo. La prohibición de su NOMBRE se levanta.
    //
    // Lo que sigue prohibido, y es lo que esta prueba defiende — las dos mitades que ningún
    // hito ha cerrado:
    //   * el drawer NO lee la colección por su cuenta. La lectura vive detrás de una acción
    //     autorizada, nunca en el componente: es lo que impide que la UI se convierta en un
    //     segundo camino a las tablas de la 109;
    //   * el TELÉFONO PRINCIPAL que se muestra arriba sigue siendo el ESCALAR del candidato,
    //     no una elección hecha sobre la colección. Ésta es la mitad que de verdad sigue
    //     abierta, y la que una corrida `search_more` podría romper sin darse cuenta: la 122
    //     sincroniza el escalar sólo cuando el principal cambia legítimamente, así que si el
    //     drawer empezara a elegir por su cuenta las dos autoridades podrían discrepar.
    const detail = readRepo('src/components/contact-enrichment/contact-candidate-detail-sheet.tsx');
    assert.equal(
      detail.includes('contact_enrichment_candidate_phones'),
      false,
      'el drawer no puede nombrar la tabla de la colección: su lectura vive detrás de una acción',
    );
    // El escalar sigue siendo la autoridad del número principal.
    assert.match(detail, /const phoneNumber = candidate\?\.phone \?\? phoneMeta\?\.number \?\? null;/);

    // Y la operación pagada entra por COMPOSICIÓN: el drawer monta el componente, pero no
    // contiene su modal, ni su máquina de estados, ni la invocación que cobra.
    assert.equal(
      detail.includes('CandidateSearchMorePhonesCta'),
      true,
      '«Buscar más números» ya existe, montado como componente propio',
    );
    assert.equal(
      detail.includes('searchMoreCandidatePhonesAction'),
      false,
      'el drawer NO invoca la acción que paga: eso sólo ocurre tras confirmar, dentro del componente',
    );
  });

  // AGENT2A-PHONE-REVEAL-4O-H1 — este guarda se INVIERTE, no se borra.
  //
  // En 4O-F afirmaba que el modelo oficial multi-teléfono NO existía, y eso era una
  // descripción correcta del estado del repo en ese momento:
  // `OFFICIAL_MULTI_PHONE_MODEL_PENDING`. 4O-H1 lo crea —migración 114, `contact_phones`
  // + `contact_phone_sources`, INERTE— así que la afirmación cambia de «no existe» a
  // «existe, y la crea EXACTAMENTE una migración».
  //
  // Lo que se sigue protegiendo, y es lo que importa aquí: que ninguna OTRA migración la
  // cree, y que la aprobación del candidato siga siendo ESCALAR — la propagación de la
  // colección es H3 y sigue pendiente, como comprueba el test siguiente.
  it('sólo la 114 crea `contact_phones`: el esquema oficial tiene una única dueña', () => {
    const creators = readdirSync(join(repoRoot, 'supabase/migrations')).filter((file) =>
      /CREATE TABLE[^;]*\bcontact_phones\b/.test(readRepo(`supabase/migrations/${file}`)),
    );
    assert.deepEqual(creators, ['114_official_contact_phones.sql']);
  });

  it('4O-F no añade migración: el techo lo movió 4O-H3 con la 116', () => {
    // AGENT2A-PHONE-REVEAL-4O-H2 mueve el techo de la 114 a la 115 (la privacidad del
    // esquema oficial: contadores de auditoría + `suppress_official_contact_phone_sources`).
    // 4O-F sigue sin aportar SQL —reutiliza la 111— y eso es lo que esta guarda afirma; el
    // número exacto se mantiene fijado para que nadie cuele una migración inadvertida.
    const numbered = readdirSync(join(repoRoot, 'supabase/migrations'))
      .filter((file) => /^\d{3}_.*\.sql$/.test(file))
      .map((file) => Number(file.slice(0, 3)))
      .sort((a, b) => a - b);
    // AGENT2A-PHONE-REVEAL-4O-H3 mueve el techo de la 115 a la 116 (la APROBACIÓN atómica
    // sobre ese mismo esquema oficial). 4O-F sigue sin aportar SQL.
    // AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 mueve el techo a la 119 (catálogo de
    // Macro Industrias). 4O-F sigue sin aportar SQL.
    // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 (Fase 1) mueve el techo a la 120: la
    // supresión de teléfono por identidad NATIVA del proveedor. 4O-F sigue reutilizando la
    // 111 sin crear SQL nuevo, que es lo que esta guarda afirma.
    // AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 mueve el techo a la 121: la liquidación TRUTHFUL
    // del sobrepaso de presupuesto (Agente 1, contabilidad). No es de teléfono, y 4O-F
    // sigue reutilizando la 111 sin crear SQL nuevo — que es lo que esta guarda afirma.
    // AGENT2A-SEARCH-MORE-PHONES-1 mueve el techo a la 122: «Buscar más números». NO
    // re-declara la 111 —ese es justo el punto: su writer es OTRA función, porque el parche
    // terminal de la 111 sería falso en una corrida `search_more`—, así que 4O-F sigue
    // reutilizando la 111 intacta, que es lo que esta guarda afirma.
    // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1 mueve el techo a la 124: la
    // identidad provider-native del reveal. Tampoco re-declara la 111 —crea una tabla
    // nueva, añade `operation_key` a la reserva y un claim propio a la corrida—, así que
    // 4O-F sigue reutilizando la 111 intacta, que es lo que esta guarda afirma.
    // BR-SOURCE-FUNCTIONAL-CUT-A movió el techo a la 125, y luego a la 126 (identidad MENSUAL
    // del snapshot de Receita; AUTORADA y NO APLICADA). No es de 4O-F y no crea SQL de teléfono.
    // AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY reclamó el 126 de forma independiente mientras la
    // reconciliación de BR-SOURCE CUT A.1 seguía en revisión: el vallado optimista de la
    // admisión por identidad de LOTE (Agente 1). Añade `prospect_batches.identity_epoch` y dos
    // funciones sobre `prospect_batches` y `prospect_candidates`; NO es de teléfono en absoluto
    // y no nombra ninguna tabla, columna ni función de teléfono, que es lo que esta guarda
    // vigila. Trae su propia guarda estática y NO edita ninguna migración anterior. NO aplicada
    // en Producción.
    // BR-SOURCE CUT A.1 RENUMERÓ su propia migración una segunda vez, de 126 a 127, para no
    // colisionar con la de AGENT1-CUT3B4, y dejó sitio a una migración 125 genérica
    // (reconciliación de `record_identity_key` sobre `source_company_snapshots`, fuentes NO
    // brasileñas) — ninguna de las tres es de 4O-F ni de teléfono.
    // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 mueve el techo a la 128: la
    // proyección de la colección de teléfonos de un candidato ya APROBADO al contacto que su
    // aprobación creó. Es de teléfono, pero no de este hito y no toca lo que esta guarda vigila;
    // trae su propia guarda estática. AUTORADA y NO APLICADA.
    // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 mueve el techo a la 132: el tramo 129–132 de
    // la cadena de sincronización con HubSpot de Agente 2 (129 la completitud del estado durable
    // `stale`, 130 su procedencia, 131 la 128 re-emitida para producirlo con procedencia
    // `reveal`, 132 la línea base de los contactos ya vinculados). Las cuatro nacieron sin número
    // a propósito y lo reciben ahora que la disputa 125/126/127 está cerrada. Ninguna de las cuatro
    // re-declara la 111 —la 129 y la 130 re-emiten la 115 y la 117, la 131 la 128 y la 132 sólo
    // escribe `contacts.metadata`—, así que 4O-F sigue reutilizando la 111 intacta, que es lo que
    // esta guarda afirma.
    // BR-PRODUCTION-RELEASE mueve el techo a la 133: `133_br_candidate_identity_promotion.sql`,
    // la promoción VALLADA de la identidad fiscal resuelta de una candidata brasileña
    // (BR-SOURCE CUT D), numerada al volver ese trabajo a GitHub después de haber vivido en local
    // sin número mientras el espacio de nombres estaba en disputa. Crea UNA función
    // (`promote_candidate_fiscal_identity_fenced`) y sus permisos: sin tabla, sin columna, sin
    // índice, sin constraint y sin backfill. NO es de teléfono y no nombra ninguna tabla, columna
    // ni función de teléfono, que es lo que esta guarda vigila. AUTORADA y NO APLICADA.
    // BR-COMPACT-SNAPSHOT-PRODUCTIZATION mueve el techo a la 134:
    // `134_br_receita_compact_snapshot.sql`, la tabla dedicada y particionada del snapshot
    // nacional de Brasil. NO es de teléfono, no nombra ninguna tabla, columna ni función de
    // teléfono, y no edita el archivo de ninguna migración anterior. AUTORADA y NO APLICADA.
    assert.equal(numbered[numbered.length - 1], 134, '4O-F reutiliza la 111 sin crear SQL nuevo');
  });

  // AGENT2A-PHONE-REVEAL-4O-H3 — este guarda se INVIERTE, no se borra.
  //
  // Cuando 4O-F lo escribió afirmaba que la aprobación NO propagaba la colección y que
  // `OFFICIAL_MULTI_PHONE_MODEL_PENDING` seguía abierto. 4O-H3 lo CERRÓ. Lo que sigue siendo
  // cierto —y lo que ahora se fija— es que el PAYLOAD sigue siendo escalar: la colección no
  // viaja por él, porque la transacción de la 116 la lee de la base BAJO EL LOCK. Pasarla por
  // el payload significaría propagar lo que el servidor leyó ANTES de bloquear.
  it('el payload de contacto sigue siendo ESCALAR; la colección la lee la transacción', () => {
    const core = readRepo('src/modules/contact-enrichment/candidate-review-core.ts');
    const payload = core.match(/interface ContactInsertPayload \{([\s\S]*?)\n\}/);
    assert.ok(payload, '`ContactInsertPayload` debe seguir existiendo');
    assert.match(payload[1], /phone: string \| null;/);
    assert.equal(
      /phones\s*:\s*(readonly )?\w+\[\]|phones\s*:\s*Array</.test(payload[1]),
      false,
      'la colección no viaja por el payload: la lee la transacción de la 116 bajo el lock',
    );
    // Y la propagación SÍ existe ahora, en el único sitio que puede garantizarla.
    assert.match(core, /approveTransactionally/);
    const migration = readRepo(
      'supabase/migrations/116_approve_candidate_with_official_phones.sql',
    );
    assert.match(migration, /INSERT INTO public\.contact_phones/);
    assert.match(migration, /INSERT INTO public\.contact_phone_sources/);
  });

  // AGENT2A-PHONE-REVEAL-4O-F-R2 — este guarda se INVIERTE, no se borra.
  //
  // En 4O-F afirmaba que el camino manual no tocaba presupuesto ni reservas. Eso era
  // una descripción del ALCANCE de 4O-F, y la auditoría 4O-F-M0 la reclasificó como el
  // defecto `MANUAL_LUSHA_BUDGET_GATE = UNSAFE`: ACCOUNTING sí, ENFORCEMENT no. R2
  // cierra ese defecto haciendo converger el disparo manual sobre la infraestructura
  // `legacy_lusha_only`, así que ahora SÍ tiene que consumir presupuesto.
  //
  // Lo que se sigue protegiendo, y es lo que importa: HubSpot intacto, y el disparo
  // manual leyendo EXCLUSIVAMENTE su propio flag — nunca
  // `ENABLE_PHONE_REVEAL_WATERFALL`, que sigue apagado en Producción y gobierna la UX
  // del waterfall, no la existencia de la contabilidad.
  it('R2 — el camino manual consume presupuesto, sigue sin tocar HubSpot y no lee el flag del waterfall', () => {
    const actions = readRepo('src/modules/contact-enrichment/lusha-phone-fallback-actions.ts');
    const code = actions.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // HubSpot sigue fuera: converger no acerca esta ruta al CRM.
    assert.equal(
      code.toLowerCase().includes('hubspot'),
      false,
      'el disparo manual no puede tocar HubSpot',
    );

    // El motor económico es el único camino pagado, y es el que trae la reserva.
    assert.ok(
      code.includes('executeLegacyLushaOnlyPhoneReveal'),
      'el disparo manual se ejecuta sobre el motor legacy_lusha_only',
    );

    // Los desenlaces de presupuesto son OBSERVABLES en la acción: si desaparecieran,
    // el gate presupuestal habría vuelto a ser invisible para el operador.
    for (const status of [
      'insufficient_credits',
      'budget_not_configured',
      'credit_balance_unavailable',
      'infrastructure_unavailable',
      'already_attempted',
    ]) {
      assert.ok(
        code.includes(status),
        `el desenlace «${status}» tiene que llegar al llamador`,
      );
    }

    // EL flag: uno y sólo uno. Este assert es el que impide que R2 arrastre la UX del
    // waterfall al disparo manual.
    const flags = actions.match(/is\w+Enabled\(/g) ?? [];
    assert.deepEqual([...new Set(flags)], ['isLushaPhoneRevealFallbackEnabled(']);
    assert.equal(
      actions.includes('isPhoneRevealWaterfallEnabled'),
      false,
      'el disparo manual NO puede depender de ENABLE_PHONE_REVEAL_WATERFALL',
    );
  });

  // El motor tampoco puede leer el flag del waterfall: es la otra mitad del contrato
  // de flags de R2, y vive en un archivo distinto del que comprueba el assert anterior.
  it('R2 — el motor legacy_lusha_only se autoriza con el flag del fallback manual', () => {
    const engine = readRepo(
      'src/modules/contact-enrichment/legacy-lusha-only-reveal-engine.ts',
    );
    assert.ok(engine.includes('isLushaPhoneRevealFallbackEnabled()'));
    assert.equal(
      engine.includes('isPhoneRevealWaterfallEnabled'),
      false,
      'el motor no puede quedar gated tras la UX del waterfall',
    );
    // Y conserva la puerta de privacidad posterior a la respuesta para esta ruta.
    assert.ok(
      engine.includes('manualInvocation: true'),
      'la pata manual conserva su puerta de privacidad en vuelo',
    );
  });
});
