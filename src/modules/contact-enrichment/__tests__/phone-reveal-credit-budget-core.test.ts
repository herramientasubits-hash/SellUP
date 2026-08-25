// Tests — preflight PURO de saldo del reveal de teléfono
// (Agente 2A · AGENT2A-PHONE-WATERFALL-4D)
//
// OFFLINE por construcción: el módulo bajo prueba no tiene I/O, así que aquí no hay
// red, ni DB, ni Apollo, ni Lusha, ni un solo crédito. El saldo se inyecta como dato.
//
// Lo que se fija es lo que cuesta dinero si se rompe:
//   * el tope exigido por modalidad (13 / 8 / 5) y que sea el del core del waterfall;
//   * que un saldo que no alcanza BLOQUEE (no que "avise");
//   * que un saldo NO verificable bloquee igual (fail-closed) pero con un desenlace
//     distinto: "no se pudo comprobar" no es "no hay créditos";
//   * que la combinación entre proveedores sea la conservadora.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluatePhoneRevealCreditBudget,
  resolvePhoneRevealCreditBudgetMode,
  resolvePhoneRevealCreditBudgetProviders,
  resolvePhoneRevealCreditBudgetRequiredCredits,
  resolvePhoneRevealCreditRequirements,
  PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS,
  PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_REQUIRED_CREDITS,
  PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
  PHONE_REVEAL_CREDIT_BUDGET_MODEL,
  type PhoneRevealCreditBudgetInput,
  type PhoneRevealCreditPoolState,
} from '../phone-reveal-credit-budget-core';
import {
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
} from '../phone-reveal-waterfall-core';

// ═══════════════════════════════════════════════════════════════
// 1. Topes: espejo del core del waterfall (autoridad real)
// ═══════════════════════════════════════════════════════════════

