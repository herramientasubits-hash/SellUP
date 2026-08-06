/**
 * Agente 2A — Captura de TODOS los teléfonos Apollo: parte pura
 * (AGENT2A-PHONE-REVEAL-4O-C)
 *
 * Pruebas offline de `apollo-phone-collection-capture.ts`. Sin red, sin Supabase,
 * sin proveedores y sin créditos: el módulo bajo prueba es pura aritmética sobre
 * un payload.
 *
 * TODOS los números son sintéticos 555. Ninguna aserción imprime un teléfono.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildApolloObservationDiscriminator,
  buildApolloPhoneCollectionCapture,
  collectLocatedApolloPhoneNumbers,
  mapApolloPhoneStatus,
  sumApolloPhoneCreditsAcrossLocations,
  type ApolloPhoneCaptureSourceContext,
} from '../apollo-phone-collection-capture';
import { resolveLegacyPhoneDedupeKey } from '../candidate-phone-collection-writer';
import { sumWebhookCredits } from '../phone-reveal-webhook-core';
import type { ApolloPhoneRevealWebhookPayload } from '../phone-reveal-webhook-core';

const NOW = '2026-08-06T10:00:00.000Z';

const MOBILE = '+15550000001';
const DIRECT = '+15550000002';
const WORK = '+15550000003';
const HQ = '+15550000004';

const CONTEXT: ApolloPhoneCaptureSourceContext = {
  phase: 'webhook',
  waterfallRunId: null,
  reservationId: null,
  providerUsageLogId: null,
  observedAt: NOW,
};

function capture(
  payload: ApolloPhoneRevealWebhookPayload | null,
  context: Partial<ApolloPhoneCaptureSourceContext> = {},
) {
  return buildApolloPhoneCollectionCapture({
    payload,
    context: { ...CONTEXT, ...context },
  });
}

/** Tipo del principal preferido, sin exponer el número. */
function primaryType(result: ReturnType<typeof capture>): string | null {
  const key = result.primaryPreference[0] ?? null;
  if (!key) return null;
  return result.phones.find((p) => p.dedupeKey === key)?.phoneType ?? null;
}

/** ¿La fila principal es la que lleva ESTE número? Compara sin imprimirlo. */
function primaryIs(result: ReturnType<typeof capture>, number: string): boolean {
  const key = result.primaryPreference[0] ?? null;
  if (!key) return false;
  return result.phones.find((p) => p.dedupeKey === key)?.displayPhone === number;
}

