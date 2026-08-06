/**
 * Tests — modelo canónico de MÚLTIPLES teléfonos por candidato
 * (Agente 2A · AGENT2A-PHONE-REVEAL-4O-B)
 *
 * Puro y offline por construcción: sin red, sin Supabase, sin Apollo, sin Lusha,
 * 0 créditos. Todos los números son SINTÉTICOS — el rango `555 0xx xxxx` está
 * reservado para ficción justamente para esto. No hay ni un dato real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { PhoneType } from '@/server/agents/contact-enrichment-toolkit/phone-classification';
import {
  aggregateCandidatePhoneStatus,
  aggregateCandidatePhoneType,
  applyCandidatePhoneSuppression,
  buildCandidatePhoneSourceEventKey,
  CANDIDATE_PHONE_TYPE_RANKING,
  compareCandidatePhones,
  isCandidatePhoneEligibleForPrimary,
  mergeCandidatePhoneInputs,
  normalizeCandidatePhone,
  selectPrimaryCandidatePhone,
  sortCandidatePhones,
  type CandidatePhoneAcquisitionMode,
  type CandidatePhoneProvider,
  type CandidatePhoneStatus,
  type CanonicalCandidatePhoneInput,
} from '../phone-collection-core';

// ── Constructores de entrada sintética ─────────────────────────────

function makeInput(
  overrides: Partial<CanonicalCandidatePhoneInput> & {
    provider?: CandidatePhoneProvider;
    acquisitionMode?: CandidatePhoneAcquisitionMode;
    observedAt?: string;
    phase?: string | null;
    rawProviderType?: string | null;
    rawProviderStatus?: string | null;
    waterfallRunId?: string | null;
    reservationId?: string | null;
    providerUsageLogId?: string | null;
  } = {},
): CanonicalCandidatePhoneInput {
  const {
    provider = 'apollo',
    acquisitionMode = 'reveal',
    observedAt = '2026-08-05T10:00:00.000Z',
    phase = null,
    rawProviderType = null,
    rawProviderStatus = null,
    waterfallRunId = null,
    reservationId = null,
    providerUsageLogId = null,
    ...rest
  } = overrides;

  return {
    displayPhone: '+1 555 000 0001',
    sanitizedPhone: '+15550000001',
    countryCode: null,
    phoneType: 'mobile',
    phoneStatus: 'unknown',
    ...rest,
    source: {
      provider,
      acquisitionMode,
      phase,
      rawProviderType,
      rawProviderStatus,
      waterfallRunId,
      reservationId,
      providerUsageLogId,
      observedAt,
      ...(rest.source ?? {}),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 9.2 Normalización conservadora
// ═══════════════════════════════════════════════════════════════════

describe('normalizeCandidatePhone — E.164 solo cuando es verificable', () => {
  it('un número con `+` y longitud válida produce E.164', () => {
    const result = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001',
      countryCode: null,
    });
    assert.equal(result.normalizedPhone, '+15550000001');
    assert.equal(result.keyKind, 'e164');
  });

  it('el mismo número con espacios da EXACTAMENTE la misma clave', () => {
    const a = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001',
      countryCode: null,
    });
    const b = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+1 555 000 0001',
      countryCode: null,
    });
    assert.equal(a.dedupeKey, b.dedupeKey);
  });

  it('el prefijo internacional `00` equivale a `+` (la ITU lo reserva para eso)', () => {
    const plus = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001',
      countryCode: null,
    });
    const zeros = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '0015550000001',
      countryCode: null,
    });
    assert.equal(zeros.normalizedPhone, '+15550000001');
    assert.equal(zeros.keyKind, 'e164');
    assert.equal(zeros.dedupeKey, plus.dedupeKey);
  });

  it('un formato NACIONAL no inventa país: no es E.164 y no colapsa con el internacional', () => {
    const national = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '(555) 000-0001',
      countryCode: null,
    });
    const international = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001',
      countryCode: null,
    });

    assert.equal(national.keyKind, 'digits');
    // Conserva el número, pero NO lo afirma como E.164: sin `+`.
    assert.equal(national.normalizedPhone, '5550000001');
    assert.equal(national.normalizedPhone?.startsWith('+'), false);
    assert.notEqual(national.dedupeKey, international.dedupeKey);
  });

  it('el país NUNCA fabrica un prefijo ni cambia la clave (presente vs ausente)', () => {
    const withCountry = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '(555) 000-0001',
      countryCode: 'US',
    });
    const withoutCountry = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '(555) 000-0001',
      countryCode: null,
    });

    assert.equal(withCountry.dedupeKey, withoutCountry.dedupeKey);
    assert.equal(withCountry.normalizedPhone, '5550000001');
    assert.equal(withCountry.keyKind, 'digits');
  });

  it('el saneado del proveedor manda para la clave; el display se conserva aparte', () => {
    const result = normalizeCandidatePhone({
      displayPhone: '(555) 000-0001 ',
      sanitizedPhone: '+15550000001',
      countryCode: null,
    });
    assert.equal(result.normalizedPhone, '+15550000001');
    assert.equal(result.displayPhone, '(555) 000-0001');
  });

  it('sin saneado, el display sirve de fuente de clave', () => {
    const fromDisplay = normalizeCandidatePhone({
      displayPhone: '+15550000001',
      sanitizedPhone: null,
      countryCode: null,
    });
    const fromSanitized = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001',
      countryCode: null,
    });
    assert.equal(fromDisplay.dedupeKey, fromSanitized.dedupeKey);
  });

  it('un número incompleto no produce E.164 ni clave basada en dígitos', () => {
    const result = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+1555',
      countryCode: null,
    });
    assert.equal(result.normalizedPhone, null);
    assert.equal(result.keyKind, 'opaque');
  });

  it('un número vacío queda sin número y con clave opaca', () => {
    for (const value of ['', '   ', null]) {
      const result = normalizeCandidatePhone({
        displayPhone: null,
        sanitizedPhone: value,
        countryCode: null,
      });
      assert.equal(result.normalizedPhone, null);
      assert.equal(result.keyKind, 'opaque');
    }
  });
});

describe('normalizeCandidatePhone — extensiones', () => {
  it('la extensión se separa del número', () => {
    const result = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001 x123',
      countryCode: null,
    });
    assert.equal(result.normalizedPhone, '+15550000001');
    assert.equal(result.extension, '123');
  });

  it('las formas habituales de extensión se reconocen igual', () => {
    const keys = ['+15550000001 x123', '+15550000001 ext. 123', '+15550000001#123'].map(
      (value) =>
        normalizeCandidatePhone({
          displayPhone: null,
          sanitizedPhone: value,
          countryCode: null,
        }).dedupeKey,
    );
    assert.equal(new Set(keys).size, 1);
  });

  it('mismo número con extensiones DISTINTAS son entradas distintas', () => {
    const a = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001 x123',
      countryCode: null,
    });
    const b = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001 x999',
      countryCode: null,
    });
    const none = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001',
      countryCode: null,
    });

    assert.equal(new Set([a.dedupeKey, b.dedupeKey, none.dedupeKey]).size, 3);
  });
});

describe('dedupe_key — nunca contiene el número', () => {
  it('la clave es `<clase>:<sha256>` y no expone ningún dígito del teléfono', () => {
    const result = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001',
      countryCode: null,
    });

    assert.match(result.dedupeKey, /^e164:[0-9a-f]{64}$/);
    // El hash es hexadecimal, así que "no contiene el número" se comprueba sobre
    // la subcadena completa, que es lo que un volcado de la tabla revelaría.
    assert.equal(result.dedupeKey.includes('15550000001'), false);
    assert.equal(result.dedupeKey.includes('5550000001'), false);
  });

  it('también en la clase `digits` y en la clase `opaque`', () => {
    const digits = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '(555) 000-0001',
      countryCode: null,
    });
    const opaque = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+1555',
      countryCode: null,
    });

    assert.match(digits.dedupeKey, /^digits:[0-9a-f]{64}$/);
    assert.equal(digits.dedupeKey.includes('5550000001'), false);
    assert.match(opaque.dedupeKey, /^opaque:[0-9a-f]{64}$/);
    assert.equal(opaque.dedupeKey.includes('1555'), false);
  });

  it('es determinista: la misma entrada da siempre la misma clave', () => {
    const once = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001',
      countryCode: null,
    });
    const twice = normalizeCandidatePhone({
      displayPhone: null,
      sanitizedPhone: '+15550000001',
      countryCode: null,
    });
    assert.equal(once.dedupeKey, twice.dedupeKey);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9.3 Deduplicación
// ═══════════════════════════════════════════════════════════════════

describe('mergeCandidatePhoneInputs — deduplicación', () => {
  it('mismo número en formatos diferentes ⇒ 1 fila canónica', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({ sanitizedPhone: '+15550000001', displayPhone: null }),
      makeInput({ sanitizedPhone: '+1 555 000 0001', displayPhone: null, provider: 'lusha' }),
      makeInput({ sanitizedPhone: '0015550000001', displayPhone: null, provider: 'manual' }),
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].normalizedPhone, '+15550000001');
  });

  it('Apollo + Lusha con el MISMO número ⇒ 1 canónico + 2 procedencias', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({
        provider: 'apollo',
        acquisitionMode: 'reveal',
        rawProviderType: 'mobile',
        rawProviderStatus: 'verified',
      }),
      makeInput({
        provider: 'lusha',
        acquisitionMode: 'reveal',
        rawProviderType: 'cellphone',
        rawProviderStatus: 'ok',
      }),
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].sources.length, 2);
    assert.deepEqual(
      merged[0].sources.map((source) => source.provider).sort(),
      ['apollo', 'lusha'],
    );
    // Ninguna procedencia se descarta ni se pisa: los dos `raw` sobreviven.
    assert.deepEqual(
      merged[0].sources.map((source) => source.rawProviderType).sort(),
      ['cellphone', 'mobile'],
    );
    assert.deepEqual(
      merged[0].sources.map((source) => source.rawProviderStatus).sort(),
      ['ok', 'verified'],
    );
  });

  it('mismo número con tipos diferentes ⇒ gana el MEJOR tipo, sin perder los crudos', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({ phoneType: 'work', provider: 'apollo', rawProviderType: 'office' }),
      makeInput({
        phoneType: 'personal_mobile',
        provider: 'lusha',
        rawProviderType: 'personal',
      }),
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].phoneType, 'personal_mobile');
    assert.deepEqual(
      merged[0].sources.map((source) => source.rawProviderType).sort(),
      ['office', 'personal'],
    );
  });

  it('dos entradas inválidas DIFERENTES no se colapsan entre sí', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({ sanitizedPhone: '+1555', displayPhone: null }),
      makeInput({ sanitizedPhone: '+1666', displayPhone: null, provider: 'lusha' }),
    ]);

    assert.equal(merged.length, 2);
  });

  it('la MISMA entrada inválida repetida sí es una sola fila', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({ sanitizedPhone: '+1555', displayPhone: null, provider: 'apollo' }),
      makeInput({ sanitizedPhone: '+1555', displayPhone: null, provider: 'lusha' }),
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].sources.length, 2);
  });

  it('mismo número con extensiones diferentes ⇒ entradas diferentes', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({ sanitizedPhone: '+15550000001 x123', displayPhone: null }),
      makeInput({ sanitizedPhone: '+15550000001 x999', displayPhone: null }),
    ]);

    assert.equal(merged.length, 2);
  });

  it('la fusión no muta la entrada', () => {
    const inputs = [makeInput(), makeInput({ provider: 'lusha' })];
    const snapshot = JSON.parse(JSON.stringify(inputs));
    mergeCandidatePhoneInputs(inputs);
    assert.deepEqual(JSON.parse(JSON.stringify(inputs)), snapshot);
  });

  it('conserva el primer y el último avistamiento', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({ observedAt: '2026-08-05T12:00:00.000Z', provider: 'apollo' }),
      makeInput({ observedAt: '2026-08-05T09:00:00.000Z', provider: 'lusha' }),
    ]);

    assert.equal(merged[0].firstSeenAt, '2026-08-05T09:00:00.000Z');
    assert.equal(merged[0].lastSeenAt, '2026-08-05T12:00:00.000Z');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Estado agregado
// ═══════════════════════════════════════════════════════════════════

describe('aggregateCandidatePhoneStatus', () => {
  it('alguna fuente `valid` ⇒ valid', () => {
    assert.equal(aggregateCandidatePhoneStatus(['unknown', 'valid']), 'valid');
  });

  it('una fuente `invalid` NO degrada un número confirmado por otra', () => {
    assert.equal(aggregateCandidatePhoneStatus(['valid', 'invalid']), 'valid');
    assert.equal(aggregateCandidatePhoneStatus(['invalid', 'valid']), 'valid');
  });

  it('todas las fuentes explícitas `invalid` ⇒ invalid', () => {
    assert.equal(aggregateCandidatePhoneStatus(['invalid', 'invalid']), 'invalid');
    assert.equal(aggregateCandidatePhoneStatus(['invalid', 'unknown']), 'invalid');
  });

  it('sin evidencia suficiente ⇒ unknown', () => {
    assert.equal(aggregateCandidatePhoneStatus([]), 'unknown');
    assert.equal(aggregateCandidatePhoneStatus(['unknown', 'unknown']), 'unknown');
  });

  it('el resultado no depende del orden', () => {
    const combos: CandidatePhoneStatus[][] = [
      ['valid', 'invalid', 'unknown'],
      ['unknown', 'invalid', 'valid'],
      ['invalid', 'unknown', 'valid'],
    ];
    const results = combos.map((combo) => aggregateCandidatePhoneStatus(combo));
    assert.deepEqual(results, ['valid', 'valid', 'valid']);
  });
});

describe('aggregateCandidatePhoneType', () => {
  it('elige el mejor tipo según el ranking', () => {
    assert.equal(aggregateCandidatePhoneType(['work', 'personal_mobile']), 'personal_mobile');
    assert.equal(aggregateCandidatePhoneType(['hq', 'direct_dial']), 'direct_dial');
  });

  it('sin tipos ⇒ unknown', () => {
    assert.equal(aggregateCandidatePhoneType([]), 'unknown');
  });

  it('el ranking es exactamente el contrato acordado', () => {
    assert.deepEqual([...CANDIDATE_PHONE_TYPE_RANKING], [
      'personal_mobile',
      'mobile',
      'direct_dial',
      'work',
      'hq',
      'other',
      'unknown',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9.4 Principal
// ═══════════════════════════════════════════════════════════════════

function phoneOf(
  overrides: Partial<CanonicalCandidatePhoneInput> & {
    provider?: CandidatePhoneProvider;
    acquisitionMode?: CandidatePhoneAcquisitionMode;
    observedAt?: string;
  },
) {
  return makeInput(overrides);
}

describe('selectPrimaryCandidatePhone — ranking del principal', () => {
  const pairs: ReadonlyArray<[PhoneType, PhoneType]> = [
    ['personal_mobile', 'mobile'],
    ['mobile', 'direct_dial'],
    ['direct_dial', 'work'],
    ['work', 'hq'],
    ['hq', 'other'],
    ['other', 'unknown'],
  ];

  for (const [winner, loser] of pairs) {
    it(`${winner} gana a ${loser}`, () => {
      const merged = mergeCandidatePhoneInputs([
        phoneOf({ sanitizedPhone: '+15550000002', displayPhone: null, phoneType: loser }),
        phoneOf({ sanitizedPhone: '+15550000001', displayPhone: null, phoneType: winner }),
      ]);
      const primaryKey = selectPrimaryCandidatePhone(merged);
      const primary = merged.find((phone) => phone.dedupeKey === primaryKey);
      assert.equal(primary?.phoneType, winner);
      assert.equal(primary?.normalizedPhone, '+15550000001');
    });
  }

  it('un móvil válido gana a un `work`, aunque el work llegue primero', () => {
    const merged = mergeCandidatePhoneInputs([
      phoneOf({
        sanitizedPhone: '+15550000009',
        displayPhone: null,
        phoneType: 'work',
        phoneStatus: 'valid',
      }),
      phoneOf({
        sanitizedPhone: '+15550000001',
        displayPhone: null,
        phoneType: 'mobile',
        phoneStatus: 'valid',
      }),
    ]);
    const primary = merged.find((phone) => phone.isPrimary);
    assert.equal(primary?.phoneType, 'mobile');
  });

  it('`valid` gana a `unknown` cuando el tipo empata', () => {
    const merged = mergeCandidatePhoneInputs([
      phoneOf({
        sanitizedPhone: '+15550000002',
        displayPhone: null,
        phoneType: 'mobile',
        phoneStatus: 'unknown',
      }),
      phoneOf({
        sanitizedPhone: '+15550000001',
        displayPhone: null,
        phoneType: 'mobile',
        phoneStatus: 'valid',
      }),
    ]);
    const primary = merged.find((phone) => phone.isPrimary);
    assert.equal(primary?.phoneStatus, 'valid');
    assert.equal(primary?.normalizedPhone, '+15550000001');
  });

  it('un número INVÁLIDO nunca es principal', () => {
    const merged = mergeCandidatePhoneInputs([
      phoneOf({
        sanitizedPhone: '+15550000001',
        displayPhone: null,
        phoneType: 'personal_mobile',
        phoneStatus: 'invalid',
      }),
      phoneOf({
        sanitizedPhone: '+15550000002',
        displayPhone: null,
        phoneType: 'hq',
        phoneStatus: 'valid',
      }),
    ]);

    const primary = merged.find((phone) => phone.isPrimary);
    // El personal_mobile gana el ranking de tipo, pero es inválido ⇒ pierde igual.
    assert.equal(primary?.phoneType, 'hq');
    assert.equal(primary?.phoneStatus, 'valid');
  });

  it('sin ningún teléfono elegible el principal es null', () => {
    const merged = mergeCandidatePhoneInputs([
      phoneOf({
        sanitizedPhone: '+15550000001',
        displayPhone: null,
        phoneStatus: 'invalid',
      }),
    ]);
    assert.equal(selectPrimaryCandidatePhone(merged), null);
    assert.equal(merged.some((phone) => phone.isPrimary), false);
  });

  it('una entrada sin número normalizado no puede ser principal', () => {
    const merged = mergeCandidatePhoneInputs([
      phoneOf({ sanitizedPhone: '+1555', displayPhone: null, phoneType: 'personal_mobile' }),
    ]);
    assert.equal(merged[0].normalizedPhone, null);
    assert.equal(isCandidatePhoneEligibleForPrimary(merged[0]), false);
    assert.equal(selectPrimaryCandidatePhone(merged), null);
  });

  it('dos móviles empatados desempatan de forma ESTABLE por procedencia', () => {
    const merged = mergeCandidatePhoneInputs([
      phoneOf({
        sanitizedPhone: '+15550000002',
        displayPhone: null,
        phoneType: 'mobile',
        phoneStatus: 'valid',
        provider: 'apollo',
        acquisitionMode: 'search',
      }),
      phoneOf({
        sanitizedPhone: '+15550000001',
        displayPhone: null,
        phoneType: 'mobile',
        phoneStatus: 'valid',
        provider: 'apollo',
        acquisitionMode: 'reveal',
      }),
    ]);

    const primary = merged.find((phone) => phone.isPrimary);
    // El reveal pagado es más específico que el tipo gratuito del search.
    assert.equal(primary?.normalizedPhone, '+15550000001');
  });

  it('EL ORDEN DE ENTRADA NO CAMBIA EL RESULTADO', () => {
    const inputs = [
      phoneOf({ sanitizedPhone: '+15550000001', displayPhone: null, phoneType: 'work' }),
      phoneOf({ sanitizedPhone: '+15550000002', displayPhone: null, phoneType: 'mobile' }),
      phoneOf({ sanitizedPhone: '+15550000003', displayPhone: null, phoneType: 'hq' }),
      phoneOf({
        sanitizedPhone: '+15550000004',
        displayPhone: null,
        phoneType: 'personal_mobile',
      }),
    ];

    const permutations = [
      inputs,
      [...inputs].reverse(),
      [inputs[2], inputs[0], inputs[3], inputs[1]],
      [inputs[1], inputs[3], inputs[2], inputs[0]],
    ];

    const primaries = permutations.map((permutation) => {
      const merged = mergeCandidatePhoneInputs(permutation);
      const key = selectPrimaryCandidatePhone(merged);
      return merged.find((phone) => phone.dedupeKey === key)?.normalizedPhone;
    });

    assert.deepEqual(primaries, [
      '+15550000004',
      '+15550000004',
      '+15550000004',
      '+15550000004',
    ]);
  });

  it('exactamente UNA fila queda marcada como principal', () => {
    const merged = mergeCandidatePhoneInputs([
      phoneOf({ sanitizedPhone: '+15550000001', displayPhone: null, phoneType: 'mobile' }),
      phoneOf({ sanitizedPhone: '+15550000002', displayPhone: null, phoneType: 'work' }),
      phoneOf({ sanitizedPhone: '+15550000003', displayPhone: null, phoneType: 'hq' }),
    ]);

    assert.equal(merged.filter((phone) => phone.isPrimary).length, 1);
  });

  it('el orden de presentación es determinista y total', () => {
    const merged = mergeCandidatePhoneInputs([
      phoneOf({ sanitizedPhone: '+15550000003', displayPhone: null, phoneType: 'hq' }),
      phoneOf({ sanitizedPhone: '+15550000001', displayPhone: null, phoneType: 'mobile' }),
      phoneOf({ sanitizedPhone: '+15550000002', displayPhone: null, phoneType: 'work' }),
    ]);

    const sorted = sortCandidatePhones(merged);
    assert.deepEqual(
      sorted.map((phone) => phone.phoneType),
      ['mobile', 'work', 'hq'],
    );
    // Comparador total: ordenar dos veces no cambia nada.
    assert.deepEqual(
      sortCandidatePhones(sorted).map((phone) => phone.dedupeKey),
      sorted.map((phone) => phone.dedupeKey),
    );
    assert.equal(compareCandidatePhones(sorted[0], sorted[0]), 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9.4 (cont.) Supresión y reelección
// ═══════════════════════════════════════════════════════════════════

describe('applyCandidatePhoneSuppression', () => {
  const collection = () =>
    mergeCandidatePhoneInputs([
      phoneOf({
        sanitizedPhone: '+15550000001',
        displayPhone: '+1 555 000 0001',
        phoneType: 'personal_mobile',
        phoneStatus: 'valid',
      }),
      phoneOf({
        sanitizedPhone: '+15550000002',
        displayPhone: '+1 555 000 0002',
        phoneType: 'work',
        phoneStatus: 'valid',
      }),
    ]);

  it('suprimir el principal REELIGE el siguiente teléfono vivo', () => {
    const phones = collection();
    const primaryKey = selectPrimaryCandidatePhone(phones);
    assert.ok(primaryKey);

    const decision = applyCandidatePhoneSuppression(phones, {
      dedupeKey: primaryKey,
      reason: 'data_subject_request',
      suppressedBy: '00000000-0000-4000-8000-000000000001',
      suppressedAt: '2026-08-05T13:00:00.000Z',
    });

    assert.equal(decision.tombstonedDedupeKey, primaryKey);
    assert.equal(decision.demotedPrimaryDedupeKey, primaryKey);
    assert.ok(decision.nextPrimaryDedupeKey);
    assert.notEqual(decision.nextPrimaryDedupeKey, primaryKey);
    assert.equal(decision.scalarPhoneShouldBecomeNull, false);

    const next = decision.phones.find(
      (phone) => phone.dedupeKey === decision.nextPrimaryDedupeKey,
    );
    assert.equal(next?.phoneType, 'work');
    assert.equal(next?.isPrimary, true);
    assert.equal(decision.phones.filter((phone) => phone.isPrimary).length, 1);
  });

  it('el tombstone conserva la clave y NO conserva el número', () => {
    const phones = collection();
    const primaryKey = selectPrimaryCandidatePhone(phones)!;

    const decision = applyCandidatePhoneSuppression(phones, {
      dedupeKey: primaryKey,
      reason: 'data_subject_request',
      suppressedBy: null,
      suppressedAt: '2026-08-05T13:00:00.000Z',
    });

    const tombstone = decision.phones.find((phone) => phone.dedupeKey === primaryKey);
    assert.ok(tombstone);
    assert.equal(tombstone.dedupeKey, primaryKey);
    assert.equal(tombstone.normalizedPhone, null);
    assert.equal(tombstone.displayPhone, null);
    assert.equal(tombstone.extension, null);
    assert.equal(tombstone.phoneType, null);
    assert.equal(tombstone.isPrimary, false);
    assert.equal(tombstone.suppressedAt, '2026-08-05T13:00:00.000Z');
    // La procedencia SOBREVIVE: es la prueba PII-free de que hubo una observación.
    assert.ok(tombstone.sources.length > 0);
  });

  it('suprimir el ÚNICO teléfono deja el escalar futuro en null', () => {
    const phones = mergeCandidatePhoneInputs([
      phoneOf({
        sanitizedPhone: '+15550000001',
        displayPhone: null,
        phoneType: 'mobile',
        phoneStatus: 'valid',
      }),
    ]);
    const primaryKey = selectPrimaryCandidatePhone(phones)!;

    const decision = applyCandidatePhoneSuppression(phones, {
      dedupeKey: primaryKey,
      reason: 'data_subject_request',
      suppressedBy: null,
      suppressedAt: '2026-08-05T13:00:00.000Z',
    });

    assert.equal(decision.nextPrimaryDedupeKey, null);
    assert.equal(decision.scalarPhoneShouldBecomeNull, true);
    assert.equal(decision.phones.some((phone) => phone.isPrimary), false);
  });

  it('un teléfono suprimido NUNCA vuelve a ser principal', () => {
    const phones = collection();
    const primaryKey = selectPrimaryCandidatePhone(phones)!;
    const decision = applyCandidatePhoneSuppression(phones, {
      dedupeKey: primaryKey,
      reason: 'operator_request',
      suppressedBy: null,
      suppressedAt: '2026-08-05T13:00:00.000Z',
    });

    const tombstone = decision.phones.find((phone) => phone.dedupeKey === primaryKey)!;
    assert.equal(isCandidatePhoneEligibleForPrimary(tombstone), false);
    assert.notEqual(selectPrimaryCandidatePhone(decision.phones), primaryKey);
  });

  it('suprimir un no-principal no toca el principal', () => {
    const phones = collection();
    const primaryKey = selectPrimaryCandidatePhone(phones)!;
    const other = phones.find((phone) => phone.dedupeKey !== primaryKey)!;

    const decision = applyCandidatePhoneSuppression(phones, {
      dedupeKey: other.dedupeKey,
      reason: 'provider_retraction',
      suppressedBy: null,
      suppressedAt: '2026-08-05T13:00:00.000Z',
    });

    assert.equal(decision.demotedPrimaryDedupeKey, null);
    assert.equal(decision.nextPrimaryDedupeKey, primaryKey);
    assert.equal(decision.scalarPhoneShouldBecomeNull, false);
  });

  it('suprimir dos veces es idempotente y no muta la entrada', () => {
    const phones = collection();
    const primaryKey = selectPrimaryCandidatePhone(phones)!;
    const snapshot = JSON.parse(JSON.stringify(phones));

    const first = applyCandidatePhoneSuppression(phones, {
      dedupeKey: primaryKey,
      reason: 'data_subject_request',
      suppressedBy: null,
      suppressedAt: '2026-08-05T13:00:00.000Z',
    });
    const second = applyCandidatePhoneSuppression(first.phones, {
      dedupeKey: primaryKey,
      reason: 'data_subject_request',
      suppressedBy: null,
      suppressedAt: '2026-08-05T14:00:00.000Z',
    });

    assert.equal(second.tombstonedDedupeKey, null);
    assert.equal(
      second.phones.find((phone) => phone.dedupeKey === primaryKey)?.suppressedAt,
      '2026-08-05T13:00:00.000Z',
    );
    assert.deepEqual(JSON.parse(JSON.stringify(phones)), snapshot);
  });

  it('suprimir una clave inexistente no tiene efectos', () => {
    const phones = collection();
    const decision = applyCandidatePhoneSuppression(phones, {
      dedupeKey: 'e164:' + '0'.repeat(64),
      reason: 'operator_request',
      suppressedBy: null,
      suppressedAt: '2026-08-05T13:00:00.000Z',
    });

    assert.equal(decision.tombstonedDedupeKey, null);
    assert.equal(decision.nextPrimaryDedupeKey, selectPrimaryCandidatePhone(phones));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9.5 Procedencias
// ═══════════════════════════════════════════════════════════════════

describe('buildCandidatePhoneSourceEventKey', () => {
  const base = {
    provider: 'apollo' as CandidatePhoneProvider,
    acquisitionMode: 'reveal' as CandidatePhoneAcquisitionMode,
    phase: 'start' as string | null,
    waterfallRunId: '11111111-1111-4111-8111-111111111111',
    reservationId: '22222222-2222-4222-8222-222222222222',
    providerUsageLogId: '33333333-3333-4333-8333-333333333333',
  };

  it('es determinista', () => {
    assert.equal(
      buildCandidatePhoneSourceEventKey(base),
      buildCandidatePhoneSourceEventKey({ ...base }),
    );
  });

  it('NO contiene PII: ni teléfono, ni correo, ni nombre, ni LinkedIn', () => {
    const key = buildCandidatePhoneSourceEventKey(base);

    // La clave SÍ lleva UUIDs (ids de filas propias de SellUp, opacos y sin PII),
    // así que "no contiene dígitos" sería una prueba falsa. Lo que debe cumplirse
    // es que NADA derivado de la persona entre en la clave.
    assert.equal(key.includes('@'), false, 'sin correo');
    assert.equal(/linkedin/i.test(key), false, 'sin LinkedIn');

    // La clave se compone EXACTAMENTE de las partes declaradas y de nada más.
    assert.deepEqual(key.split(':'), [
      'v1',
      base.provider,
      base.acquisitionMode,
      base.phase,
      base.waterfallRunId,
      base.reservationId,
      base.providerUsageLogId,
    ]);
  });

  it('el teléfono NO entra en la clave de procedencia', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({
        ...base,
        sanitizedPhone: '+15550000001',
        displayPhone: '(555) 000-0001',
      }),
    ]);

    const key = merged[0].sources[0].sourceEventKey;
    for (const fragment of ['15550000001', '5550000001', '0000001', '555']) {
      assert.equal(
        key.includes(fragment),
        false,
        `la clave de procedencia no debe contener \`${fragment}\``,
      );
    }
    // Y cambiar SOLO el número no cambia la clave de procedencia: la procedencia
    // identifica el EVENTO, no el dato observado.
    const other = mergeCandidatePhoneInputs([
      makeInput({ ...base, sanitizedPhone: '+15550000009', displayPhone: null }),
    ]);
    assert.equal(other[0].sources[0].sourceEventKey, key);
  });

  it('NO depende de `observedAt`: reprocesar el mismo evento no duplica', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({ ...base, observedAt: '2026-08-05T10:00:00.000Z' }),
      makeInput({ ...base, observedAt: '2026-08-05T18:30:00.000Z' }),
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].sources.length, 1, 'la misma procedencia no se duplica');
  });

  it('la FASE distingue dos observaciones del mismo reveal (start vs webhook)', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({ ...base, phase: 'start' }),
      makeInput({ ...base, phase: 'webhook' }),
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].sources.length, 2);
    assert.deepEqual(
      merged[0].sources.map((source) => source.phase).sort(),
      ['start', 'webhook'],
    );
  });

  it('una procedencia DISTINTA se conserva junto a la anterior', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({ ...base }),
      makeInput({ ...base, provider: 'lusha', providerUsageLogId: null }),
    ]);

    assert.equal(merged[0].sources.length, 2);
  });

  it('un id operativo distinto produce una procedencia distinta', () => {
    assert.notEqual(
      buildCandidatePhoneSourceEventKey(base),
      buildCandidatePhoneSourceEventKey({
        ...base,
        reservationId: '44444444-4444-4444-8444-444444444444',
      }),
    );
  });

  it('los ids ausentes no colapsan con la cadena vacía de forma ambigua', () => {
    const key = buildCandidatePhoneSourceEventKey({
      ...base,
      phase: null,
      waterfallRunId: null,
      reservationId: null,
      providerUsageLogId: null,
    });
    assert.equal(key, 'v1:apollo:reveal:-:-:-:-');
  });
});

describe('la fila canónica NO lleva contabilidad', () => {
  it('no expone costo, créditos ni un proveedor único', () => {
    const merged = mergeCandidatePhoneInputs([
      makeInput({ provider: 'apollo' }),
      makeInput({ provider: 'lusha' }),
    ]);

    const keys = Object.keys(merged[0]);
    for (const forbidden of [
      'cost',
      'credits',
      'creditsUsed',
      'costUsd',
      'provider',
      'waterfallRunId',
      'reservationId',
      'providerUsageLogId',
    ]) {
      assert.equal(
        keys.includes(forbidden),
        false,
        `la fila canónica no debe llevar \`${forbidden}\``,
      );
    }

    // Todo lo de procedencia vive en las fuentes, y ahí tampoco hay dinero.
    const sourceKeys = Object.keys(merged[0].sources[0]);
    for (const forbidden of ['cost', 'credits', 'creditsUsed', 'costUsd']) {
      assert.equal(sourceKeys.includes(forbidden), false);
    }
    assert.ok(sourceKeys.includes('providerUsageLogId'));
  });
});
