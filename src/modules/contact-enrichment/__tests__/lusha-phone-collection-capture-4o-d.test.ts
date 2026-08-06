/**
 * Agente 2A — Captura canónica de los teléfonos de Lusha
 * (AGENT2A-PHONE-REVEAL-4O-D)
 *
 * Fija lo que la captura hace con la lista completa del cliente: normalizar,
 * deduplicar, conservar TODAS las procedencias y ordenar la preferencia de
 * principal sin dejar que el orden del payload decida.
 *
 * PURO: sin red, sin base de datos, sin proveedor, sin flag, sin reloj propio.
 * Todos los números son sintéticos 555.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLushaPhoneCollectionCapture,
  buildLushaObservationDiscriminator,
  resolveLushaLegacyDedupeKey,
  LUSHA_PHONE_CAPTURE_PHASE,
} from '../lusha-phone-collection-capture';
import { normalizeCandidatePhone } from '../phone-collection-core';
import {
  extractAllLushaPhones,
  selectPrimaryLushaPhone,
} from '@/server/integrations/lusha-phone-fallback-phones';

const NOW = '2026-08-06T10:00:00.000Z';
const RUN_ID = '33333333-3333-4333-8333-333333333333';

const MOBILE = '+15550000001';
const WORK = '+15550000002';
const HQ = '+15550000004';

const CONTEXT = {
  waterfallRunId: RUN_ID,
  reservationId: null,
  providerUsageLogId: null,
  observedAt: NOW,
};

/** Construye la captura desde un body crudo, igual que hace el camino real. */
function captureFrom(phones: unknown[], context = CONTEXT) {
  const parsed = extractAllLushaPhones({ results: [{ phones }] });
  return buildLushaPhoneCollectionCapture({
    phones: parsed,
    primary: selectPrimaryLushaPhone(parsed),
    context,
  });
}

const keyOf = (number: string) =>
  normalizeCandidatePhone({
    displayPhone: number,
    sanitizedPhone: number,
    countryCode: null,
  }).dedupeKey;

// ═══════════════════════════════════════════════════════════════
// 1. Colección canónica
// ═══════════════════════════════════════════════════════════════

