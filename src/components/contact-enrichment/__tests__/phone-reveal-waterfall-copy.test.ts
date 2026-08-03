// Tests — copy del waterfall Apollo → Lusha
// (Agente 2A · AGENT2A-PHONE-WATERFALL-1).
//
// El copy es la única cosa que el operador ve ANTES de autorizar un gasto, así que
// lo importante aquí no es la redacción: es que el tope que se MUESTRA sea el mismo
// que el servidor revalida (13 con Lusha posible, 8 sin ella), y que el modal
// declare las advertencias obligatorias.
//
// Módulo puro (sin React, sin red): se importa directo.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatWaterfallLegCredits,
  getPhoneRevealWaterfallModalCopy,
  resolveWaterfallFinalProviderLabel,
  resolveWaterfallLushaSkippedLabel,
  resolveWaterfallOutcomeLabel,
  PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_BLOCKED_COPY,
  PHONE_REVEAL_WATERFALL_BUTTON_LABEL,
  PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_AUDIT_COPY,
  PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_COST_COPY,
  PHONE_REVEAL_WATERFALL_LEGACY_EXHAUSTED_COPY,
  PHONE_REVEAL_WATERFALL_LEGACY_LUSHA_RUNNING_COPY,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_SUPPRESSION_UNVERIFIED_COPY,
  PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS,
} from '../phone-reveal-waterfall-copy';
import {
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS as PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_CORE,
  PHONE_REVEAL_WATERFALL_LUSHA_SKIPPED_REASONS,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
} from '@/modules/contact-enrichment/phone-reveal-waterfall-core';

// ═══════════════════════════════════════════════════════════════
// 1. Los topes de UI deben ser los del core (autoridad real)
// ═══════════════════════════════════════════════════════════════

