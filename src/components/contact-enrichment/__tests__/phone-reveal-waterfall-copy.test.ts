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
  getPhoneRevealWaterfallAuthorizationCopy,
  resolveWaterfallFinalProviderLabel,
  resolveWaterfallLushaSkippedLabel,
  resolveWaterfallOutcomeLabel,
  PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_APOLLO_RUNNING_COPY,
  PHONE_REVEAL_WATERFALL_BLOCKED_COPY,
  PHONE_REVEAL_WATERFALL_BUTTON_LABEL,
  PHONE_REVEAL_WATERFALL_BUDGET_NOT_CONFIGURED_COPY,
  PHONE_REVEAL_WATERFALL_CREDIT_BALANCE_UNAVAILABLE_COPY,
  PHONE_REVEAL_WATERFALL_EXHAUSTED_COPY,
  PHONE_REVEAL_WATERFALL_INFRASTRUCTURE_UNAVAILABLE_COPY,
  PHONE_REVEAL_WATERFALL_INSUFFICIENT_CREDITS_COPY,
  PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_AUDIT_COPY,
  PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_COST_COPY,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LUSHA_RUNNING_COPY,
  PHONE_REVEAL_WATERFALL_REQUESTING_COPY,
  PHONE_REVEAL_WATERFALL_REVEALED_COPY,
  PHONE_REVEAL_WATERFALL_SUPPRESSION_UNVERIFIED_COPY,
  PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS_WITH_SEARCH,
  PHONE_REVEAL_WATERFALL_WITH_IDENTITY_SEARCH_MAX_CREDITS,
} from '../phone-reveal-waterfall-copy';
import {
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS as PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_CORE,
  PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LUSHA_SKIPPED_REASONS,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
  PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS as PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS_CORE,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH,
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

  test('el tope de la búsqueda de identidad de la UI es el del core (1)', () => {
    // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1. Es la cifra que Lusha cobra
    // por petición a `api_search`, y la que el operador ve desglosada. Si dejara de ser
    // la del core, la pantalla estaría pidiendo autorización por un tope que el
    // servidor no aplica — exactamente lo que este espejo existe para impedir.
    assert.equal(
      PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS_CORE,
    );
    assert.equal(PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS, 1);
  });

  test('el tope con búsqueda de identidad de la UI es el del core (14)', () => {
    assert.equal(
      PHONE_REVEAL_WATERFALL_WITH_IDENTITY_SEARCH_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH,
    );
    assert.equal(PHONE_REVEAL_WATERFALL_WITH_IDENTITY_SEARCH_MAX_CREDITS, 14);
    // 14 = 13 + 1: la búsqueda se SUMA al tope anterior, no se descuenta de él.
    assert.equal(
      PHONE_REVEAL_WATERFALL_WITH_IDENTITY_SEARCH_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS +
        PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS,
    );
  });

  test('la pata Lusha completa con búsqueda son 6, y el desglose lo dice', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS_WITH_SEARCH, 6);
    const copy = getPhoneRevealWaterfallAuthorizationCopy({
      lushaEligible: true,
      requiresIdentitySearch: true,
    });
    assert.equal(copy.maxCredits, 14);
    assert.match(copy.creditsMessage, /hasta 14 créditos/);
    assert.deepEqual(copy.creditBreakdown?.legs, [
      'Apollo: hasta 8 créditos.',
      'Lusha: hasta 6 créditos (búsqueda hasta 1 + teléfono hasta 5).',
    ]);
    assert.equal(copy.creditBreakdown?.total, 'Máximo total autorizado: 14 créditos.');
  });

  test('sin búsqueda pendiente el copy sigue siendo EXACTAMENTE el de antes (13)', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({ lushaEligible: true });
    assert.equal(copy.maxCredits, 13);
    assert.match(copy.creditsMessage, /hasta 13 créditos/);
    assert.deepEqual(copy.creditBreakdown?.legs, [
      'Apollo: hasta 8 créditos.',
      'Lusha: hasta 5 créditos.',
    ]);
    // Y el flujo NO menciona ninguna búsqueda: esa autorización no puede pagarla.
    assert.equal(/busca/i.test(copy.flowDescription), false);
  });

  test('el tope de la pata Lusha que se desglosa es el del core (5)', () => {
    // El desglose del modal (AGENT2A-PHONE-WATERFALL-4B) muestra esta cifra como el
    // umbral de la 2ª pata: si dejara de ser la del core, el modal estaría pidiendo
    // autorización por un tope que el servidor no aplica.
    assert.equal(
      PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
    );
    assert.equal(PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS, 5);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Autorización DIRECTA, debajo del botón (WATERFALL-4D)
// ═══════════════════════════════════════════════════════════════
//
// Ya no hay modal: este copy se lee ANTES del clic y el clic ejecuta. Por eso lo que
// se fija aquí es el texto EXACTO —no solo que "mencione" el tope— y que ninguna
// modalidad nombre una pata que no pueda ejecutarse.

describe('copy del waterfall — autorización directa (4D)', () => {
  test('con id Lusha: copy exacto del waterfall completo, hasta 13 créditos', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({ lushaEligible: true });
    assert.equal(copy.maxCredits, 13);
    assert.equal(
      copy.helperText,
      'Apollo se intentará primero. Si no encuentra un teléfono, SellUp intentará Lusha automáticamente. Puede consumir hasta 13 créditos.',
    );
    // El orden importa: Apollo primero, Lusha SOLO si el primero no encuentra.
    assert.ok(/Apollo se intentará primero/.test(copy.flowDescription));
    assert.ok(/SellUp intentará Lusha automáticamente/.test(copy.flowDescription));
  });

  test('sin id Lusha: copy exacto Apollo-only, sin mencionar Lusha ni 13', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({ lushaEligible: false });
    assert.equal(copy.maxCredits, 8);
    assert.equal(
      copy.helperText,
      'Consulta individual con Apollo. Puede consumir hasta 8 créditos.',
    );
    // La pata Lusha no puede ejecutarse: nombrarla solo confundiría sobre qué se
    // está autorizando. Y el total de 13 no aparece por ninguna vía.
    assert.equal(/Lusha/.test(copy.helperText), false, copy.helperText);
    assert.equal(/13/.test(copy.helperText), false, copy.helperText);
    assert.equal(copy.creditBreakdown, null);
  });

  test('legacy: copy exacto solo-Lusha, hasta 5 créditos y jamás 13 ni 8', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
    });
    assert.equal(copy.maxCredits, 5);
    assert.equal(
      copy.helperText,
      'Apollo ya fue intentado. SellUp intentará Lusha automáticamente. Puede consumir hasta 5 créditos.',
    );
    assert.equal(/13/.test(copy.helperText), false, copy.helperText);
    assert.equal(/ 8 /.test(copy.helperText), false, copy.helperText);
    // Una sola pata autorizada ⇒ nada que desglosar.
    assert.equal(copy.creditBreakdown, null);
  });

  test('`helperText` es exactamente flujo + tope: lo que se prueba es lo que se pinta', () => {
    for (const args of [
      { lushaEligible: true },
      { lushaEligible: false },
      { lushaEligible: true, legacyLushaOnly: true },
    ]) {
      const copy = getPhoneRevealWaterfallAuthorizationCopy(args);
      assert.equal(
        copy.helperText,
        `${copy.flowDescription} ${copy.creditsMessage}`,
        JSON.stringify(args),
      );
    }
  });

  test('declara las advertencias obligatorias en los tres casos', () => {
    for (const args of [
      { lushaEligible: true },
      { lushaEligible: false },
      { lushaEligible: true, legacyLushaOnly: true },
    ]) {
      const joined = getPhoneRevealWaterfallAuthorizationCopy(args).warnings.join(' ');
      assert.ok(joined.includes('HubSpot'), 'debe advertir que no se escribe HubSpot');
      assert.ok(joined.includes('individual'), 'debe advertir que no es masiva');
      assert.ok(joined.includes('desconocido'), 'debe advertir sobre el tipo de teléfono');
    }
  });

  // ── Desglose por proveedor (AGENT2A-PHONE-WATERFALL-4B, conservado en 4D) ──
  //
  // La autorización completa gasta MÁS crédito (13) y DOS proveedores. Un total sin
  // desglose no permite saber qué pata cobra qué, así que el desglose sobrevive a la
  // eliminación del modal: se mueve, no se pierde.

  test('el desglose atribuye hasta 8 créditos a Apollo y hasta 5 a Lusha, en ese orden', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({ lushaEligible: true });
    const legs = copy.creditBreakdown?.legs ?? [];
    assert.equal(legs.length, 2);
    assert.ok(/^Apollo: hasta 8 créditos\.$/.test(legs[0]), legs.join(' | '));
    assert.ok(/^Lusha: hasta 5 créditos\.$/.test(legs[1]), legs.join(' | '));
  });

  test('el desglose declara 13 como máximo TOTAL autorizado, y suma las patas', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({ lushaEligible: true });
    assert.equal(copy.creditBreakdown?.total, 'Máximo total autorizado: 13 créditos.');
    // El total no es una cifra suelta: es exactamente la suma de las dos patas, y
    // coincide con el tope que viaja al servidor.
    assert.equal(
      PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS +
        PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS,
    );
    assert.equal(copy.maxCredits, PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS);
  });

  test('advierte que NO se garantiza un teléfono y que NO se crea contacto oficial', () => {
    for (const lushaEligible of [true, false]) {
      const warnings = getPhoneRevealWaterfallAuthorizationCopy({
        lushaEligible,
      }).warnings.join(' | ');
      assert.ok(/No se garantiza encontrar un teléfono/i.test(warnings), warnings);
      assert.ok(/No se creará un contacto oficial/i.test(warnings), warnings);
    }
  });

  test('el legacy conserva SU redacción de advertencias, sin adoptar la del completo', () => {
    const legacy = getPhoneRevealWaterfallAuthorizationCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
    });
    const warnings = legacy.warnings.join(' | ');
    assert.ok(/No garantiza encontrar un teléfono/i.test(warnings));
    assert.equal(/No se garantiza encontrar un teléfono/i.test(warnings), false);
    assert.ok(/No crea un contacto oficial/i.test(warnings));
    assert.equal(/No se creará un contacto oficial/i.test(warnings), false);
    assert.equal(legacy.maxCredits, PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS);
  });

  test('el botón usa el mismo label del reveal Apollo (una sola acción)', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_BUTTON_LABEL, 'Revelar teléfono');
    // No debe existir un label de "revelar con Lusha": no hay segundo botón.
    assert.equal(PHONE_REVEAL_WATERFALL_BUTTON_LABEL.includes('Lusha'), false);
  });

  test('el copy ya NO ofrece confirmar ni cancelar: no hay modal que confirmar', () => {
    for (const args of [
      { lushaEligible: true },
      { lushaEligible: false },
      { lushaEligible: true, legacyLushaOnly: true },
    ]) {
      const copy = getPhoneRevealWaterfallAuthorizationCopy(args) as unknown as Record<
        string,
        unknown
      >;
      assert.equal('confirmLabel' in copy, false, JSON.stringify(args));
      assert.equal('cancelLabel' in copy, false, JSON.stringify(args));
      const serialized = JSON.stringify(copy);
      assert.equal(/Confirmar y revelar/.test(serialized), false, serialized);
      assert.equal(/Cancelar/.test(serialized), false, serialized);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 bis. Estados visibles del flujo directo (WATERFALL-4D)
// ═══════════════════════════════════════════════════════════════

describe('copy del waterfall — estados del flujo directo (4D)', () => {
  test('los cinco estados son exactamente los del contrato', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_REQUESTING_COPY, 'Solicitando revelación…');
    assert.equal(
      PHONE_REVEAL_WATERFALL_APOLLO_RUNNING_COPY,
      'Apollo está procesando el resultado.',
    );
    assert.equal(
      PHONE_REVEAL_WATERFALL_LUSHA_RUNNING_COPY,
      'Apollo no encontró un teléfono. SellUp está intentando Lusha.',
    );
    assert.equal(PHONE_REVEAL_WATERFALL_REVEALED_COPY, 'Teléfono revelado.');
    assert.equal(PHONE_REVEAL_WATERFALL_EXHAUSTED_COPY, 'Teléfono no disponible.');
  });

  test('el estado de Lusha en curso no afirma que Apollo esté corriendo AHORA', () => {
    // Sirve para las dos modalidades, así que no puede estar en presente: en legacy
    // Apollo se intentó antes y fuera de esta autorización.
    const copy = PHONE_REVEAL_WATERFALL_LUSHA_RUNNING_COPY;
    assert.ok(/Apollo no encontró/.test(copy), copy);
    assert.equal(/[Cc]onsultando Apollo/.test(copy), false, copy);
    assert.equal(/Apollo está/.test(copy), false, copy);
  });

  test('el terminal sin teléfono NO enumera proveedores (la auditoría ya lo hace)', () => {
    const copy = PHONE_REVEAL_WATERFALL_EXHAUSTED_COPY;
    assert.equal(/Apollo/.test(copy), false, copy);
    assert.equal(/Lusha/.test(copy), false, copy);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 ter. Saldo insuficiente vs. saldo no verificable (WATERFALL-4D)
// ═══════════════════════════════════════════════════════════════

describe('copy del waterfall — saldo de créditos', () => {
  test('saldo insuficiente: copy exacto del contrato', () => {
    assert.equal(
      PHONE_REVEAL_WATERFALL_INSUFFICIENT_CREDITS_COPY,
      'No hay créditos suficientes para realizar esta revelación.',
    );
  });

  test('saldo NO verificable: es OTRO copy y no afirma que falten créditos', () => {
    const copy = PHONE_REVEAL_WATERFALL_CREDIT_BALANCE_UNAVAILABLE_COPY;
    assert.notEqual(copy, PHONE_REVEAL_WATERFALL_INSUFFICIENT_CREDITS_COPY);
    assert.equal(/No hay créditos suficientes/.test(copy), false, copy);
    // Redacción EXACTA del contrato (AGENT2A-PHONE-WATERFALL-4E).
    assert.equal(
      copy,
      'No fue posible verificar el saldo de créditos. No se ejecutó ningún proveedor ni se consumieron créditos.',
    );
  });

  test('presupuesto sin configurar: TERCER copy, distinto de los dos anteriores', () => {
    // AGENT2A-PHONE-WATERFALL-4E. No es "no hay créditos" (el saldo no se agotó) ni "no
    // se pudo verificar" (sí se verificó: no hay regla). Decirle al operador que faltan
    // créditos lo mandaría a conseguir créditos que no desbloquearían nada.
    const copy = PHONE_REVEAL_WATERFALL_BUDGET_NOT_CONFIGURED_COPY;
    assert.equal(copy, 'No hay un presupuesto configurado para realizar esta revelación.');
    assert.notEqual(copy, PHONE_REVEAL_WATERFALL_INSUFFICIENT_CREDITS_COPY);
    assert.notEqual(copy, PHONE_REVEAL_WATERFALL_CREDIT_BALANCE_UNAVAILABLE_COPY);
    assert.equal(/créditos suficientes/.test(copy), false, copy);
    assert.equal(/no fue posible verificar/i.test(copy), false, copy);
  });

  test('ninguno de los tres se presenta como "no se encontró teléfono"', () => {
    for (const copy of [
      PHONE_REVEAL_WATERFALL_INSUFFICIENT_CREDITS_COPY,
      PHONE_REVEAL_WATERFALL_BUDGET_NOT_CONFIGURED_COPY,
      PHONE_REVEAL_WATERFALL_CREDIT_BALANCE_UNAVAILABLE_COPY,
    ]) {
      assert.equal(/no se encontró/i.test(copy), false, copy);
      assert.equal(/no disponible el teléfono/i.test(copy), false, copy);
      assert.notEqual(copy, PHONE_REVEAL_WATERFALL_EXHAUSTED_COPY);
    }
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

  test('la autorización legacy muestra 5 créditos y NUNCA 13', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
    });
    assert.equal(copy.maxCredits, 5);
    assert.ok(copy.creditsMessage.includes('5'));
    assert.equal(copy.creditsMessage.includes('13'), false);
    assert.equal(copy.flowDescription.includes('13'), false);
  });

  test('la autorización legacy dice que Apollo YA fue intentado y que Lusha es automático', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
    });
    assert.ok(/Apollo ya fue intentado/i.test(copy.flowDescription));
    assert.ok(/SellUp intentará Lusha automáticamente/i.test(copy.flowDescription));
    // NO puede decir que Apollo se vaya a intentar: ya se intentó.
    assert.equal(/Apollo se intentará/i.test(copy.flowDescription), false);
  });

  test('la autorización legacy NO promete teléfono, NO crea contacto y NO escribe en HubSpot', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
    });
    const warnings = copy.warnings.join(' | ');
    assert.ok(/No garantiza encontrar un teléfono/i.test(warnings));
    assert.ok(/No crea un contacto oficial/i.test(warnings));
    assert.ok(/HubSpot/i.test(warnings));
    assert.ok(/individual, no masiva/i.test(warnings));
  });

  test('`legacyLushaOnly` ausente o false conserva EXACTAMENTE el copy del completo', () => {
    const baseline = getPhoneRevealWaterfallAuthorizationCopy({ lushaEligible: true });
    assert.deepEqual(
      getPhoneRevealWaterfallAuthorizationCopy({
        lushaEligible: true,
        legacyLushaOnly: false,
      }),
      baseline,
    );
    assert.equal(baseline.maxCredits, 13);
    assert.ok(/Apollo se intentará primero/i.test(baseline.flowDescription));
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

// ═══════════════════════════════════════════════════════════════
// 6. Infraestructura de auditoría no disponible (AGENT2A-PHONE-WATERFALL-2A)
// ═══════════════════════════════════════════════════════════════

/**
 * Con el flag encendido, la corrida de auditoría es precondición de ejecutar
 * proveedores. Si no se puede crear, el servidor no llama a nadie — y el copy es lo
 * único que le dice al operador qué pasó realmente con su clic. Aquí no se juzga la
 * redacción: se fija que afirme las cuatro garantías y que no insinúe ninguna otra.
 */
describe('copy del waterfall — infraestructura de auditoría no disponible', () => {
  const copy = PHONE_REVEAL_WATERFALL_INFRASTRUCTURE_UNAVAILABLE_COPY;

  test('dice que el proceso NO pudo iniciarse y por qué', () => {
    assert.ok(copy.includes('No se pudo iniciar'));
    assert.ok(copy.includes('servicio de auditoría no está disponible'));
  });

  test('confirma que NO se ejecutó Apollo y que NO se ejecutó Lusha', () => {
    assert.ok(copy.includes('No se ejecutó Apollo'), 'Apollo no fue ejecutado');
    assert.ok(copy.includes('no se ejecutó Lusha'), 'Lusha no fue ejecutado');
  });

  test('confirma cero créditos consumidos', () => {
    assert.ok(copy.includes('no se consumieron créditos'));
  });

  test('invita a reintentar más tarde', () => {
    assert.ok(copy.includes('Intenta nuevamente más tarde'));
  });

  test('NO se presenta como "no se encontró teléfono" ni como error de proveedor', () => {
    // "no se encontró teléfono" afirmaría que se buscó, y nadie buscó.
    assert.equal(copy.includes('no se encontró'), false);
    assert.equal(copy.includes('no está disponible el teléfono'), false);
    assert.equal(copy.includes('Apollo falló'), false);
    assert.equal(copy.includes('error de Apollo'), false);
    assert.equal(copy.includes('error de Lusha'), false);
  });

  test('NO atribuye un costo de 0 a ningún proveedor ni insinúa éxito parcial', () => {
    // Un "0 créditos" leería como "Apollo corrió y salió gratis".
    assert.equal(copy.includes('0 crédito'), false);
    assert.equal(copy.includes('sin costo'), false);
    assert.equal(copy.includes('parcial'), false);
  });

  test('NO menciona una corrida ni una revelación en proceso (no existen)', () => {
    assert.equal(copy.toLowerCase().includes('corrida'), false);
    assert.equal(copy.includes('en proceso'), false);
    assert.equal(copy.includes('solicitada'), false);
  });

  test('es distinto de los otros cierres del waterfall', () => {
    // Cada cierre afirma una cosa distinta: colapsarlos borraría la diferencia
    // entre "no se pudo comprobar la privacidad", "falló la revelación" y "no se
    // pudo ni empezar".
    assert.notEqual(copy, PHONE_REVEAL_WATERFALL_SUPPRESSION_UNVERIFIED_COPY);
    assert.notEqual(copy, PHONE_REVEAL_WATERFALL_BLOCKED_COPY);
  });
});
