/**
 * Tests — higiene de `phone_reveal_request_id` (Agente 2A ·
 * AGENT2A-PHONE-REVEAL-UI-STATE-1 § 10, caso J)
 *
 * Defecto que cierran: existe al menos una fila histórica con
 * `phone_reveal_provider = 'lusha'` y, en `phone_reveal_request_id`, el id del
 * intento APOLLO anterior. La causa era estructural: el patch de persistencia de
 * Lusha no mencionaba la columna, así que el UPDATE la dejaba intacta.
 *
 * Se verifica en DOS niveles:
 *   1. el resolutor puro (contrato de la regla);
 *   2. los CINCO caminos de persistencia del core de Lusha, con deps inyectadas
 *      — para que ninguno pueda volver a omitir la columna.
 *
 * Este hito NO repara filas históricas: eso sería un backfill, explícitamente
 * fuera de alcance. Aquí solo se corrige la persistencia FUTURA.
 *
 * Sin red, sin DB, sin proveedores: todas las deps son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFinalPhoneRevealRequestId } from '../phone-reveal-request-id-hygiene';
import {
  runLushaPhoneFallbackReveal,
  type LushaPhoneFallbackCoreDeps,
  type LushaPhoneFallbackPersistencePatch,
} from '../lusha-phone-fallback-core';

// ── 1. Resolutor puro ────────────────────────────────────────────

describe('UI-STATE-1 § 10 — resolveFinalPhoneRevealRequestId', () => {
  it('Apollo con id válido conserva ese id', () => {
    assert.equal(
      resolveFinalPhoneRevealRequestId({
        provider: 'apollo',
        providerRequestId: 'abc123',
      }),
      'abc123',
    );
  });

  it('Lusha con id válido persiste el id de LUSHA', () => {
    assert.equal(
      resolveFinalPhoneRevealRequestId({
        provider: 'lusha',
        providerRequestId: 'lusha-req-7',
      }),
      'lusha-req-7',
    );
  });

  it('sin id entregado por el proveedor ⇒ null', () => {
    for (const value of [null, undefined, '', '   ']) {
      assert.equal(
        resolveFinalPhoneRevealRequestId({
          provider: 'lusha',
          providerRequestId: value,
        }),
        null,
        String(value),
      );
    }
  });

  it('nunca inventa ni deriva un id de otra fuente', () => {
    // El único origen posible del resultado es `providerRequestId`. No hay forma de
    // pedirle "conserva el anterior": ese era exactamente el bug.
    const result = resolveFinalPhoneRevealRequestId({
      provider: 'lusha',
      providerRequestId: null,
    });
    assert.equal(result, null);
  });

  it('recorta espacios y rechaza ids absurdamente largos', () => {
    assert.equal(
      resolveFinalPhoneRevealRequestId({ provider: 'apollo', providerRequestId: '  x  ' }),
      'x',
    );
    assert.equal(
      resolveFinalPhoneRevealRequestId({
        provider: 'apollo',
        providerRequestId: 'y'.repeat(1000),
      }),
      null,
    );
  });
});

// ── 2. Los cinco caminos de persistencia del core de Lusha ───────

const APOLLO_REQUEST_ID_FROM_EARLIER_ATTEMPT = 'apollo-req-anterior';

interface Harness {
  readonly deps: LushaPhoneFallbackCoreDeps;
  readonly patches: LushaPhoneFallbackPersistencePatch[];
}

function makeHarness(
  callLusha: LushaPhoneFallbackCoreDeps['callLusha'],
  overrides: Partial<LushaPhoneFallbackCoreDeps> = {},
): Harness {
  const patches: LushaPhoneFallbackPersistencePatch[] = [];
  const deps: LushaPhoneFallbackCoreDeps = {
    flagEnabled: true,
    actor: { internalUserId: 'user-1', roleKey: 'admin' },
    nowIso: '2026-08-04T12:00:00.000Z',
    // Candidato Lusha cuyo intento APOLLO ya terminó `no_phone_found`: el estado
    // real de la fila que producía la incoherencia. Nótese que el record NI SIQUIERA
    // expone el `phone_reveal_request_id` previo — el core no puede propagarlo
    // aunque quisiera. Justo por eso el arreglo tiene que ser POSITIVO: el patch
    // debe escribir la columna con `null` para que el UPDATE pise el id Apollo que
    // sigue en la fila. Omitirla es lo que lo dejaba sobrevivir.
    loadCandidate: async () => ({
      id: 'cand-1',
      status: 'pending_review',
      source: 'lusha',
      sourceContactId: 'v1.token-ficticio',
      existingPhone: null,
      phoneRevealStatus: 'no_phone_found',
      phoneRevealAttemptCount: 1,
      enrichmentMetadata: {},
    }),
    callLusha,
    persist: async (_candidateId, patch) => {
      patches.push(patch);
    },
    logUsage: async () => {},
    ...overrides,
  };
  return { deps, patches };
}

async function runAndCapture(
  callLusha: LushaPhoneFallbackCoreDeps['callLusha'],
  overrides: Partial<LushaPhoneFallbackCoreDeps> = {},
): Promise<LushaPhoneFallbackPersistencePatch[]> {
  const { deps, patches } = makeHarness(callLusha, overrides);
  // `confirmCost: true` es obligatorio: sin la confirmación explícita de gasto el
  // gate canónico corta en `missing_cost_confirmation` ANTES de llamar a Lusha —
  // invariante de LUSHA-PHONE-FALLBACK-1 que este hito no toca.
  const result = await runLushaPhoneFallbackReveal(
    { candidateId: 'cand-1', confirmCost: true },
    deps,
  );
  assert.notEqual(
    result.status,
    'missing_cost_confirmation',
    'el harness debe llegar al camino de persistencia, no morir en el gate',
  );
  return patches;
}

/** El assert central del § 10, aplicado a cada camino. */
function assertRequestIdHygiene(patch: LushaPhoneFallbackPersistencePatch): void {
  assert.equal(patch.phone_reveal_provider, 'lusha', 'el proveedor final es Lusha');
  assert.ok(
    'phone_reveal_request_id' in patch,
    'la columna debe formar parte del patch: omitirla es lo que dejaba el id Apollo',
  );
  assert.notEqual(
    patch.phone_reveal_request_id,
    APOLLO_REQUEST_ID_FROM_EARLIER_ATTEMPT,
    'un id Apollo anterior NUNCA puede sobrevivir a un desenlace Lusha',
  );
  assert.equal(
    patch.phone_reveal_request_id,
    null,
    'Lusha no entrega id de seguimiento (respuesta síncrona) ⇒ null',
  );
}

