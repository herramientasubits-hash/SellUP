/**
 * Agente 2A — «Ver más números»: núcleo puro
 * (AGENT2A-PHONE-REVEAL-4O-G)
 *
 * Determinista y offline: sin red, sin Supabase, sin proveedores, 0 créditos.
 * Todo lo que se prueba aquí son funciones puras sobre filas sintéticas.
 *
 * Cada caso vale por lo que PROHÍBE:
 *   * un tombstone NO puede aparecer, ni siquiera enmascarado;
 *   * el mismo número visto por dos proveedores NO puede duplicarse en dos filas;
 *   * el principal NO puede volver a listarse como «adicional»;
 *   * el orden NO puede depender de cómo devolvió las filas la base;
 *   * la proyección NO puede llevar clave de deduplicación, metadatos de
 *     supresión ni identificadores de corrida/reserva/usage-log.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  countAdditionalStoredPhones,
  resolveStoredPhoneSourceKey,
  selectAdditionalStoredPhones,
  type StoredCandidatePhoneRow,
  type StoredCandidatePhoneSourceRow,
} from '../candidate-stored-phones-core';
import { normalizeCandidatePhone } from '../phone-collection-core';

// ── Constructores de filas ─────────────────────────────────────

function dedupeKeyOf(phone: string): string {
  return normalizeCandidatePhone({
    displayPhone: phone,
    sanitizedPhone: phone,
    countryCode: null,
  }).dedupeKey;
}

function phoneRow(
  overrides: Partial<StoredCandidatePhoneRow> & { id: string; display_phone: string },
): StoredCandidatePhoneRow {
  const display = overrides.display_phone;
  return {
    normalized_phone: display,
    dedupe_key: dedupeKeyOf(display),
    phone_type: 'mobile',
    phone_status: 'valid',
    is_primary: false,
    last_seen_at: '2026-08-01T00:00:00.000Z',
    suppressed_at: null,
    ...overrides,
  };
}

function sourceRow(
  candidate_phone_id: string,
  provider: string,
  acquisition_mode: string,
): StoredCandidatePhoneSourceRow {
  return { candidate_phone_id, provider, acquisition_mode };
}

const PRIMARY = '+573001112222';
const EXTRA_A = '+573004445555';
const EXTRA_B = '+576017778888';

// ═══════════════════════════════════════════════════════════════
// Cardinalidad
// ═══════════════════════════════════════════════════════════════

describe('4O-G — cuántos números adicionales hay', () => {
  it('sin teléfonos almacenados no hay ninguno adicional', () => {
    const result = selectAdditionalStoredPhones({
      phones: [],
      sources: [],
      primaryScalarPhone: null,
    });
    assert.deepEqual(result, []);
    assert.equal(
      countAdditionalStoredPhones({ phones: [], sources: [], primaryScalarPhone: null }),
      0,
    );
  });

  it('SOLO el principal ⇒ 0 adicionales (el CTA no debe existir)', () => {
    const rows = [phoneRow({ id: 'p1', display_phone: PRIMARY, is_primary: true })];
    assert.equal(
      countAdditionalStoredPhones({
        phones: rows,
        sources: [],
        primaryScalarPhone: PRIMARY,
      }),
      0,
    );
  });

  it('principal + 1 extra ⇒ 1 adicional', () => {
    const rows = [
      phoneRow({ id: 'p1', display_phone: PRIMARY, is_primary: true }),
      phoneRow({ id: 'p2', display_phone: EXTRA_A }),
    ];
    const result = selectAdditionalStoredPhones({
      phones: rows,
      sources: [],
      primaryScalarPhone: PRIMARY,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].number, EXTRA_A);
  });

  it('principal + N extras ⇒ N adicionales, y el principal NO está entre ellos', () => {
    const rows = [
      phoneRow({ id: 'p1', display_phone: PRIMARY, is_primary: true }),
      phoneRow({ id: 'p2', display_phone: EXTRA_A }),
      phoneRow({ id: 'p3', display_phone: EXTRA_B }),
    ];
    const result = selectAdditionalStoredPhones({
      phones: rows,
      sources: [],
      primaryScalarPhone: PRIMARY,
    });
    assert.equal(result.length, 2);
    assert.equal(
      result.some((phone) => phone.number === PRIMARY),
      false,
      'el principal ya se muestra arriba: no puede repetirse como adicional',
    );
  });

  it('un extra que es EL MISMO número del escalar no se lista aunque no esté marcado principal', () => {
    // Ninguna fila tiene `is_primary`, pero una de ellas ES el número que la
    // pantalla ya enseña. Listarlo diría que hay algo nuevo cuando no lo hay.
    const rows = [
      phoneRow({ id: 'p1', display_phone: '+57 300 111 2222' }),
      phoneRow({ id: 'p2', display_phone: EXTRA_A }),
    ];
    const result = selectAdditionalStoredPhones({
      phones: rows,
      sources: [],
      primaryScalarPhone: PRIMARY,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].number, EXTRA_A);
  });
});

// ═══════════════════════════════════════════════════════════════
// Privacidad: el tombstone se obedece
// ═══════════════════════════════════════════════════════════════

describe('4O-G — filas no mostrables', () => {
  it('una fila suprimida NO aparece, ni siquiera vacía o enmascarada', () => {
    const rows = [
      phoneRow({ id: 'p1', display_phone: PRIMARY, is_primary: true }),
      // Tombstone real tal como lo deja la migración: sin número, sin tipo.
      {
        id: 'p2',
        normalized_phone: null,
        display_phone: null,
        dedupe_key: dedupeKeyOf(EXTRA_A),
        phone_type: null,
        phone_status: 'unknown',
        is_primary: false,
        last_seen_at: '2026-08-01T00:00:00.000Z',
        suppressed_at: '2026-08-02T00:00:00.000Z',
      } satisfies StoredCandidatePhoneRow,
    ];
    const result = selectAdditionalStoredPhones({
      phones: rows,
      sources: [],
      primaryScalarPhone: PRIMARY,
    });
    assert.deepEqual(result, []);
  });

  it('una fila que el proveedor AFIRMÓ inválida no se muestra', () => {
    const rows = [
      phoneRow({ id: 'p1', display_phone: PRIMARY, is_primary: true }),
      phoneRow({ id: 'p2', display_phone: EXTRA_A, phone_status: 'invalid' }),
    ];
    assert.equal(
      countAdditionalStoredPhones({
        phones: rows,
        sources: [],
        primaryScalarPhone: PRIMARY,
      }),
      0,
    );
  });

  it('una fila sin número normalizado no se muestra', () => {
    const rows = [
      phoneRow({ id: 'p2', display_phone: EXTRA_A, normalized_phone: null }),
    ];
    assert.equal(
      countAdditionalStoredPhones({ phones: rows, sources: [], primaryScalarPhone: null }),
      0,
    );
  });

  it('un estado desconocido NO se trata como inválido: el número sigue siendo visible', () => {
    // `unknown` es ausencia de evidencia. Ocultarlo perdería un número pagado.
    const rows = [phoneRow({ id: 'p2', display_phone: EXTRA_A, phone_status: 'unknown' })];
    assert.equal(
      countAdditionalStoredPhones({ phones: rows, sources: [], primaryScalarPhone: null }),
      1,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Procedencia cruzada
// ═══════════════════════════════════════════════════════════════

describe('4O-G — el mismo número observado por dos proveedores', () => {
  it('es UNA fila con DOS fuentes, no dos filas', () => {
    const rows = [phoneRow({ id: 'p2', display_phone: EXTRA_A })];
    const sources = [
      sourceRow('p2', 'apollo', 'reveal'),
      sourceRow('p2', 'lusha', 'waterfall'),
    ];
    const result = selectAdditionalStoredPhones({
      phones: rows,
      sources,
      primaryScalarPhone: PRIMARY,
    });
    assert.equal(result.length, 1);
    assert.deepEqual([...result[0].sources], ['apollo_reveal', 'lusha_reveal']);
  });

  it('dos observaciones del MISMO proveedor colapsan en una sola etiqueta', () => {
    const rows = [phoneRow({ id: 'p2', display_phone: EXTRA_A })];
    const sources = [
      // Apollo escribe dos filas por reveal (start + webhook).
      sourceRow('p2', 'apollo', 'reveal'),
      sourceRow('p2', 'apollo', 'reveal'),
    ];
    const result = selectAdditionalStoredPhones({
      phones: rows,
      sources,
      primaryScalarPhone: PRIMARY,
    });
    assert.deepEqual([...result[0].sources], ['apollo_reveal']);
  });

  it('un número sin procedencia registrada se muestra igual, con la lista vacía', () => {
    const rows = [phoneRow({ id: 'p2', display_phone: EXTRA_A })];
    const result = selectAdditionalStoredPhones({
      phones: rows,
      sources: [],
      primaryScalarPhone: PRIMARY,
    });
    assert.equal(result.length, 1);
    assert.deepEqual([...result[0].sources], []);
  });
});

describe('4O-G — traducción de (proveedor, modo) a la etiqueta del drawer', () => {
  it('reconoce las combinaciones que el subsistema produce', () => {
    assert.equal(resolveStoredPhoneSourceKey('apollo', 'reveal'), 'apollo_reveal');
    assert.equal(resolveStoredPhoneSourceKey('apollo', 'waterfall'), 'apollo_reveal');
    assert.equal(resolveStoredPhoneSourceKey('apollo', 'search'), 'apollo_search');
    assert.equal(resolveStoredPhoneSourceKey('apollo', 'cache'), 'apollo_cache');
    assert.equal(resolveStoredPhoneSourceKey('apollo_cache', 'cache'), 'apollo_cache');
    assert.equal(resolveStoredPhoneSourceKey('lusha', 'reveal'), 'lusha_reveal');
    assert.equal(resolveStoredPhoneSourceKey('lusha', 'manual'), 'lusha_reveal');
    assert.equal(resolveStoredPhoneSourceKey('manual', 'manual'), 'manual');
  });

  it('una caché de Apollo NO se rotula como un reveal nuevo', () => {
    // Un número reutilizado no costó créditos; confundirlo con un reveal borraría
    // esa distinción, que ya es doctrina del subsistema.
    assert.notEqual(resolveStoredPhoneSourceKey('apollo_cache', 'cache'), 'apollo_reveal');
  });

  it('una combinación desconocida cae a `unknown` y NUNCA a una fuente conocida', () => {
    assert.equal(resolveStoredPhoneSourceKey('acme', 'reveal'), 'unknown');
    assert.equal(resolveStoredPhoneSourceKey('apollo', 'teleport'), 'unknown');
    assert.equal(resolveStoredPhoneSourceKey(null, null), 'unknown');
  });
});

// ═══════════════════════════════════════════════════════════════
// Orden
// ═══════════════════════════════════════════════════════════════

describe('4O-G — orden determinista', () => {
  it('usa el ranking canónico de tipo, no el orden físico de la base', () => {
    const rows = [
      phoneRow({ id: 'c', display_phone: '+573001111111', phone_type: 'hq' }),
      phoneRow({ id: 'a', display_phone: '+573002222222', phone_type: 'personal_mobile' }),
      phoneRow({ id: 'b', display_phone: '+573003333333', phone_type: 'work' }),
    ];
    const result = selectAdditionalStoredPhones({
      phones: rows,
      sources: [],
      primaryScalarPhone: null,
    });
    assert.deepEqual(
      result.map((phone) => phone.type),
      ['personal_mobile', 'work', 'hq'],
    );
  });

  it('el mismo conjunto en otro orden de entrada produce la MISMA salida', () => {
    const build = (ids: readonly string[]) =>
      ids.map((id) =>
        phoneRow({
          id,
          display_phone: `+5730011122${id}`,
          phone_type: 'mobile',
          last_seen_at: '2026-08-01T00:00:00.000Z',
        }),
      );
    const forward = selectAdditionalStoredPhones({
      phones: build(['11', '22', '33']),
      sources: [],
      primaryScalarPhone: null,
    });
    const reversed = selectAdditionalStoredPhones({
      phones: build(['33', '22', '11']),
      sources: [],
      primaryScalarPhone: null,
    });
    assert.deepEqual(
      forward.map((phone) => phone.number),
      reversed.map((phone) => phone.number),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Proyección
// ═══════════════════════════════════════════════════════════════

describe('4O-G — la proyección que llega al navegador', () => {
  it('expone EXACTAMENTE cinco campos y ni uno más', () => {
    const rows = [phoneRow({ id: 'p2', display_phone: EXTRA_A })];
    const [view] = selectAdditionalStoredPhones({
      phones: rows,
      sources: [sourceRow('p2', 'apollo', 'reveal')],
      primaryScalarPhone: PRIMARY,
    });
    assert.deepEqual(Object.keys(view).sort(), [
      'id',
      'isPrimary',
      'number',
      'sources',
      'type',
    ]);
  });

  it('NO lleva clave de deduplicación, metadatos de supresión ni ids de operación', () => {
    const rows = [phoneRow({ id: 'p2', display_phone: EXTRA_A })];
    const [view] = selectAdditionalStoredPhones({
      phones: rows,
      sources: [sourceRow('p2', 'apollo', 'reveal')],
      primaryScalarPhone: PRIMARY,
    });
    const serialized = JSON.stringify(view);
    for (const forbidden of [
      'dedupe',
      'suppress',
      'waterfall_run',
      'reservation',
      'usage_log',
      'provider_person',
      'source_event_key',
    ]) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `la proyección no debe llevar ${forbidden}`,
      );
    }
  });

  it('muestra el número tal como se guardó y no lo re-normaliza', () => {
    const formatted = '+57 300 444 5555';
    const rows = [
      phoneRow({
        id: 'p2',
        display_phone: formatted,
        normalized_phone: '+573004445555',
      }),
    ];
    const [view] = selectAdditionalStoredPhones({
      phones: rows,
      sources: [],
      primaryScalarPhone: PRIMARY,
    });
    assert.equal(view.number, formatted);
  });

  it('cae al normalizado cuando no hay forma de display', () => {
    const rows = [
      phoneRow({ id: 'p2', display_phone: EXTRA_A, normalized_phone: EXTRA_A }),
    ];
    const withoutDisplay: StoredCandidatePhoneRow = { ...rows[0], display_phone: null };
    const [view] = selectAdditionalStoredPhones({
      phones: [withoutDisplay],
      sources: [],
      primaryScalarPhone: PRIMARY,
    });
    assert.equal(view.number, EXTRA_A);
  });

  it('un tipo no reconocido llega como null (la UI lo rotula «Tipo desconocido»)', () => {
    const rows = [phoneRow({ id: 'p2', display_phone: EXTRA_A, phone_type: 'fax' })];
    const [view] = selectAdditionalStoredPhones({
      phones: rows,
      sources: [],
      primaryScalarPhone: PRIMARY,
    });
    assert.equal(view.type, null);
  });
});