describe('preflight de saldo — topes alineados con el core del waterfall', () => {
  test('waterfall completo exige 13, y 13 es el tope del core', () => {
    assert.equal(PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_REQUIRED_CREDITS, 13);
    assert.equal(
      PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_REQUIRED_CREDITS,
      PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
    );
  });

  test('Apollo-only exige 8, y 8 es el tope de la pata Apollo del core', () => {
    assert.equal(PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS, 8);
    assert.equal(
      PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS,
      PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
    );
  });

  test('legacy exige 5, y 5 es el tope legacy del core (jamás 13 ni 8)', () => {
    assert.equal(PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS, 5);
    assert.equal(
      PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
    );
  });

  test('el tope por modalidad se resuelve exactamente a 13 / 8 / 5', () => {
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits('full_waterfall'), 13);
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits('apollo_only'), 8);
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits('legacy_lusha_only'), 5);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Modalidad y proveedores implicados
// ═══════════════════════════════════════════════════════════════

describe('preflight de saldo — modalidad y proveedores', () => {
  test('legacy manda sobre la elegibilidad de Lusha', () => {
    assert.equal(
      resolvePhoneRevealCreditBudgetMode({ legacyLushaOnly: true, lushaEligible: true }),
      'legacy_lusha_only',
    );
  });

  test('sin id Lusha la modalidad es Apollo-only (tope 8, no 13)', () => {
    assert.equal(
      resolvePhoneRevealCreditBudgetMode({
        legacyLushaOnly: false,
        lushaEligible: false,
      }),
      'apollo_only',
    );
  });

  test('con la identidad Lusha YA resuelta la modalidad es el waterfall completo (tope 13)', () => {
    assert.equal(
      resolvePhoneRevealCreditBudgetMode({
        legacyLushaOnly: false,
        lushaEligible: true,
        lushaIdentityResolved: true,
      }),
      'full_waterfall',
    );
  });

  test('sin identidad resuelta hay que pagar la búsqueda primero (tope 14)', () => {
    // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1. Es el candidato nacido en
    // Apollo: alcanzable por Lusha solo tras averiguar con qué id lo conoce.
    assert.equal(
      resolvePhoneRevealCreditBudgetMode({
        legacyLushaOnly: false,
        lushaEligible: true,
        lushaIdentityResolved: false,
      }),
      'full_waterfall_with_identity_search',
    );
  });

  test('omitir la señal de identidad reserva de MÁS, nunca de menos', () => {
    // Fail-closed económico: sin saber si la identidad está resuelta, la modalidad
    // asume que hay que pagarla. Reservar 13 y luego necesitar 14 dejaría la segunda
    // pata autorizada sin saldo, y el servidor la ejecuta sin volver a preguntar.
    assert.equal(
      resolvePhoneRevealCreditBudgetMode({ legacyLushaOnly: false, lushaEligible: true }),
      'full_waterfall_with_identity_search',
    );
  });

  test('cada modalidad consulta SOLO los proveedores que puede llegar a llamar', () => {
    assert.deepEqual(resolvePhoneRevealCreditBudgetProviders('full_waterfall'), [
      'apollo',
      'lusha',
    ]);
    assert.deepEqual(resolvePhoneRevealCreditBudgetProviders('apollo_only'), ['apollo']);
    // Apollo NO se ejecuta en legacy: bloquear por su saldo bloquearía por un
    // proveedor que no va a correr.
    assert.deepEqual(resolvePhoneRevealCreditBudgetProviders('legacy_lusha_only'), [
      'lusha',
    ]);
  });
});


// ═══════════════════════════════════════════════════════════════
// 3. Desglose por pata: el modelo es POR PROVEEDOR
// ═══════════════════════════════════════════════════════════════

describe('preflight — patas exigidas por modalidad (per-provider)', () => {
  // Desde AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1 cada pata declara TAMBIÉN
  // su operación: el proveedor dejó de bastar como identidad en cuanto Lusha pasó a
  // poder cobrar dos cosas distintas dentro de la misma autorización.
  test('el waterfall completo exige DOS patas: Apollo 8 y Lusha 5, ambas de reveal', () => {
    assert.deepEqual(resolvePhoneRevealCreditRequirements('full_waterfall'), [
      { providerKey: 'apollo', operationKey: 'phone_reveal', credits: 8 },
      { providerKey: 'lusha', operationKey: 'phone_reveal', credits: 5 },
    ]);
  });

  test('con búsqueda de identidad exige TRES patas: 8 + 1 + 5', () => {
    assert.deepEqual(
      resolvePhoneRevealCreditRequirements('full_waterfall_with_identity_search'),
      [
        { providerKey: 'apollo', operationKey: 'phone_reveal', credits: 8 },
        { providerKey: 'lusha', operationKey: 'contact_search', credits: 1 },
        { providerKey: 'lusha', operationKey: 'phone_reveal', credits: 5 },
      ],
    );
  });

  test('Apollo-only exige UNA pata de 8 y no nombra a Lusha', () => {
    assert.deepEqual(resolvePhoneRevealCreditRequirements('apollo_only'), [
      { providerKey: 'apollo', operationKey: 'phone_reveal', credits: 8 },
    ]);
  });

  test('legacy exige UNA pata de 5 contra LUSHA, jamás contra Apollo', () => {
    assert.deepEqual(resolvePhoneRevealCreditRequirements('legacy_lusha_only'), [
      { providerKey: 'lusha', operationKey: 'phone_reveal', credits: 5 },
    ]);
  });

  test('el total sigue siendo 13 / 8 / 5: es la SUMA de las patas', () => {
    for (const [mode, total] of [
      ['full_waterfall', 13],
      ['apollo_only', 8],
      ['legacy_lusha_only', 5],
    ] as const) {
      assert.equal(
        resolvePhoneRevealCreditRequirements(mode).reduce((s, l) => s + l.credits, 0),
        total,
        mode,
      );
      assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits(mode), total, mode);
    }
  });

  test('el modelo VIGENTE declarado es per_provider', () => {
    // Si esto cambia, `evaluatePhoneRevealCreditBudget` tiene otra rama con otra
    // aritmética y el cambio tiene que ser una decisión explícita, no un efecto.
    assert.equal(PHONE_REVEAL_CREDIT_BUDGET_MODEL, 'per_provider');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Decisión per-provider: cada pata contra SU pozo
// ═══════════════════════════════════════════════════════════════

function pool(
  available: number,
  reserved = 0,
): Extract<PhoneRevealCreditPoolState, { kind: 'configured' }> {
  return {
    kind: 'configured',
    limitCredits: available + reserved,
    consumedCredits: 0,
    reservedCredits: reserved,
    scopeType: 'global',
    scopeId: null,
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-08-31T23:59:59.999Z',
  };
}

function perProvider(
  states: Partial<Record<'apollo' | 'lusha', PhoneRevealCreditPoolState>>,
): PhoneRevealCreditBudgetInput {
  return {
    model: 'per_provider',
    pools: Object.entries(states).map(([providerKey, state]) => ({
      providerKey: providerKey as 'apollo' | 'lusha',
      state: state as PhoneRevealCreditPoolState,
    })),
  };
}

describe('preflight per-provider — cada pata contra su propio pozo', () => {
  test('Apollo 8 y Lusha 5 autorizan el waterfall completo aunque NINGUNO llegue a 13', () => {
    // Este es el caso que el "mínimo genérico" de 4D rechazaba: min(8,5)=5 < 13. En el
    // modelo real cada pata sale de su propia regla, y las dos alcanzan.
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'full_waterfall',
      budget: perProvider({ apollo: pool(8), lusha: pool(5) }),
    });
    assert.equal(verdict.decision, 'authorized');
    assert.equal(verdict.requiredCredits, 13);
    assert.deepEqual(
      verdict.legs.map((l) => [l.providerKey, l.requiredCredits, l.availableCredits]),
      [
        ['apollo', 8, 8],
        ['lusha', 5, 5],
      ],
    );
  });

  test('Apollo con 7 bloquea aunque Lusha tenga 500: la pata que falla es la de Apollo', () => {
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'full_waterfall',
      budget: perProvider({ apollo: pool(7), lusha: pool(500) }),
    });
    assert.equal(verdict.decision, 'insufficient_credits');
    assert.equal(
      verdict.legs.find((l) => l.providerKey === 'apollo')?.decision,
      'insufficient_credits',
    );
    assert.equal(
      verdict.legs.find((l) => l.providerKey === 'lusha')?.decision,
      'authorized',
    );
  });

  test('Lusha con 4 bloquea aunque Apollo tenga de sobra: la 2ª pata ya está autorizada', () => {
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'full_waterfall',
      budget: perProvider({ apollo: pool(1_000), lusha: pool(4) }),
    });
    assert.equal(verdict.decision, 'insufficient_credits');
  });

  test('pozo con 5: bloquea completo (Apollo 8) y Apollo-only (8), permite legacy (5)', () => {
    // El escenario obligatorio del contrato, con la aritmética correcta.
    assert.equal(
      evaluatePhoneRevealCreditBudget({
        mode: 'full_waterfall',
        budget: perProvider({ apollo: pool(5), lusha: pool(5) }),
      }).decision,
      'insufficient_credits',
    );
    assert.equal(
      evaluatePhoneRevealCreditBudget({
        mode: 'apollo_only',
        budget: perProvider({ apollo: pool(5) }),
      }).decision,
      'insufficient_credits',
    );
    assert.equal(
      evaluatePhoneRevealCreditBudget({
        mode: 'legacy_lusha_only',
        budget: perProvider({ lusha: pool(5) }),
      }).decision,
      'authorized',
    );
  });

  test('el umbral es >= : exacto autoriza, uno menos bloquea', () => {
    for (const [mode, providerKey, required] of [
      ['apollo_only', 'apollo', 8],
      ['legacy_lusha_only', 'lusha', 5],
    ] as const) {
      assert.equal(
        evaluatePhoneRevealCreditBudget({
          mode,
          budget: perProvider({ [providerKey]: pool(required) }),
        }).decision,
        'authorized',
        `${mode} exacto`,
      );
      assert.equal(
        evaluatePhoneRevealCreditBudget({
          mode,
          budget: perProvider({ [providerKey]: pool(required - 1) }),
        }).decision,
        'insufficient_credits',
        `${mode} uno menos`,
      );
    }
  });

  test('la exposición ya RESERVADA descuenta disponibilidad (espejo del SQL)', () => {
    // limit 13, consumed 0, reserved 8 ⇒ available 5: no cabe otra pata de 8.
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'apollo_only',
      budget: perProvider({ apollo: pool(5, 8) }),
    });
    assert.equal(verdict.decision, 'insufficient_credits');
    assert.equal(verdict.legs[0].availableCredits, 5);
  });

  test('el consumo descuenta igual que la reserva', () => {
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'apollo_only',
      budget: {
        model: 'per_provider',
        pools: [
          {
            providerKey: 'apollo',
            state: {
              kind: 'configured',
              limitCredits: 10,
              consumedCredits: 4,
              scopeType: 'global',
              scopeId: null,
              periodStart: '2026-08-01T00:00:00.000Z',
              periodEnd: '2026-08-31T23:59:59.999Z',
            },
          },
        ],
      },
    });
    assert.equal(verdict.legs[0].availableCredits, 6);
    assert.equal(verdict.decision, 'insufficient_credits');
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Los rechazos son hechos DISTINTOS — y "sin regla" NO es uno
// ═══════════════════════════════════════════════════════════════