describe('UI-STATE-1 § 10 — persistencia Lusha (caso J)', () => {
  it('Lusha revealed: elimina el id Apollo anterior', async () => {
    const patches = await runAndCapture(async () => ({
      ok: true,
      httpStatus: 200,
      phoneNumber: '+570000000000',
      phoneType: 'mobile',
      phoneRawType: 'mobile',
      creditsCharged: 1,
      candidateStatus: 'revealed',
      usageStatus: 'success',
      errorCode: null,
      costSource: 'reported',
    }) as never);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].phone_reveal_status, 'revealed');
    assertRequestIdHygiene(patches[0]);
  });

  it('Lusha no_phone_found: elimina el id Apollo anterior', async () => {
    const patches = await runAndCapture(async () => ({
      ok: true,
      httpStatus: 200,
      phoneNumber: null,
      phoneType: 'unknown',
      phoneRawType: null,
      creditsCharged: 0,
      candidateStatus: 'no_phone_found',
      usageStatus: 'success',
      errorCode: null,
      costSource: 'reported',
    }) as never);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].phone_reveal_status, 'no_phone_found');
    assertRequestIdHygiene(patches[0]);
  });

  it('error terminal de Lusha (HTTP mapeado): elimina el id Apollo anterior', async () => {
    const patches = await runAndCapture(async () => ({
      ok: true,
      httpStatus: 402,
      phoneNumber: null,
      phoneType: 'unknown',
      phoneRawType: null,
      creditsCharged: null,
      candidateStatus: 'error',
      usageStatus: 'quota_exceeded',
      errorCode: 'provider_quota_exceeded',
      costSource: 'unknown',
    }) as never);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].phone_reveal_status, 'error');
    assertRequestIdHygiene(patches[0]);
  });

  it('fallo de red de Lusha: elimina el id Apollo anterior', async () => {
    const patches = await runAndCapture(async () => ({
      ok: false,
      errorMessage: 'timeout ficticio',
    }) as never);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].phone_reveal_error_code, 'provider_network_error');
    assertRequestIdHygiene(patches[0]);
  });

  it('respuesta malformada (revealed sin número): elimina el id Apollo anterior', async () => {
    const patches = await runAndCapture(async () => ({
      ok: true,
      httpStatus: 200,
      phoneNumber: null,
      phoneType: 'unknown',
      phoneRawType: null,
      creditsCharged: null,
      candidateStatus: 'revealed',
      usageStatus: 'success',
      errorCode: null,
      costSource: 'unknown',
    }) as never);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].phone_reveal_error_code, 'malformed_provider_response');
    assertRequestIdHygiene(patches[0]);
  });

  it('en modo waterfall el camino revealed también limpia el id', async () => {
    // La 2ª pata del waterfall es justo donde un id Apollo huérfano quedaría
    // conviviendo con provider `lusha`: Apollo intentó primero en la MISMA corrida.
    const patches = await runAndCapture(
      async () =>
        ({
          ok: true,
          httpStatus: 200,
          phoneNumber: '+570000000001',
          phoneType: 'mobile',
          phoneRawType: 'mobile',
          creditsCharged: 1,
          candidateStatus: 'revealed',
          usageStatus: 'success',
          errorCode: null,
          costSource: 'reported',
        }) as never,
      { waterfallMode: true, phoneRevealWaterfallId: 'run-1' },
    );
    assert.equal(patches.length, 1);
    assertRequestIdHygiene(patches[0]);
  });

  it('en modo waterfall los caminos SIN teléfono no tocan el candidato', async () => {
    // Invariante preexistente de WATERFALL-1 que este hito NO debe alterar: un
    // `no_phone_found` de la 2ª pata no pisa el estado del candidato (Apollo ya lo
    // cerró). Si no se persiste nada, tampoco se toca el id — correcto.
    const patches = await runAndCapture(
      async () =>
        ({
          ok: true,
          httpStatus: 200,
          phoneNumber: null,
          phoneType: 'unknown',
          phoneRawType: null,
          creditsCharged: 0,
          candidateStatus: 'no_phone_found',
          usageStatus: 'success',
          errorCode: null,
          costSource: 'reported',
        }) as never,
      { waterfallMode: true, phoneRevealWaterfallId: 'run-1' },
    );
    assert.equal(patches.length, 0, 'waterfallMode suprime la escritura sin teléfono');
  });
});