describe('4O-D captura — colección canónica', () => {
  it('N teléfonos distintos ⇒ N filas canónicas y N procedencias', () => {
    const capture = captureFrom([
      { number: HQ, type: 'hq' },
      { number: WORK, type: 'work' },
      { number: MOBILE, type: 'mobile' },
    ]);
    assert.equal(capture.phones.length, 3);
    assert.equal(capture.counters.canonical_phone_count, 3);
    assert.equal(capture.counters.source_count, 3);
    assert.equal(capture.counters.duplicate_phone_count, 0);
  });

  it('duplicado exacto ⇒ 1 fila canónica y 1 procedencia (idempotente)', () => {
    const capture = captureFrom([
      { number: MOBILE, type: 'mobile' },
      { number: MOBILE, type: 'mobile' },
    ]);
    assert.equal(capture.phones.length, 1);
    assert.equal(capture.phones[0].sources.length, 1);
    assert.equal(capture.counters.duplicate_phone_count, 1);
  });

  it('mismo número con formato distinto ⇒ 1 fila canónica', () => {
    const capture = captureFrom([
      { number: '+1 555 000 0001', type: 'mobile' },
      { number: MOBILE, type: 'mobile' },
    ]);
    assert.equal(capture.phones.length, 1);
  });

  it('mismo número con tipos distintos ⇒ 1 fila, 2 procedencias, ambos raw intactos', () => {
    const capture = captureFrom([
      { number: MOBILE, type: 'work' },
      { number: MOBILE, type: 'mobile' },
    ]);
    assert.equal(capture.phones.length, 1);
    assert.equal(capture.phones[0].sources.length, 2);
    assert.deepEqual(
      capture.phones[0].sources.map((s) => s.rawProviderType).sort(),
      ['mobile', 'work'],
    );
    // El tipo agregado es el MEJOR de los dos observados.
    assert.equal(capture.phones[0].phoneType, 'mobile');
  });

  it('sin teléfonos ⇒ colección vacía, sin preferencia y sin escalar', () => {
    const capture = captureFrom([]);
    assert.deepEqual(capture.phones, []);
    assert.deepEqual(capture.primaryPreference, []);
    assert.equal(capture.legacyBest, null);
    assert.equal(capture.counters.primary_phone_type, null);
  });

  it('todas las filas nacen sin estado afirmado: Lusha no reporta uno por número', () => {
    const capture = captureFrom([{ number: MOBILE, type: 'mobile' }]);
    assert.equal(capture.phones[0].phoneStatus, 'unknown');
    assert.equal(capture.phones[0].sources[0].rawProviderStatus, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Procedencia
// ═══════════════════════════════════════════════════════════════

describe('4O-D captura — procedencia', () => {
  it('provider lusha, modo reveal y fase direct_enrich', () => {
    const source = captureFrom([{ number: MOBILE, type: 'mobile' }]).phones[0].sources[0];
    assert.equal(source.provider, 'lusha');
    assert.equal(source.acquisitionMode, 'reveal');
    assert.equal(source.phase, LUSHA_PHONE_CAPTURE_PHASE);
  });

  it('la pertenencia al waterfall viaja en waterfall_run_id, no en el modo', () => {
    const source = captureFrom([{ number: MOBILE, type: 'mobile' }]).phones[0].sources[0];
    assert.equal(source.waterfallRunId, RUN_ID);
    assert.equal(source.acquisitionMode, 'reveal');
  });

  it('legacy y waterfall completo producen la MISMA forma de procedencia', () => {
    const full = captureFrom([{ number: MOBILE, type: 'mobile' }]).phones[0].sources[0];
    const legacy = captureFrom([{ number: MOBILE, type: 'mobile' }], {
      ...CONTEXT,
      waterfallRunId: RUN_ID,
    }).phones[0].sources[0];
    assert.equal(full.acquisitionMode, legacy.acquisitionMode);
    assert.equal(full.phase, legacy.phase);
    assert.equal(full.sourceEventKey, legacy.sourceEventKey);
  });

  it('la clave de evento es PII-free: ni número, ni display, ni dedupe_key', () => {
    const capture = captureFrom([{ number: MOBILE, type: 'mobile' }]);
    const key = capture.phones[0].sources[0].sourceEventKey;
    assert.equal(key.includes(MOBILE), false);
    assert.equal(key.includes('5550000001'), false);
    assert.equal(key.includes(capture.phones[0].dedupeKey), false);
  });

  it('la clave de evento NO incluye la posición: reordenar no crea procedencias nuevas', () => {
    const a = captureFrom([
      { number: MOBILE, type: 'mobile' },
      { number: WORK, type: 'work' },
    ]);
    const b = captureFrom([
      { number: WORK, type: 'work' },
      { number: MOBILE, type: 'mobile' },
    ]);
    const keysOf = (c: typeof a) =>
      c.phones
        .flatMap((p) => p.sources.map((s) => `${p.dedupeKey}|${s.sourceEventKey}`))
        .sort();
    assert.deepEqual(keysOf(a), keysOf(b));
  });

  it('la clave de evento NO incluye el instante: reprocesar reconoce la observación', () => {
    const a = captureFrom([{ number: MOBILE, type: 'mobile' }]);
    const b = captureFrom([{ number: MOBILE, type: 'mobile' }], {
      ...CONTEXT,
      observedAt: '2026-09-01T00:00:00.000Z',
    });
    assert.equal(
      a.phones[0].sources[0].sourceEventKey,
      b.phones[0].sources[0].sourceEventKey,
    );
  });

  it('el discriminante distingue por tipo crudo y nada más', () => {
    assert.equal(buildLushaObservationDiscriminator({ rawType: 'mobile' }), 't=mobile');
    assert.equal(buildLushaObservationDiscriminator({ rawType: null }), 't=-');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Preferencia de principal
// ═══════════════════════════════════════════════════════════════

describe('4O-D captura — preferencia de principal', () => {
  it('WORK + MOBILE: la cabecera es el MÓVIL aunque el work viniera primero', () => {
    const capture = captureFrom([
      { number: WORK, type: 'work' },
      { number: MOBILE, type: 'mobile' },
    ]);
    assert.equal(capture.primaryPreference[0], keyOf(MOBILE));
    assert.equal(capture.legacyBest?.number, MOBILE);
    assert.equal(capture.counters.primary_phone_type, 'mobile');
  });

  it('la cabecera coincide SIEMPRE con el escalar heredado', () => {
    const capture = captureFrom([
      { number: HQ, type: 'hq' },
      { number: WORK, type: 'work' },
      { number: MOBILE, type: 'mobile' },
    ]);
    assert.equal(
      capture.primaryPreference[0],
      resolveLushaLegacyDedupeKey(capture.legacyBest!),
    );
  });

  it('el orden del payload no cambia la preferencia', () => {
    const a = captureFrom([
      { number: HQ, type: 'hq' },
      { number: MOBILE, type: 'mobile' },
      { number: WORK, type: 'work' },
    ]);
    const b = captureFrom([
      { number: WORK, type: 'work' },
      { number: HQ, type: 'hq' },
      { number: MOBILE, type: 'mobile' },
    ]);
    assert.deepEqual(a.primaryPreference, b.primaryPreference);
  });

  it('la preferencia contiene TODAS las claves elegibles, no solo la cabecera', () => {
    const capture = captureFrom([
      { number: WORK, type: 'work' },
      { number: MOBILE, type: 'mobile' },
    ]);
    assert.equal(capture.primaryPreference.length, 2);
    assert.deepEqual([...capture.primaryPreference].sort(), [keyOf(MOBILE), keyOf(WORK)].sort());
  });

  it('un número sin dígitos suficientes no puede ser principal, pero SÍ se persiste', () => {
    const capture = captureFrom([{ number: '123', type: 'mobile' }]);
    assert.equal(capture.phones.length, 1);
    assert.deepEqual(capture.primaryPreference, []);
    // El escalar heredado se conserva: el número existe y ya se pagó.
    assert.equal(capture.legacyBest?.number, '123');
  });

  it('el escalar heredado declara procedencia lusha_reveal', () => {
    const capture = captureFrom([{ number: MOBILE, type: 'mobile' }]);
    assert.equal(capture.legacyBest?.source, 'lusha_reveal');
    assert.equal(capture.legacyBest?.raw_type, 'mobile');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Contabilidad: la captura no reparte costo
// ═══════════════════════════════════════════════════════════════

describe('4O-D captura — sin costo por número', () => {
  it('la captura no expone ninguna cifra de crédito', () => {
    const capture = captureFrom([
      { number: MOBILE, type: 'mobile' },
      { number: WORK, type: 'work' },
      { number: HQ, type: 'hq' },
    ]);
    const serialized = JSON.stringify(capture);
    assert.equal(/credit/i.test(serialized), false);
    assert.equal('credits' in capture.counters, false);
  });

  it('los contadores son cifras y una etiqueta de tipo: nada de PII', () => {
    const capture = captureFrom([{ number: MOBILE, type: 'mobile' }]);
    const serialized = JSON.stringify(capture.counters);
    assert.equal(serialized.includes(MOBILE), false);
    assert.equal(serialized.includes('5550000001'), false);
    assert.equal(serialized.includes(capture.phones[0].dedupeKey), false);
  });
});
