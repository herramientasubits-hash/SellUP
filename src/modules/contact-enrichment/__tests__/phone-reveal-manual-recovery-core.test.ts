/**
 * Agente 2A — Apollo Phone Reveal RECOVERY L3: elegibilidad PURA
 * (APOLLO-PHONE-RECOVERY-L3)
 *
 * Cubre la ventana de la revisión manual desde el sidepanel:
 *   * gate de rol (mismo criterio que el Phone Reveal: admin / manager comercial),
 *   * Apollo-only, solo estados en vuelo, sin teléfono ya persistido,
 *   * id de correlación obligatorio,
 *   * ventana de 2 min desde la solicitud y anti-abuso de 60 s entre revisiones,
 *   * detección de payload "todavía procesando" + `retry_after_seconds`,
 *   * contratos estáticos (sin imports de servidor en el núcleo compartido con el
 *     bundle cliente; las listas no derivan de las del pipeline de reveal).
 *
 * 100% puro: sin red, sin Supabase, sin env. NINGUNA llamada a Apollo ni a Lusha.
 * Los fixtures no contienen teléfonos, emails, nombres ni empresas reales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  evaluateManualRecoveryEligibility,
  isManualRecoveryAuthorized,
  isManualRecoveryRequestWindowOpen,
  MANUAL_RECOVERY_AUTHORIZED_ROLE_KEYS,
  MANUAL_RECOVERY_IN_FLIGHT_STATUSES,
  MANUAL_RECOVERY_MIN_RECHECK_INTERVAL_SECONDS,
  MANUAL_RECOVERY_MIN_REQUEST_AGE_SECONDS,
  type ManualRecoveryActor,
  type ManualRecoveryCandidateSnapshot,
} from '../phone-reveal-manual-recovery-core';
import {
  extractRetryAfterSeconds,
  isPendingWebhookResultPayload,
} from '../phone-reveal-recovery-core';
import { PHONE_REVEAL_AUTHORIZED_ROLE_KEYS } from '../phone-reveal-core';
import { POLLABLE_STATUSES } from '../phone-reveal-poll-core';
import type { ApolloPhoneRevealWebhookPayload } from '../phone-reveal-webhook-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = join(HERE, '..');

const NOW = '2026-07-30T18:00:00.000Z';

/** Desplaza `NOW` hacia atrás n segundos (para simular antigüedades). */
function agoIso(seconds: number): string {
  return new Date(Date.parse(NOW) - seconds * 1000).toISOString();
}

const ADMIN: ManualRecoveryActor = { internalUserId: 'user-1', roleKey: 'admin' };
const MANAGER: ManualRecoveryActor = {
  internalUserId: 'user-2',
  roleKey: 'commercial_manager',
};
const SELLER: ManualRecoveryActor = { internalUserId: 'user-3', roleKey: 'seller' };
const LEAD: ManualRecoveryActor = { internalUserId: 'user-4', roleKey: 'lead' };
const ANON: ManualRecoveryActor = { internalUserId: null, roleKey: null };

function snapshot(
  overrides: Partial<ManualRecoveryCandidateSnapshot> = {},
): ManualRecoveryCandidateSnapshot {
  return {
    phoneRevealProvider: 'apollo',
    phoneRevealStatus: 'requested',
    hasPhone: false,
    recoveryIdPresent: true,
    // 10 min: holgadamente por encima de la ventana de 2 min.
    requestedAtIso: agoIso(600),
    lastCheckedAtIso: null,
    ...overrides,
  };
}

function evaluate(
  overrides: Partial<ManualRecoveryCandidateSnapshot> = {},
  actor: ManualRecoveryActor = ADMIN,
) {
  return evaluateManualRecoveryEligibility({
    actor,
    snapshot: snapshot(overrides),
    nowIso: NOW,
  });
}

// ═══════════════════════════════════════════════════════════════
// 1. Constantes y contratos compartidos
// ═══════════════════════════════════════════════════════════════