describe('copy del waterfall — topes alineados con el core', () => {
  test('el tope con Lusha de la UI es el del core (13)', () => {
    assert.equal(
      PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
    );
    assert.equal(PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS, 13);
  });

  test('el tope sin Lusha de la UI es el del core (8)', () => {
    assert.equal(
      PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
    );
    assert.equal(PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS, 8);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Modal único
// ═══════════════════════════════════════════════════════════════

describe('copy del waterfall — modal único', () => {
  test('con id Lusha: explica el orden de los proveedores y dice hasta 13 créditos', () => {
    const copy = getPhoneRevealWaterfallModalCopy({ lushaEligible: true });
    assert.equal(copy.maxCredits, 13);
    assert.ok(copy.creditsMessage.includes('13'));
    assert.ok(copy.flowDescription.includes('Apollo'));
    assert.ok(copy.flowDescription.includes('Lusha'));
    assert.ok(copy.flowDescription.includes('automáticamente'));
    // Sin id Lusha ausente ⇒ no se explica una limitación que no aplica.
    assert.equal(copy.lushaUnavailableNote, null);
  });

  test('sin id Lusha: dice hasta 8 créditos y EXPLICA por qué Lusha no aplica', () => {
    const copy = getPhoneRevealWaterfallModalCopy({ lushaEligible: false });
    assert.equal(copy.maxCredits, 8);
    assert.ok(copy.creditsMessage.includes('8'));
    assert.equal(copy.creditsMessage.includes('13'), false);
    assert.ok(copy.flowDescription.includes('Apollo'));
    assert.equal(copy.flowDescription.includes('Lusha'), false);
    assert.ok(copy.lushaUnavailableNote);
    assert.ok(copy.lushaUnavailableNote?.includes('identificador Lusha'));
  });

  test('el modal declara las advertencias obligatorias en los dos casos', () => {
    for (const lushaEligible of [true, false]) {
      const copy = getPhoneRevealWaterfallModalCopy({ lushaEligible });
      const joined = copy.warnings.join(' ');
      assert.ok(joined.includes('HubSpot'), 'debe advertir que no se escribe HubSpot');
      assert.ok(joined.includes('individual'), 'debe advertir que no es masiva');
      assert.ok(joined.includes('desconocido'), 'debe advertir sobre el tipo de teléfono');
    }
  });

  test('el botón usa el mismo label del reveal Apollo (una sola acción para el operador)', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_BUTTON_LABEL, 'Revelar teléfono');
    assert.equal(
      getPhoneRevealWaterfallModalCopy({ lushaEligible: true }).title,
      PHONE_REVEAL_WATERFALL_BUTTON_LABEL,
    );
    // No debe existir un label de "revelar con Lusha": no hay segundo botón.
    assert.equal(PHONE_REVEAL_WATERFALL_BUTTON_LABEL.includes('Lusha'), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Etiquetas de auditoría
// ═══════════════════════════════════════════════════════════════

describe('copy del waterfall — etiquetas de auditoría', () => {
  test('traduce los desenlaces de cada pata', () => {
    assert.equal(resolveWaterfallOutcomeLabel('revealed'), 'Teléfono encontrado');
    assert.equal(resolveWaterfallOutcomeLabel('no_phone_found'), 'Sin teléfono');
    assert.ok(resolveWaterfallOutcomeLabel('revealed_from_cache')?.includes('reutilizado'));
    assert.equal(resolveWaterfallOutcomeLabel(null), null);
    // Un valor desconocido se muestra tal cual en vez de desaparecer.
    assert.equal(resolveWaterfallOutcomeLabel('algo_nuevo'), 'algo_nuevo');
  });

  test('traduce cada motivo de omisión de la pata Lusha (todo el vocabulario cerrado)', () => {
    // Se recorre la lista del CORE, no una copia: un motivo nuevo sin etiqueta
    // hace fallar este test en vez de degradar silenciosamente a "Omitida.".
    for (const reason of PHONE_REVEAL_WATERFALL_LUSHA_SKIPPED_REASONS) {
      const label = resolveWaterfallLushaSkippedLabel(reason);
      assert.ok(label, `falta etiqueta para ${reason}`);
      assert.ok(label?.startsWith('Omitida'), reason);
      assert.notEqual(label, 'Omitida.', `${reason} usa el label genérico de fallback`);
    }
    assert.equal(resolveWaterfallLushaSkippedLabel(null), null);
  });

  test('supresión CONFIRMADA y comprobación NO DISPONIBLE tienen etiquetas distintas', () => {
    const suppressed = resolveWaterfallLushaSkippedLabel('suppressed');
    const unverified = resolveWaterfallLushaSkippedLabel('suppression_check_unavailable');
    assert.notEqual(suppressed, unverified);

    // La confirmada sí puede afirmar que existe una restricción.
    assert.ok(suppressed?.includes('restricción de privacidad'));

    // La NO disponible no puede afirmarlo: explica que no se pudo verificar y que
    // Lusha no se ejecutó.
    assert.ok(unverified?.includes('no se pudo verificar'), unverified ?? '');
    assert.ok(unverified?.includes('Lusha no fue ejecutado'), unverified ?? '');
    assert.equal(
      /suprimid|restricción de privacidad registrada/i.test(unverified ?? ''),
      false,
      'no puede decir que el candidato esté suprimido',
    );
  });

  test('el copy de estado de "no verificable" no afirma supresión ni muestra costo 0', () => {
    const copy = PHONE_REVEAL_WATERFALL_SUPPRESSION_UNVERIFIED_COPY;
    assert.ok(copy.includes('No se pudo verificar la supresión'));
    assert.ok(copy.includes('Lusha no fue ejecutado'));
    assert.equal(/suprimid/i.test(copy), false, 'no puede decir "suprimido"');
    assert.notEqual(copy, PHONE_REVEAL_WATERFALL_BLOCKED_COPY);
    // Ni un 0 de créditos ni una insinuación de gratuidad numérica.
    assert.equal(/\b0\b/.test(copy), false, 'no puede mostrar un costo 0');
  });

  test('traduce el proveedor final, incluido "ninguno"', () => {
    assert.equal(resolveWaterfallFinalProviderLabel('apollo'), 'Apollo');
    assert.equal(resolveWaterfallFinalProviderLabel('lusha'), 'Lusha');
    assert.equal(resolveWaterfallFinalProviderLabel('none'), 'Ninguno');
    assert.equal(resolveWaterfallFinalProviderLabel(null), null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Costos: un costo no reportado NUNCA se muestra como 0
// ═══════════════════════════════════════════════════════════════

describe('copy del waterfall — formato de créditos por pata', () => {
  test('un costo ausente se muestra como "no reportado", jamás como 0', () => {
    assert.equal(formatWaterfallLegCredits(null, 'unknown'), 'costo no reportado');
    assert.equal(formatWaterfallLegCredits(null, null), 'costo no reportado');
    assert.equal(formatWaterfallLegCredits(Number.NaN, 'reported'), 'costo no reportado');
    // Y sin que el texto sugiera un 0.
    assert.equal(formatWaterfallLegCredits(null, 'unknown').includes('0'), false);
  });

  test('un 0 explícito y reportado sí se muestra como 0 créditos', () => {
    assert.equal(formatWaterfallLegCredits(0, 'reported'), '0 créditos');
  });

  test('singular/plural y marca de "sin confirmar" cuando el costo no es reportado', () => {
    assert.equal(formatWaterfallLegCredits(1, 'reported'), '1 crédito');
    assert.equal(formatWaterfallLegCredits(5, 'reported'), '5 créditos');
    assert.ok(formatWaterfallLegCredits(5, 'assumed_cap').includes('sin confirmar'));
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Modalidad LEGACY (AGENT2A-PHONE-WATERFALL-2)
// ═══════════════════════════════════════════════════════════════
//
// El copy legacy es lo único que el operador lee antes de autorizar 5 créditos sobre
// un candidato cuyo Apollo ya se intentó. Tiene que decir, sin ambigüedad, que Apollo
// NO se reejecuta — si dijera lo mismo que el waterfall completo, el operador
// autorizaría creyendo que va a pagar dos proveedores.

describe('copy del waterfall — modalidad legacy solo-Lusha', () => {
  test('el tope legacy de la UI es el del core (5) y NO es 13 ni 8', () => {
    assert.equal(
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_CORE,
    );
    assert.equal(PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS, 5);
    assert.notEqual(
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS,
    );
    assert.notEqual(
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS,
    );
  });

  test('el modal legacy muestra 5 créditos y NUNCA 13', () => {
    const copy = getPhoneRevealWaterfallModalCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
    });
    assert.equal(copy.maxCredits, 5);
    assert.ok(copy.creditsMessage.includes('5'));
    assert.equal(copy.creditsMessage.includes('13'), false);
    assert.equal(copy.flowDescription.includes('13'), false);
  });

  test('el modal legacy dice que Apollo NO volverá a ejecutarse y que solo se intentará Lusha', () => {
    const copy = getPhoneRevealWaterfallModalCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
    });
    assert.ok(/Apollo ya fue intentado anteriormente/i.test(copy.flowDescription));
    assert.ok(/no volverá a ejecutar Apollo/i.test(copy.flowDescription));
    assert.ok(/Solo se intentará Lusha/i.test(copy.flowDescription));
  });

  test('el modal legacy NO promete un teléfono, NO crea contacto oficial y NO escribe en HubSpot', () => {
    const copy = getPhoneRevealWaterfallModalCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
    });
    const warnings = copy.warnings.join(' | ');
    assert.ok(/No garantiza encontrar un teléfono/i.test(warnings));
    assert.ok(/No crea un contacto oficial/i.test(warnings));
    assert.ok(/HubSpot/i.test(warnings));
    assert.ok(/individual, no masiva/i.test(warnings));
  });

  test('el modal legacy usa el MISMO título/label que el botón único', () => {
    const copy = getPhoneRevealWaterfallModalCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
    });
    assert.equal(copy.title, PHONE_REVEAL_WATERFALL_BUTTON_LABEL);
    assert.equal(copy.title, 'Revelar teléfono');
    // Sin nota de "Lusha no disponible": en legacy solo se ofrece si Lusha es posible.
    assert.equal(copy.lushaUnavailableNote, null);
  });

  test('`legacyLushaOnly` ausente o false conserva EXACTAMENTE el copy del waterfall completo', () => {
    const baseline = getPhoneRevealWaterfallModalCopy({ lushaEligible: true });
    assert.deepEqual(
      getPhoneRevealWaterfallModalCopy({ lushaEligible: true, legacyLushaOnly: false }),
      baseline,
    );
    assert.equal(baseline.maxCredits, 13);
    assert.ok(/primero Apollo/i.test(baseline.flowDescription));
  });

  test('el copy del estado legacy no afirma que Apollo se esté consultando ahora', () => {
    assert.equal(
      PHONE_REVEAL_WATERFALL_LEGACY_LUSHA_RUNNING_COPY.includes('Apollo'),
      false,
    );
    assert.ok(/Lusha/i.test(PHONE_REVEAL_WATERFALL_LEGACY_LUSHA_RUNNING_COPY));
  });

  test('el copy legacy de agotado sitúa a Apollo en el PASADO, no en esta autorización', () => {
    assert.ok(/anteriormente/i.test(PHONE_REVEAL_WATERFALL_LEGACY_EXHAUSTED_COPY));
    assert.ok(/Lusha/i.test(PHONE_REVEAL_WATERFALL_LEGACY_EXHAUSTED_COPY));
  });

  test('la auditoría legacy dice "intentado anteriormente", nunca "no intentado"', () => {
    assert.ok(/anteriormente/i.test(PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_AUDIT_COPY));
    assert.equal(
      /no intentado/i.test(PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_AUDIT_COPY),
      false,
    );
  });

  test('el costo de Apollo en legacy no muestra ninguna cifra (y menos un 0)', () => {
    assert.equal(/\d/.test(PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_COST_COPY), false);
    assert.ok(/Sin cargo en esta autorización/i.test(
      PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_COST_COPY,
    ));
  });
});
