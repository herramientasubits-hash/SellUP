/**
 * Tests — Phone Classification (Agente 2A, PHONE-3A)
 *
 * Lógica pura de clasificación de teléfonos de Apollo. Sin red, sin DB,
 * sin proveedores reales. Node.js built-in test runner.
 *
 * PHONE-3A: conserva el `type` que Apollo ya entrega gratis en la búsqueda.
 * NO revela teléfonos, NO gasta créditos, NO llama endpoints nuevos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapApolloPhoneTypeToPhoneType,
  classifyApolloPhone,
  pickBestApolloPhone,
  type PhoneType,
} from '../phone-classification';

describe('mapApolloPhoneTypeToPhoneType', () => {
  it('mobile → mobile', () => {
    assert.equal(mapApolloPhoneTypeToPhoneType('mobile'), 'mobile');
  });

  it('personal / personal_mobile / mobile_personal → personal_mobile', () => {
    assert.equal(mapApolloPhoneTypeToPhoneType('personal'), 'personal_mobile');
    assert.equal(mapApolloPhoneTypeToPhoneType('personal_mobile'), 'personal_mobile');
    assert.equal(mapApolloPhoneTypeToPhoneType('mobile_personal'), 'personal_mobile');
  });

  it('work → work', () => {
    assert.equal(mapApolloPhoneTypeToPhoneType('work'), 'work');
  });

  it('direct / direct_dial → direct_dial', () => {
    assert.equal(mapApolloPhoneTypeToPhoneType('direct'), 'direct_dial');
    assert.equal(mapApolloPhoneTypeToPhoneType('direct_dial'), 'direct_dial');
  });

  it('work_hq / hq → hq', () => {
    assert.equal(mapApolloPhoneTypeToPhoneType('work_hq'), 'hq');
    assert.equal(mapApolloPhoneTypeToPhoneType('hq'), 'hq');
  });

  it('normaliza mayúsculas, espacios y guiones antes de mapear', () => {
    assert.equal(mapApolloPhoneTypeToPhoneType('  Work HQ '), 'hq');
    assert.equal(mapApolloPhoneTypeToPhoneType('Direct-Dial'), 'direct_dial');
    assert.equal(mapApolloPhoneTypeToPhoneType('MOBILE'), 'mobile');
  });

  it('string desconocido → unknown', () => {
    assert.equal(mapApolloPhoneTypeToPhoneType('satellite_phone'), 'unknown');
    assert.equal(mapApolloPhoneTypeToPhoneType('xyz'), 'unknown');
  });

  it('null / undefined / vacío → unknown', () => {
    assert.equal(mapApolloPhoneTypeToPhoneType(null), 'unknown');
    assert.equal(mapApolloPhoneTypeToPhoneType(undefined), 'unknown');
    assert.equal(mapApolloPhoneTypeToPhoneType(''), 'unknown');
    assert.equal(mapApolloPhoneTypeToPhoneType('   '), 'unknown');
  });
});

describe('classifyApolloPhone', () => {
  it('clasifica un teléfono con tipo conocido', () => {
    const r = classifyApolloPhone({ sanitized_number: '+573001111111', type: 'mobile' });
    assert.ok(r);
    assert.equal(r?.number, '+573001111111');
    assert.equal(r?.type, 'mobile');
    assert.equal(r?.source, 'apollo_search');
    assert.equal(r?.raw_type, 'mobile');
  });

  it('conserva raw_type original aunque el tipo normalizado sea unknown', () => {
    const r = classifyApolloPhone({ sanitized_number: '+571111', type: 'satellite' });
    assert.ok(r);
    assert.equal(r?.type, 'unknown');
    assert.equal(r?.raw_type, 'satellite');
  });

  it('source siempre apollo_search en este hito', () => {
    const r = classifyApolloPhone({ sanitized_number: '+571', type: 'work' });
    assert.equal(r?.source, 'apollo_search');
  });

  it('devuelve null cuando el número está vacío o ausente', () => {
    assert.equal(classifyApolloPhone({ sanitized_number: '', type: 'mobile' }), null);
    assert.equal(classifyApolloPhone({ sanitized_number: '   ', type: 'mobile' }), null);
    assert.equal(classifyApolloPhone({ sanitized_number: null, type: 'mobile' }), null);
    assert.equal(classifyApolloPhone({ type: 'mobile' }), null);
    assert.equal(classifyApolloPhone(null), null);
    assert.equal(classifyApolloPhone(undefined), null);
  });

  it('raw_type null cuando el tipo viene vacío/ausente', () => {
    const r = classifyApolloPhone({ sanitized_number: '+571', type: null });
    assert.ok(r);
    assert.equal(r?.type, 'unknown');
    assert.equal(r?.raw_type, null);
  });
});

describe('pickBestApolloPhone', () => {
  it('prioriza mobile sobre work', () => {
    const r = pickBestApolloPhone([
      { sanitized_number: '+571111111', type: 'work' },
      { sanitized_number: '+573001111111', type: 'mobile' },
    ]);
    assert.ok(r);
    assert.equal(r?.number, '+573001111111');
    assert.equal(r?.type, 'mobile');
    assert.equal(r?.source, 'apollo_search');
    assert.equal(r?.raw_type, 'mobile');
  });

  it('prioriza personal_mobile sobre mobile', () => {
    const r = pickBestApolloPhone([
      { sanitized_number: '+571', type: 'mobile' },
      { sanitized_number: '+572', type: 'personal' },
    ]);
    assert.equal(r?.number, '+572');
    assert.equal(r?.type, 'personal_mobile');
  });

  it('prioriza direct_dial sobre hq', () => {
    const r = pickBestApolloPhone([
      { sanitized_number: '+571', type: 'work_hq' },
      { sanitized_number: '+572', type: 'direct_dial' },
    ]);
    assert.equal(r?.number, '+572');
    assert.equal(r?.type, 'direct_dial');
  });

  it('ignora sanitized_number vacío y elige el válido', () => {
    const r = pickBestApolloPhone([
      { sanitized_number: '', type: 'mobile' },
      { sanitized_number: '   ', type: 'personal' },
      { sanitized_number: '+575555', type: 'work' },
    ]);
    assert.equal(r?.number, '+575555');
    assert.equal(r?.type, 'work');
  });

  it('conserva raw_type del teléfono elegido', () => {
    const r = pickBestApolloPhone([
      { sanitized_number: '+571', type: 'Mobile' },
    ]);
    assert.equal(r?.type, 'mobile');
    assert.equal(r?.raw_type, 'Mobile');
  });

  it('ante empate de prioridad conserva el primero (estable)', () => {
    const r = pickBestApolloPhone([
      { sanitized_number: '+571', type: 'work' },
      { sanitized_number: '+572', type: 'work' },
    ]);
    assert.equal(r?.number, '+571');
  });

  it('elige por prioridad de tipo, no por orden de aparición', () => {
    const r = pickBestApolloPhone([
      { sanitized_number: '+571', type: 'other' },
      { sanitized_number: '+572', type: 'hq' },
      { sanitized_number: '+573', type: 'personal_mobile' },
      { sanitized_number: '+574', type: 'work' },
    ]);
    assert.equal(r?.number, '+573');
    assert.equal(r?.type, 'personal_mobile');
  });

  it('retorna null si no hay números válidos', () => {
    assert.equal(pickBestApolloPhone([]), null);
    assert.equal(pickBestApolloPhone(null), null);
    assert.equal(pickBestApolloPhone(undefined), null);
    assert.equal(
      pickBestApolloPhone([
        { sanitized_number: '', type: 'mobile' },
        { sanitized_number: null, type: 'work' },
      ]),
      null,
    );
  });

  it('un teléfono de tipo desconocido se conserva si es el único válido', () => {
    const r = pickBestApolloPhone([{ sanitized_number: '+579', type: 'satellite' }]);
    assert.ok(r);
    assert.equal(r?.number, '+579');
    assert.equal(r?.type, 'unknown');
    assert.equal(r?.raw_type, 'satellite');
  });
});

// Guard de tipo: PhoneType es un union cerrado. Este assert de compilación
// documenta el vocabulario esperado sin ejecutar lógica.
describe('PhoneType vocabulary', () => {
  it('incluye los tipos esperados', () => {
    const types: PhoneType[] = [
      'personal_mobile',
      'mobile',
      'direct_dial',
      'work',
      'hq',
      'other',
      'unknown',
    ];
    assert.equal(types.length, 7);
  });
});
