/**
 * Agente 2A — Lectura COMPLETA de los teléfonos de Lusha, pura
 * (AGENT2A-PHONE-REVEAL-4O-D)
 *
 * Fija el comportamiento que sustituye a `extractFirstPhone()`: leer TODO el
 * array, mapear los tipos de forma conservadora y elegir el escalar por ranking y
 * no por posición.
 *
 * Sin red, sin base de datos, sin proveedor, sin flag. Todos los números son
 * sintéticos 555.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractAllLushaPhones,
  mapLushaPhoneTypeToPhoneType,
  selectPrimaryLushaPhone,
} from '../lusha-phone-fallback-phones';

const MOBILE = '+15550000001';
const WORK = '+15550000002';
const DIRECT = '+15550000003';
const HQ = '+15550000004';

const body = (phones: unknown[]) => ({
  results: [{ phones }],
  billing: { creditsCharged: 5 },
});

// ═══════════════════════════════════════════════════════════════
// 1. Extracción
// ═══════════════════════════════════════════════════════════════

describe('4O-D — extractAllLushaPhones', () => {
  it('un solo móvil', () => {
    const phones = extractAllLushaPhones(body([{ number: MOBILE, type: 'mobile' }]));
    assert.equal(phones.length, 1);
    assert.deepEqual(phones[0], { number: MOBILE, rawType: 'mobile', phoneType: 'mobile' });
  });

  it('DIRECT + MOBILE: los DOS se leen, ninguno se pierde', () => {
    const phones = extractAllLushaPhones(
      body([
        { number: DIRECT, type: 'direct' },
        { number: MOBILE, type: 'mobile' },
      ]),
    );
    assert.equal(phones.length, 2);
    assert.deepEqual(
      phones.map((p) => p.number),
      [DIRECT, MOBILE],
    );
  });

  it('WORK + MOBILE: los DOS se leen (el caso que el bug perdía)', () => {
    const phones = extractAllLushaPhones(
      body([
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ]),
    );
    assert.equal(phones.length, 2);
    assert.deepEqual(
      phones.map((p) => p.phoneType),
      ['work', 'mobile'],
    );
  });

  it('HQ + WORK + MOBILE: los TRES se leen', () => {
    const phones = extractAllLushaPhones(
      body([
        { number: HQ, type: 'hq' },
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ]),
    );
    assert.equal(phones.length, 3);
  });

  it('duplicado exacto: se leen DOS entradas — deduplicar es de la capa canónica', () => {
    const phones = extractAllLushaPhones(
      body([
        { number: MOBILE, type: 'mobile' },
        { number: MOBILE, type: 'mobile' },
      ]),
    );
    assert.equal(phones.length, 2);
  });

  it('mismo número con formato distinto: dos entradas, sin normalizar aquí', () => {
    const phones = extractAllLushaPhones(
      body([
        { number: '+1 555 000 0001', type: 'mobile' },
        { number: MOBILE, type: 'mobile' },
      ]),
    );
    assert.equal(phones.length, 2);
    assert.equal(phones[0].number, '+1 555 000 0001');
  });

  it('mismo número con tipos distintos: dos entradas, cada una con su tipo crudo', () => {
    const phones = extractAllLushaPhones(
      body([
        { number: MOBILE, type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ]),
    );
    assert.equal(phones.length, 2);
    assert.deepEqual(
      phones.map((p) => p.rawType),
      ['work', 'mobile'],
    );
  });

  it('entrada vacía: se ignora por completo', () => {
    const phones = extractAllLushaPhones(
      body([{}, { number: MOBILE, type: 'mobile' }]),
    );
    assert.equal(phones.length, 1);
    assert.equal(phones[0].number, MOBILE);
  });

  it('number null / vacío / no-string: se ignoran', () => {
    const phones = extractAllLushaPhones(
      body([
        { number: null, type: 'mobile' },
        { number: '   ', type: 'mobile' },
        { number: 15550000001, type: 'mobile' },
        { number: MOBILE, type: 'mobile' },
      ]),
    );
    assert.equal(phones.length, 1);
  });

  it('elemento no-objeto: se ignora sin lanzar', () => {
    const phones = extractAllLushaPhones(body([null, 'x', 7, { number: MOBILE }]));
    assert.equal(phones.length, 1);
  });

  it('tipo ausente: rawType null y phoneType unknown', () => {
    const phones = extractAllLushaPhones(body([{ number: MOBILE }]));
    assert.deepEqual(phones[0], { number: MOBILE, rawType: null, phoneType: 'unknown' });
  });

  it('tipo desconocido: se conserva crudo y cae en other, nunca en mobile', () => {
    const phones = extractAllLushaPhones(body([{ number: MOBILE, type: 'fax' }]));
    assert.deepEqual(phones[0], { number: MOBILE, rawType: 'fax', phoneType: 'other' });
  });

  it('cuerpo ausente / no-objeto / sin results / results vacío ⇒ lista vacía', () => {
    assert.deepEqual(extractAllLushaPhones(null), []);
    assert.deepEqual(extractAllLushaPhones('x'), []);
    assert.deepEqual(extractAllLushaPhones({}), []);
    assert.deepEqual(extractAllLushaPhones({ results: [] }), []);
    assert.deepEqual(extractAllLushaPhones({ results: [{}] }), []);
    assert.deepEqual(extractAllLushaPhones({ results: [{ phones: 'x' }] }), []);
  });

  it('solo se lee results[0]: la petición manda UN id, así que hay UNA identidad', () => {
    const phones = extractAllLushaPhones({
      results: [{ phones: [{ number: MOBILE }] }, { phones: [{ number: WORK }] }],
    });
    assert.equal(phones.length, 1);
    assert.equal(phones[0].number, MOBILE);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Clasificación de tipos
// ═══════════════════════════════════════════════════════════════

describe('4O-D — mapLushaPhoneTypeToPhoneType', () => {
  const CASES: ReadonlyArray<[string, string]> = [
    ['mobile', 'mobile'],
    ['personal', 'personal_mobile'],
    ['personal_mobile', 'personal_mobile'],
    ['direct', 'direct_dial'],
    ['direct_dial', 'direct_dial'],
    ['work', 'work'],
    ['work_phone', 'work'],
    ['company', 'hq'],
    ['corporate', 'hq'],
    ['hq', 'hq'],
    ['office', 'work'],
    ['home', 'other'],
    ['other', 'other'],
    ['unknown', 'unknown'],
  ];

  for (const [raw, expected] of CASES) {
    it(`"${raw}" ⇒ ${expected}`, () => {
      assert.equal(mapLushaPhoneTypeToPhoneType(raw), expected);
    });
  }

  it('normaliza mayúsculas, espacios y guiones', () => {
    assert.equal(mapLushaPhoneTypeToPhoneType('  Personal-Mobile '), 'personal_mobile');
    assert.equal(mapLushaPhoneTypeToPhoneType('WORK PHONE'), 'work');
  });

  it('ausente / vacío ⇒ unknown (ausencia de evidencia)', () => {
    assert.equal(mapLushaPhoneTypeToPhoneType(null), 'unknown');
    assert.equal(mapLushaPhoneTypeToPhoneType(undefined), 'unknown');
    assert.equal(mapLushaPhoneTypeToPhoneType('   '), 'unknown');
  });

  it('presente pero no reconocido ⇒ other (contrato previo del cliente, intacto)', () => {
    assert.equal(mapLushaPhoneTypeToPhoneType('fax'), 'other');
    assert.equal(mapLushaPhoneTypeToPhoneType('pager'), 'other');
  });

  it('NINGÚN token desconocido se promueve a un tipo de móvil', () => {
    for (const raw of ['fax', 'pager', 'switchboard', 'zzz', 'telex']) {
      const mapped = mapLushaPhoneTypeToPhoneType(raw);
      assert.notEqual(mapped, 'mobile');
      assert.notEqual(mapped, 'personal_mobile');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Escalar publicado por el cliente
// ═══════════════════════════════════════════════════════════════

describe('4O-D — selectPrimaryLushaPhone', () => {
  const phone = (number: string, type: string) =>
    extractAllLushaPhones(body([{ number, type }]))[0];

  it('el móvil gana al work aunque el work venga primero', () => {
    const primary = selectPrimaryLushaPhone([phone(WORK, 'work'), phone(MOBILE, 'mobile')]);
    assert.equal(primary?.number, MOBILE);
  });

  it('direct_dial gana a hq', () => {
    const primary = selectPrimaryLushaPhone([phone(HQ, 'hq'), phone(DIRECT, 'direct')]);
    assert.equal(primary?.number, DIRECT);
  });

  it('personal_mobile gana a mobile', () => {
    const primary = selectPrimaryLushaPhone([
      phone(MOBILE, 'mobile'),
      phone(WORK, 'personal'),
    ]);
    assert.equal(primary?.number, WORK);
  });

  it('el orden del payload NO cambia el resultado', () => {
    const a = selectPrimaryLushaPhone([
      phone(HQ, 'hq'),
      phone(WORK, 'work'),
      phone(MOBILE, 'mobile'),
    ]);
    const b = selectPrimaryLushaPhone([
      phone(MOBILE, 'mobile'),
      phone(HQ, 'hq'),
      phone(WORK, 'work'),
    ]);
    assert.equal(a?.number, MOBILE);
    assert.equal(b?.number, MOBILE);
  });

  it('empate de tipo: desempate por número, NO por posición', () => {
    const a = selectPrimaryLushaPhone([phone(MOBILE, 'mobile'), phone(WORK, 'mobile')]);
    const b = selectPrimaryLushaPhone([phone(WORK, 'mobile'), phone(MOBILE, 'mobile')]);
    assert.equal(a?.number, b?.number);
  });

  it('lista vacía ⇒ null', () => {
    assert.equal(selectPrimaryLushaPhone([]), null);
  });

  it('un tipo desconocido nunca desplaza a un móvil', () => {
    const primary = selectPrimaryLushaPhone([phone(WORK, 'fax'), phone(MOBILE, 'mobile')]);
    assert.equal(primary?.number, MOBILE);
  });
});