// ═══════════════════════════════════════════════════════════════════
// Recolección con ubicación
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — recolección de las TRES ubicaciones', () => {
  it('lee raíz, person y people, y etiqueta cada entrada con su ubicación', () => {
    const located = collectLocatedApolloPhoneNumbers({
      phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }],
      person: { phone_numbers: [{ sanitized_number: DIRECT, type_cd: 'direct' }] },
      people: [{ phone_numbers: [{ sanitized_number: WORK, type_cd: 'work' }] }],
    });
    assert.equal(located.length, 3);
    assert.deepEqual(
      located.map((entry) => entry.location),
      ['root', 'person', 'people'],
    );
  });

  it('payload nulo, vacío o sin arrays ⇒ ninguna entrada', () => {
    assert.equal(collectLocatedApolloPhoneNumbers(null).length, 0);
    assert.equal(collectLocatedApolloPhoneNumbers({}).length, 0);
    assert.equal(
      collectLocatedApolloPhoneNumbers({ phone_numbers: null, person: null }).length,
      0,
    );
  });

  it('varias personas en people[] siguen siendo UNA ubicación', () => {
    const located = collectLocatedApolloPhoneNumbers({
      people: [
        { phone_numbers: [{ sanitized_number: MOBILE }] },
        { phone_numbers: [{ sanitized_number: DIRECT }] },
      ],
    });
    assert.deepEqual([...new Set(located.map((e) => e.location))], ['people']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Contabilidad
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — créditos sin doble conteo estructural', () => {
  it('dos teléfonos DISTINTOS de 4 créditos suman 8', () => {
    const result = capture({
      phone_numbers: [
        { sanitized_number: DIRECT, type_cd: 'direct', credits_consumed: 4 },
        { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 },
      ],
    });
    assert.equal(result.credits, 8);
  });

  it('el MISMO registro repetido en raíz y person NO se cuenta dos veces', () => {
    const entry = { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 };
    const payload: ApolloPhoneRevealWebhookPayload = {
      phone_numbers: [{ ...entry }],
      person: { phone_numbers: [{ ...entry }] },
    };
    assert.equal(capture(payload).credits, 4);
    // Y ESTE es el defecto que corrige: la función heredada sí lo duplicaba.
    assert.equal(sumWebhookCredits([{ ...entry }, { ...entry }]), 8);
  });

  it('el MISMO registro en las TRES ubicaciones se cuenta UNA vez', () => {
    const entry = { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 5 };
    const result = capture({
      phone_numbers: [{ ...entry }],
      person: { phone_numbers: [{ ...entry }] },
      people: [{ phone_numbers: [{ ...entry }] }],
    });
    assert.equal(result.credits, 5);
  });

  it('dos elementos idénticos DENTRO de una ubicación sí cuentan dos veces', () => {
    // Apollo emitió dos elementos en el mismo array: no hay base para decidir
    // que uno sobra. La deduplicación es entre ubicaciones, no dentro de una.
    const entry = { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 3 };
    const result = capture({ phone_numbers: [{ ...entry }, { ...entry }] });
    assert.equal(result.credits, 6);
  });

  it('multiplicidad: [A,A] en raíz y [A,A] en person cuentan 2, no 4', () => {
    const entry = { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 3 };
    const result = capture({
      phone_numbers: [{ ...entry }, { ...entry }],
      person: { phone_numbers: [{ ...entry }, { ...entry }] },
    });
    assert.equal(result.credits, 6);
  });

  it('el MISMO número con créditos DISTINTOS son registros distintos: se suman', () => {
    const result = capture({
      phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 }],
      person: {
        phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 7 }],
      },
    });
    assert.equal(result.credits, 11);
  });

  it('dos números DISTINTOS con IGUAL tipo, estado y crédito suman los dos', () => {
    // 4O-C-R1. El caso más peligroso de toda la contabilidad: aquí lo ÚNICO que
    // distingue los dos registros es el número. Si la firma estructural dejara de
    // incluirlo —o lo normalizara hasta hacerlos iguales— las dos entradas se
    // colapsarían en una y el total quedaría a la mitad, con un reveal de dos
    // móviles contabilizado como uno. Las otras pruebas de este bloque no lo
    // cubren: todas ellas difieren además en tipo o en crédito.
    const result = capture({
      phone_numbers: [
        { sanitized_number: MOBILE, type_cd: 'mobile', status_cd: 'valid', credits_consumed: 4 },
        { sanitized_number: DIRECT, type_cd: 'mobile', status_cd: 'valid', credits_consumed: 4 },
      ],
    });
    assert.equal(result.credits, 8);
    // Y son DOS filas canónicas: son dos números, no dos vistas de uno.
    assert.equal(result.counters.canonical_phone_count, 2);
    assert.equal(result.counters.duplicate_phone_count, 0);
  });

  it('el mismo número dos veces en UNA ubicación cuenta dos veces, en DOS ubicaciones una', () => {
    // Las dos mitades de la regla, una al lado de la otra, porque es la asimetría
    // que se rompe sola cuando alguien «simplifica» la deduplicación a por-número.
    const entry = {
      sanitized_number: MOBILE,
      type_cd: 'mobile',
      status_cd: 'valid',
      credits_consumed: 4,
    };
    assert.equal(capture({ phone_numbers: [{ ...entry }, { ...entry }] }).credits, 8);
    assert.equal(
      capture({
        phone_numbers: [{ ...entry }],
        person: { phone_numbers: [{ ...entry }] },
      }).credits,
      4,
    );
    // En los dos casos la COLECCIÓN es una sola fila: la multiplicidad es un hecho
    // del cobro, no del número.
    assert.equal(
      capture({ phone_numbers: [{ ...entry }, { ...entry }] }).counters.canonical_phone_count,
      1,
    );
  });

  it('sin ningún credits_consumed ⇒ null (la ausencia de dato NO es cero)', () => {
    assert.equal(capture({ phone_numbers: [{ sanitized_number: MOBILE }] }).credits, null);
    assert.equal(sumApolloPhoneCreditsAcrossLocations([]), null);
  });

  it('los créditos NO se reparten entre números: la captura no expone costo por fila', () => {
    const result = capture({
      phone_numbers: [
        { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 },
        { sanitized_number: DIRECT, type_cd: 'direct', credits_consumed: 4 },
      ],
    });
    assert.equal(result.credits, 8);
    for (const phone of result.phones) {
      assert.equal('cost_credits' in phone, false);
      assert.equal('credits' in phone, false);
      assert.equal('credits_consumed' in phone, false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Deduplicación canónica
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — deduplicación', () => {
  it('el mismo número en raíz y person ⇒ 1 canónico y 1 SOLA procedencia', () => {
    const entry = { sanitized_number: MOBILE, type_cd: 'mobile', status_cd: 'valid' };
    const result = capture({
      phone_numbers: [{ ...entry }],
      person: { phone_numbers: [{ ...entry }] },
    });
    assert.equal(result.counters.canonical_phone_count, 1);
    assert.equal(result.counters.source_count, 1);
    assert.equal(result.counters.duplicate_phone_count, 1);
  });

  it('el mismo número en formatos distintos ⇒ 1 canónico', () => {
    const result = capture({
      phone_numbers: [
        { sanitized_number: '+15550000001', type_cd: 'mobile' },
        { sanitized_number: '+1 555 000 0001', type_cd: 'mobile' },
      ],
    });
    assert.equal(result.counters.canonical_phone_count, 1);
  });

  it('el mismo número con TIPOS distintos ⇒ 1 canónico con el mejor tipo y 2 procedencias', () => {
    const result = capture({
      phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'work' }],
      person: { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
    });
    assert.equal(result.counters.canonical_phone_count, 1);
    assert.equal(result.counters.source_count, 2);
    assert.equal(result.phones[0].phoneType, 'mobile');
    // Ningún raw_type se pierde: los DOS quedan en las procedencias.
    assert.deepEqual(
      result.phones[0].sources.map((s) => s.rawProviderType).sort(),
      ['mobile', 'work'],
    );
  });

  it('el mismo número con ESTADOS distintos ⇒ 2 procedencias, estado agregado', () => {
    const result = capture({
      phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile', status_cd: 'valid' }],
      person: {
        phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile', status_cd: 'invalid' }],
      },
    });
    assert.equal(result.counters.canonical_phone_count, 1);
    assert.equal(result.counters.source_count, 2);
    // Un proveedor que no verifica no degrada lo que otro confirmó.
    assert.equal(result.phones[0].phoneStatus, 'valid');
  });

  it('tres teléfonos distintos ⇒ 3 canónicos', () => {
    const result = capture({
      phone_numbers: [
        { sanitized_number: WORK, type_cd: 'work' },
        { sanitized_number: HQ, type_cd: 'hq' },
        { sanitized_number: MOBILE, type_cd: 'mobile' },
      ],
    });
    assert.equal(result.counters.canonical_phone_count, 3);
    assert.equal(primaryType(result), 'mobile');
  });

  it('entradas vacías o sin número se ignoran sin generar fila', () => {
    const result = capture({
      phone_numbers: [
        {},
        { sanitized_number: '   ' },
        { raw_number: null, sanitized_number: null },
        { sanitized_number: MOBILE, type_cd: 'mobile' },
      ],
    });
    assert.equal(result.counters.phone_count, 4);
    assert.equal(result.counters.valid_phone_count, 1);
    assert.equal(result.counters.canonical_phone_count, 1);
  });

  it('sin sanitized pero con raw utilizable ⇒ se normaliza de forma conservadora', () => {
    const result = capture({
      phone_numbers: [{ raw_number: '(555) 000-0001', type_cd: 'mobile' }],
    });
    assert.equal(result.counters.canonical_phone_count, 1);
    // Clave por dígitos: NO se inventa un prefijo de país que nadie entregó.
    assert.equal(result.phones[0].keyKind, 'digits');
    assert.equal(result.phones[0].normalizedPhone, '5550000001');
    // El display conserva el formato del proveedor tal cual.
    assert.equal(result.phones[0].displayPhone, '(555) 000-0001');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Discriminante de observación
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — discriminante de observación', () => {
  it('no contiene el número: solo tipo y estado', () => {
    const discriminator = buildApolloObservationDiscriminator({
      sanitized_number: MOBILE,
      raw_number: MOBILE,
      type_cd: 'mobile',
      status_cd: 'valid',
    });
    assert.equal(discriminator.includes('5550000001'), false);
    assert.equal(discriminator.includes(MOBILE), false);
    assert.equal(discriminator, 't=mobile;s=valid');
  });

  it('la ubicación NO entra: dos copias idénticas dan el mismo discriminante', () => {
    const entry = { sanitized_number: MOBILE, type_cd: 'mobile', status_cd: 'valid' };
    assert.equal(
      buildApolloObservationDiscriminator({ ...entry }),
      buildApolloObservationDiscriminator({ ...entry }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Estado del proveedor
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — mapeo de status_cd', () => {
  it('reconoce las formas inequívocas de válido e inválido', () => {
    assert.equal(mapApolloPhoneStatus('valid'), 'valid');
    assert.equal(mapApolloPhoneStatus('VERIFIED'), 'valid');
    assert.equal(mapApolloPhoneStatus('invalid'), 'invalid');
    assert.equal(mapApolloPhoneStatus('invalid-number'), 'invalid');
    assert.equal(mapApolloPhoneStatus('disconnected'), 'invalid');
  });

  it('cualquier otra cosa cae a `unknown`, nunca a `invalid`', () => {
    // El sesgo es deliberado: llamar `invalid` a un número bueno lo excluye de
    // ser principal, y eso es mucho más caro que perder un escalón de desempate.
    for (const raw of ['no_status', 'unverified', 'pending', 'weird', '', null, undefined]) {
      assert.equal(mapApolloPhoneStatus(raw), 'unknown');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Elección del principal
// ═══════════════════════════════════════════════════════════════════

describe('4O-C-R1 — la clave del heredado coincide con la de la captura', () => {
  // INVARIANTE PORTANTE. La transacción comprueba contra los tombstones la
  // `dedupe_key` que `resolveLegacyPhoneDedupeKey` calcula; la captura calcula la
  // suya por dentro para poner el heredado a la cabeza de la preferencia. Si las dos
  // divergieran, la comprobación de privacidad miraría OTRA fila y pasaría sin
  // comprobar nada — un fallo silencioso, y del tipo peor.
  const payloads: Array<[string, ApolloPhoneRevealWebhookPayload]> = [
    ['un móvil E.164', { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] }],
    [
      'varios tipos',
      {
        phone_numbers: [
          { sanitized_number: WORK, type_cd: 'work' },
          { sanitized_number: MOBILE, type_cd: 'mobile' },
        ],
      },
    ],
    [
      'solo raw, con formato humano',
      { phone_numbers: [{ raw_number: '(555) 000-0001', type_cd: 'mobile' }] },
    ],
    [
      'el mismo número repetido en dos ubicaciones',
      {
        phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }],
        person: { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
      },
    ],
  ];

  for (const [label, payload] of payloads) {
    it(`coinciden con ${label}`, () => {
      const result = capture(payload);
      assert.ok(result.legacyBest, 'el escenario debe producir un heredado');
      const legacyKey = resolveLegacyPhoneDedupeKey(result.legacyBest);
      // El heredado es elegible en todos estos escenarios, así que la captura lo
      // pone PRIMERO en la preferencia — y esa primera clave tiene que ser la misma.
      assert.equal(result.primaryPreference[0], legacyKey);
      // Y la fila canónica de esa clave existe: se comprueba contra algo real.
      assert.ok(result.phones.some((phone) => phone.dedupeKey === legacyKey));
    });
  }
});

describe('4O-C — principal', () => {
  it('DIRECT + MOBILE ⇒ el principal es el MÓVIL (sin regresión visible)', () => {
    const result = capture({
      phone_numbers: [
        { sanitized_number: DIRECT, type_cd: 'direct_dial' },
        { sanitized_number: MOBILE, type_cd: 'mobile' },
      ],
    });
    assert.equal(primaryType(result), 'mobile');
    assert.ok(primaryIs(result, MOBILE));
    assert.equal(result.legacyBest?.number, MOBILE);
  });

  it('WORK + HQ + MOBILE ⇒ principal móvil, 3 canónicos', () => {
    const result = capture({
      phone_numbers: [
        { sanitized_number: WORK, type_cd: 'work' },
        { sanitized_number: HQ, type_cd: 'hq' },
        { sanitized_number: MOBILE, type_cd: 'mobile' },
      ],
    });
    assert.equal(result.counters.canonical_phone_count, 3);
    assert.ok(primaryIs(result, MOBILE));
  });

  it('ante DOS móviles gana el PRIMERO del payload, igual que hoy', () => {
    // Sin la cabecera de preferencia el desempate sería por hash, y el candidato
    // pasaría a guardar el otro móvil: un cambio silencioso del dato visible.
    const result = capture({
      phone_numbers: [
        { sanitized_number: MOBILE, type_cd: 'mobile' },
        { sanitized_number: DIRECT, type_cd: 'mobile' },
      ],
    });
    assert.equal(result.legacyBest?.number, MOBILE);
    assert.ok(primaryIs(result, MOBILE));
  });

  it('un número afirmado inválido se PERSISTE pero nunca es principal', () => {
    const result = capture({
      phone_numbers: [
        { sanitized_number: MOBILE, type_cd: 'mobile', status_cd: 'invalid' },
        { sanitized_number: WORK, type_cd: 'work', status_cd: 'valid' },
      ],
    });
    assert.equal(result.counters.canonical_phone_count, 2);
    // El heredado habría elegido el móvil, pero es inválido: no es elegible.
    assert.equal(result.legacyBest?.number, MOBILE);
    assert.ok(primaryIs(result, WORK));
    assert.equal(result.primaryPreference.length, 1);
  });

  it('un número sin dígitos suficientes se persiste, no es principal y no hay principal si es el único', () => {
    const result = capture({ phone_numbers: [{ sanitized_number: '555', type_cd: 'mobile' }] });
    assert.equal(result.counters.canonical_phone_count, 1);
    assert.equal(result.phones[0].keyKind, 'opaque');
    assert.equal(result.phones[0].normalizedPhone, null);
    assert.deepEqual(result.primaryPreference, []);
    // El heredado SÍ tenía un número: el escalar lo conservará por el fallback.
    assert.equal(result.legacyBest?.number, '555');
  });

  it('sin teléfonos ⇒ sin colección, sin preferencia y sin heredado', () => {
    const result = capture({ phone_numbers: [] });
    assert.deepEqual(result.phones, []);
    assert.deepEqual(result.primaryPreference, []);
    assert.equal(result.legacyBest, null);
    assert.equal(result.credits, null);
  });

  it('el orden de las ubicaciones no cambia el principal cuando el tipo decide', () => {
    const a = capture({
      phone_numbers: [{ sanitized_number: WORK, type_cd: 'work' }],
      person: { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
    });
    const b = capture({
      phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }],
      person: { phone_numbers: [{ sanitized_number: WORK, type_cd: 'work' }] },
    });
    assert.ok(primaryIs(a, MOBILE));
    assert.ok(primaryIs(b, MOBILE));
  });
});

// ═══════════════════════════════════════════════════════════════════
// Procedencia
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — procedencia', () => {
  it('el modo es `reveal` incluso bajo waterfall, y la corrida va en su columna', () => {
    const result = capture(
      { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
      { waterfallRunId: 'run-1' },
    );
    const source = result.phones[0].sources[0];
    assert.equal(source.provider, 'apollo');
    assert.equal(source.acquisitionMode, 'reveal');
    assert.equal(source.waterfallRunId, 'run-1');
  });

  it('la fase distingue webhook de recovery, y por tanto sus claves de evento', () => {
    const fromWebhook = capture(
      { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
      { phase: 'webhook' },
    );
    const fromRecovery = capture(
      { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
      { phase: 'recovery_poll' },
    );
    assert.notEqual(
      fromWebhook.phones[0].sources[0].sourceEventKey,
      fromRecovery.phones[0].sources[0].sourceEventKey,
    );
    // Misma fila canónica: la clave del NÚMERO no depende de la fase.
    assert.equal(fromWebhook.phones[0].dedupeKey, fromRecovery.phones[0].dedupeKey);
  });

  it('ids contables ausentes ⇒ null, nunca inventados', () => {
    const result = capture({ phone_numbers: [{ sanitized_number: MOBILE }] });
    const source = result.phones[0].sources[0];
    assert.equal(source.reservationId, null);
    assert.equal(source.providerUsageLogId, null);
    assert.equal(source.waterfallRunId, null);
  });

  it('la clave de evento no contiene el número ni la dedupe_key', () => {
    const result = capture({ phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] });
    const { sourceEventKey } = result.phones[0].sources[0];
    assert.equal(sourceEventKey.includes('5550000001'), false);
    assert.equal(sourceEventKey.includes(result.phones[0].dedupeKey), false);
  });

  it('reprocesar el MISMO payload da exactamente la misma colección (determinista)', () => {
    const payload: ApolloPhoneRevealWebhookPayload = {
      phone_numbers: [
        { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 },
        { sanitized_number: WORK, type_cd: 'work', credits_consumed: 4 },
      ],
    };
    assert.deepEqual(capture(payload), capture(payload));
  });
});

// ═══════════════════════════════════════════════════════════════════
// Privacidad de las cifras
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — las cifras registrables no llevan PII', () => {
  it('`counters` es solo números y una etiqueta de tipo', () => {
    const result = capture({
      phone_numbers: [
        { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 },
        { sanitized_number: WORK, type_cd: 'work' },
      ],
    });
    const serialized = JSON.stringify(result.counters);
    assert.equal(serialized.includes('5550000001'), false);
    assert.equal(serialized.includes('5550000003'), false);
    assert.equal(/\+?\d{7,}/.test(serialized), false);
    assert.deepEqual(Object.keys(result.counters).sort(), [
      'canonical_phone_count',
      'duplicate_phone_count',
      'phone_count',
      'primary_phone_type',
      'source_count',
      'valid_phone_count',
    ]);
  });
});