describe('preflight — sin presupuesto ≠ sin saldo ≠ no verificable', () => {
  test('sin regla de crédito ⇒ UNBOUNDED y AUTORIZA, sin techo inventado', () => {
    // AGENT2A-PHONE-REVEAL-NO-BUDGET-RULE-UNLIMITED-1. En 4E esto BLOQUEABA con
    // `budget_not_configured`, y ese bloqueo es el defecto que se está corrigiendo: en
    // Producción Apollo no tiene regla, así que el clic terminaba en 0 corridas, 0
    // reservas y 0 llamadas. Sin regla no hay TOPE INTERNO que aplicar, y no aplicar un
    // tope que no existe no es lo mismo que afirmar que el proveedor sea gratis.
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'full_waterfall',
      budget: perProvider({ apollo: { kind: 'not_configured' }, lusha: pool(5) }),
    });
    assert.equal(verdict.decision, 'authorized');
    const apollo = verdict.legs.find((l) => l.providerKey === 'apollo');
    assert.equal(apollo?.decision, 'authorized');
    // El saldo sigue siendo `null`: no hay número finito que reportar. NUNCA 0 (que
    // significaría "sin saldo") y NUNCA un entero gigante que simule infinito — un
    // techo inventado acabaría comparándose o imprimiéndose como si fuera un hecho.
    assert.equal(apollo?.availableCredits, null);
    assert.notEqual(apollo?.availableCredits, 0);
    // Y la pata configurada se sigue exigiendo contra SU pozo: en `full_waterfall`
    // (sin búsqueda de identidad) Lusha pide 5, y su pozo de 5 lo cubre exacto.
    const lusha = verdict.legs.find((l) => l.providerKey === 'lusha');
    assert.equal(lusha?.requiredCredits, 5);
    assert.equal(lusha?.availableCredits, 5);
    assert.equal(lusha?.decision, 'authorized');
  });

  test('sin regla en el pozo exigido y saldo INSUFICIENTE en el otro ⇒ sigue bloqueando', () => {
    // Lo que se elimina es el bloqueo por AUSENCIA de regla, no el bloqueo por falta de
    // saldo: un pozo configurado que no alcanza sigue mandando sobre el agregado.
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'full_waterfall_with_identity_search',
      budget: perProvider({ apollo: { kind: 'not_configured' }, lusha: pool(4) }),
    });
    assert.equal(verdict.decision, 'insufficient_credits');
    assert.equal(
      verdict.legs.find((l) => l.providerKey === 'lusha')?.decision,
      'insufficient_credits',
    );
    assert.equal(
      verdict.legs.find((l) => l.providerKey === 'apollo')?.decision,
      'authorized',
    );
  });

  test('TODOS los pozos sin regla ⇒ authorized, y ni uno reporta saldo', () => {
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'full_waterfall_with_identity_search',
      budget: perProvider({
        apollo: { kind: 'not_configured' },
        lusha: { kind: 'not_configured' },
      }),
    });
    assert.equal(verdict.decision, 'authorized');
    assert.ok(verdict.legs.every((leg) => leg.decision === 'authorized'));
    assert.ok(verdict.legs.every((leg) => leg.availableCredits === null));
  });

  test('presupuesto no verificable ⇒ fail-closed, y NO se reporta como "insuficiente"', () => {
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'full_waterfall',
      budget: perProvider({ apollo: { kind: 'unavailable' }, lusha: pool(5) }),
    });
    assert.equal(verdict.decision, 'balance_unavailable');
    assert.notEqual(verdict.decision, 'insufficient_credits');
    assert.notEqual(verdict.decision, 'authorized');
  });

  test('lo INCIERTO gana: un fallo de lectura pesa más que un pozo sin regla', () => {
    // 🔴 La distinción que este hito NO relaja. "Sin regla" autoriza; "no se pudo leer"
    // sigue bloqueando, y cuando coinciden manda el fallo: degradar la lectura fallida a
    // UNBOUNDED convertiría un problema de infraestructura en permiso para gastar.
    assert.equal(
      evaluatePhoneRevealCreditBudget({
        mode: 'full_waterfall',
        budget: perProvider({
          apollo: { kind: 'unavailable' },
          lusha: { kind: 'not_configured' },
        }),
      }).decision,
      'balance_unavailable',
    );
    // Y un pozo configurado a 0 sigue siendo "no alcanza", no "no hay regla": 0 es un
    // dato. Que el OTRO pozo sea unbounded no lo tapa.
    assert.equal(
      evaluatePhoneRevealCreditBudget({
        mode: 'full_waterfall',
        budget: perProvider({ apollo: { kind: 'not_configured' }, lusha: pool(0) }),
      }).decision,
      'insufficient_credits',
    );
  });

  test('un proveedor exigido SIN pozo no es "sin límite": fail-closed', () => {
    // Falta la entrada de Lusha en un waterfall completo.
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'full_waterfall',
      budget: perProvider({ apollo: pool(1_000) }),
    });
    assert.equal(verdict.decision, 'balance_unavailable');
  });

  test('cifras rotas (NaN / Infinity) son NO verificables, no "grandes"', () => {
    for (const limitCredits of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(
        evaluatePhoneRevealCreditBudget({
          mode: 'legacy_lusha_only',
          budget: perProvider({
            lusha: {
              kind: 'configured',
              limitCredits,
              consumedCredits: 0,
              scopeType: 'global',
              scopeId: null,
              periodStart: '2026-08-01T00:00:00.000Z',
              periodEnd: '2026-08-31T23:59:59.999Z',
            },
          }),
        }).decision,
        'balance_unavailable',
        String(limitCredits),
      );
    }
  });

  test('un disponible negativo (sobregiro) bloquea y NO se recorta a 0', () => {
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'legacy_lusha_only',
      budget: {
        model: 'per_provider',
        pools: [
          {
            providerKey: 'lusha',
            state: {
              kind: 'configured',
              limitCredits: 5,
              consumedCredits: 8,
              scopeType: 'global',
              scopeId: null,
              periodStart: '2026-08-01T00:00:00.000Z',
              periodEnd: '2026-08-31T23:59:59.999Z',
            },
          },
        ],
      },
    });
    assert.equal(verdict.decision, 'insufficient_credits');
    assert.equal(verdict.legs[0].availableCredits, -3, 'el sobregiro se ve, no se esconde');
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Modelo COMPARTIDO: semántica declarada, no supuesta
// ═══════════════════════════════════════════════════════════════