describe('L3 — constantes de la ventana', () => {
  it('la ventana mínima desde la solicitud es de 2 minutos', () => {
    assert.equal(MANUAL_RECOVERY_MIN_REQUEST_AGE_SECONDS, 120);
  });

  it('el intervalo anti-abuso entre revisiones es de 60 s', () => {
    assert.equal(MANUAL_RECOVERY_MIN_RECHECK_INTERVAL_SECONDS, 60);
  });

  it('los roles autorizados son los MISMOS del Phone Reveal (sin derivar)', () => {
    assert.deepEqual(
      [...MANUAL_RECOVERY_AUTHORIZED_ROLE_KEYS],
      [...PHONE_REVEAL_AUTHORIZED_ROLE_KEYS],
    );
  });

  it('los estados en vuelo son los MISMOS que los pollables (sin derivar)', () => {
    assert.deepEqual(
      [...MANUAL_RECOVERY_IN_FLIGHT_STATUSES],
      [...POLLABLE_STATUSES],
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Gate de rol
// ═══════════════════════════════════════════════════════════════

describe('L3 — gate de rol', () => {
  it('admin y manager comercial están autorizados', () => {
    assert.equal(isManualRecoveryAuthorized(ADMIN), true);
    assert.equal(isManualRecoveryAuthorized(MANAGER), true);
  });

  it('seller, lead y anónimo NO están autorizados (fail-closed)', () => {
    assert.equal(isManualRecoveryAuthorized(SELLER), false);
    assert.equal(isManualRecoveryAuthorized(LEAD), false);
    assert.equal(isManualRecoveryAuthorized(ANON), false);
  });

  it('rol autorizado sin id de usuario resuelto tampoco pasa', () => {
    assert.equal(
      isManualRecoveryAuthorized({ internalUserId: null, roleKey: 'admin' }),
      false,
    );
    assert.equal(
      isManualRecoveryAuthorized({ internalUserId: '   ', roleKey: 'admin' }),
      false,
    );
  });

  it('el rol se evalúa ANTES que cualquier otro gate', () => {
    // Candidato inelegible por todo lo demás: el motivo sigue siendo el rol.
    const result = evaluateManualRecoveryEligibility({
      actor: SELLER,
      snapshot: snapshot({
        phoneRevealProvider: 'lusha',
        phoneRevealStatus: 'revealed',
        hasPhone: true,
        recoveryIdPresent: false,
        requestedAtIso: null,
      }),
      nowIso: NOW,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'unauthorized_role');
    assert.equal(result.retryAfterSeconds, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Gates estructurales
// ═══════════════════════════════════════════════════════════════

describe('L3 — proveedor, estado y teléfono', () => {
  it('acepta el caso base (apollo, requested, sin teléfono, con id, 10 min)', () => {
    const result = evaluate();
    assert.equal(result.eligible, true);
    assert.equal(result.reason, null);
    assert.equal(result.retryAfterSeconds, null);
  });

  it('acepta también `pending`', () => {
    assert.equal(evaluate({ phoneRevealStatus: 'pending' }).eligible, true);
  });

  it('rechaza proveedores que no son Apollo', () => {
    for (const provider of ['lusha', 'LUSHA', null, '', '   ']) {
      const result = evaluate({ phoneRevealProvider: provider });
      assert.equal(result.eligible, false, `provider ${String(provider)}`);
      assert.equal(result.reason, 'not_apollo_provider');
    }
  });

  it('rechaza candidatos TERMINALES (revealed / no_phone_found / error)', () => {
    for (const status of ['revealed', 'no_phone_found', 'error']) {
      const result = evaluate({ phoneRevealStatus: status });
      assert.equal(result.eligible, false, `status ${status}`);
      assert.equal(result.reason, 'not_in_flight');
      assert.equal(result.retryAfterSeconds, null);
    }
  });

  it('rechaza estados desconocidos, vacíos o nulos (fail-closed)', () => {
    for (const status of [null, '', '   ', 'blocked', 'disabled', 'cache']) {
      const result = evaluate({ phoneRevealStatus: status });
      assert.equal(result.eligible, false, `status ${String(status)}`);
      assert.equal(result.reason, 'not_in_flight');
    }
  });

  it('rechaza si el candidato ya tiene teléfono persistido', () => {
    const result = evaluate({ hasPhone: true });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'already_has_phone');
  });

  it('rechaza si no hay id de correlación con el que recuperar', () => {
    const result = evaluate({ recoveryIdPresent: false });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'missing_recovery_request_id');
    assert.equal(result.retryAfterSeconds, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Ventana de 2 min desde la solicitud
// ═══════════════════════════════════════════════════════════════

describe('L3 — ventana de 2 min', () => {
  it('rechaza un reveal solicitado hace menos de 2 min, con los segundos que faltan', () => {
    const result = evaluate({ requestedAtIso: agoIso(30) });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'requested_too_recently');
    assert.equal(result.retryAfterSeconds, 90);
  });

  it('acepta exactamente en el límite de 120 s', () => {
    assert.equal(evaluate({ requestedAtIso: agoIso(120) }).eligible, true);
  });

  it('rechaza justo por debajo del límite', () => {
    const result = evaluate({ requestedAtIso: agoIso(119) });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'requested_too_recently');
    assert.equal(result.retryAfterSeconds, 1);
  });

  it('sin marca de solicitud bloquea sin inventar espera (legacy, fail-closed)', () => {
    const result = evaluate({ requestedAtIso: null });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'requested_too_recently');
    assert.equal(result.retryAfterSeconds, null);
  });

  it('una marca no parseable se trata como ausente', () => {
    const result = evaluate({ requestedAtIso: 'no-es-una-fecha' });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'requested_too_recently');
  });
});

describe('L3 — helper de ventana compartido con la UI', () => {
  it('true solo cuando ya pasaron 2 min', () => {
    assert.equal(isManualRecoveryRequestWindowOpen(agoIso(600), NOW), true);
    assert.equal(isManualRecoveryRequestWindowOpen(agoIso(120), NOW), true);
    assert.equal(isManualRecoveryRequestWindowOpen(agoIso(119), NOW), false);
    assert.equal(isManualRecoveryRequestWindowOpen(agoIso(0), NOW), false);
  });

  it('null / basura ⇒ false (la UI no ofrece el CTA)', () => {
    assert.equal(isManualRecoveryRequestWindowOpen(null, NOW), false);
    assert.equal(isManualRecoveryRequestWindowOpen('   ', NOW), false);
    assert.equal(isManualRecoveryRequestWindowOpen('mañana', NOW), false);
  });

  it('coincide con el veredicto del evaluador completo (no pueden discrepar)', () => {
    for (const seconds of [0, 60, 119, 120, 121, 600]) {
      const requestedAtIso = agoIso(seconds);
      const windowOpen = isManualRecoveryRequestWindowOpen(requestedAtIso, NOW);
      const full = evaluate({ requestedAtIso });
      assert.equal(full.eligible, windowOpen, `antigüedad ${seconds}s`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Anti-abuso entre revisiones
// ═══════════════════════════════════════════════════════════════

describe('L3 — anti-abuso (60 s entre revisiones)', () => {
  it('rechaza una segunda revisión dentro de la ventana, con los segundos restantes', () => {
    const result = evaluate({ lastCheckedAtIso: agoIso(10) });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'checked_too_recently');
    assert.equal(result.retryAfterSeconds, 50);
  });

  it('acepta cuando la última revisión ya superó los 60 s', () => {
    assert.equal(evaluate({ lastCheckedAtIso: agoIso(60) }).eligible, true);
    assert.equal(evaluate({ lastCheckedAtIso: agoIso(3600) }).eligible, true);
  });

  it('sin revisión previa la ventana está abierta', () => {
    assert.equal(evaluate({ lastCheckedAtIso: null }).eligible, true);
  });

  it('el bloqueo por revisión reciente no pisa a los estructurales', () => {
    const result = evaluate({ lastCheckedAtIso: agoIso(5), hasPhone: true });
    assert.equal(result.reason, 'already_has_phone');
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Payload "todavía procesando" (contrato Apollo Support)
// ═══════════════════════════════════════════════════════════════

describe('L3 — payload pendiente y retry_after_seconds', () => {
  const pendingPayloads: ApolloPhoneRevealWebhookPayload[] = [
    { status: 'pending', retry_after_seconds: 10 },
    { status: 'PROCESSING' },
    { state: 'queued' },
    { phone_enrichment: { status: 'in_progress' } },
    { retry_after_seconds: 10 },
    { retry_after_seconds: '10' },
  ];

  it('detecta las variantes pendientes documentadas', () => {
    for (const payload of pendingPayloads) {
      assert.equal(
        isPendingWebhookResultPayload(payload),
        true,
        JSON.stringify(payload),
      );
    }
  });

  it('NO trata como pendiente un resultado real ni un payload vacío', () => {
    assert.equal(isPendingWebhookResultPayload({}), false);
    assert.equal(isPendingWebhookResultPayload(null), false);
    assert.equal(isPendingWebhookResultPayload({ status: 'completed' }), false);
    assert.equal(isPendingWebhookResultPayload({ phone_numbers: [] }), false);
    assert.equal(
      isPendingWebhookResultPayload({ status: 'finished', request_id: 'x' }),
      false,
    );
  });

  it('extrae retry_after_seconds solo si es un entero plausible', () => {
    assert.equal(extractRetryAfterSeconds({ retry_after_seconds: 10 }), 10);
    assert.equal(extractRetryAfterSeconds({ retry_after_seconds: '10' }), 10);
    assert.equal(extractRetryAfterSeconds({ retry_after_seconds: 10.9 }), 10);
    assert.equal(
      extractRetryAfterSeconds({ phone_enrichment: { retry_after_seconds: 30 } }),
      30,
    );
    for (const bad of [0, -5, 4000, Number.NaN, 'pronto', null, undefined]) {
      assert.equal(
        extractRetryAfterSeconds({
          retry_after_seconds: bad as number | string | null,
        }),
        null,
        `valor ${String(bad)}`,
      );
    }
    assert.equal(extractRetryAfterSeconds(null), null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Contrato estático del núcleo compartido
// ═══════════════════════════════════════════════════════════════

describe('L3 — contrato estático del núcleo', () => {
  const source = readFileSync(
    join(MODULE_DIR, 'phone-reveal-manual-recovery-core.ts'),
    'utf8',
  );

  it('no tiene imports en tiempo de ejecución (seguro en el bundle cliente)', () => {
    const runtimeImports = source
      .split('\n')
      .filter((line) => /^\s*import\s+/.test(line) && !/^\s*import\s+type\s/.test(line));
    assert.deepEqual(runtimeImports, []);
  });

  /** Código sin comentarios: la cabecera SÍ nombra lo que el módulo no hace. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('no toca red, Supabase, env ni consola', () => {
    for (const forbidden of [
      'fetch(',
      'supabase',
      'process.env',
      'console.',
      'apollo-client',
      'lusha',
      'hubspot',
    ]) {
      assert.ok(
        !code.toLowerCase().includes(forbidden.toLowerCase()),
        `el núcleo no debe usar ${forbidden}`,
      );
    }
  });
});