describe('preflight — modelo compartido (no es el vigente, pero está declarado)', () => {
  test('el pozo único se compara contra el TOTAL de la modalidad (13 / 8 / 5)', () => {
    for (const [mode, total] of [
      ['full_waterfall', 13],
      ['apollo_only', 8],
      ['legacy_lusha_only', 5],
    ] as const) {
      assert.equal(
        evaluatePhoneRevealCreditBudget({
          mode,
          budget: { model: 'shared', pool: pool(total) },
        }).decision,
        'authorized',
        `${mode} con el total exacto`,
      );
      assert.equal(
        evaluatePhoneRevealCreditBudget({
          mode,
          budget: { model: 'shared', pool: pool(total - 1) },
        }).decision,
        'insufficient_credits',
        `${mode} con uno menos que el total`,
      );
    }
  });

  test('compartido sin regla configurada también es UNBOUNDED, no un bloqueo', () => {
    assert.equal(
      evaluatePhoneRevealCreditBudget({
        mode: 'full_waterfall',
        budget: { model: 'shared', pool: { kind: 'not_configured' } },
      }).decision,
      'authorized',
    );
    // Pero el pozo compartido ILEGIBLE sigue siendo fail-closed, igual que por proveedor.
    assert.equal(
      evaluatePhoneRevealCreditBudget({
        mode: 'full_waterfall',
        budget: { model: 'shared', pool: { kind: 'unavailable' } },
      }).decision,
      'balance_unavailable',
    );
  });
});
