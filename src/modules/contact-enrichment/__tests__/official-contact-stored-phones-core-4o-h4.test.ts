/**
 * Agente 2A — Núcleo PURO de «Ver más números» del contacto OFICIAL
 * (AGENT2A-PHONE-REVEAL-4O-H4)
 *
 * Sin base, sin red, sin proveedor y sin un solo crédito: todo lo que aquí se
 * ejercita son funciones puras sobre filas fabricadas a mano. Los números son
 * ficticios.
 *
 * Lo que estas pruebas defienden, en una línea: que la pantalla no afirme nada que
 * la base no diga — ni un número que fue suprimido, ni una procedencia que fue
 * retirada, ni un «adicional» que en realidad ya está a la vista.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countAdditionalStoredOfficialPhones,
  selectAdditionalStoredOfficialPhones,
  type StoredOfficialPhoneRow,
  type StoredOfficialPhoneSourceRow,
} from '../official-contact-stored-phones-core';
import { normalizeCandidatePhone } from '../phone-collection-core';

// ── Fábricas ───────────────────────────────────────────────────

function dedupeKeyOf(phone: string): string {
  return normalizeCandidatePhone({
    displayPhone: phone,
    sanitizedPhone: phone,
    countryCode: null,
  }).dedupeKey;
}

function phoneRow(
  overrides: Partial<StoredOfficialPhoneRow> & { id: string; display_phone: string },
): StoredOfficialPhoneRow {
  return {
    normalized_phone: overrides.display_phone.replace(/[^\d+]/g, ''),
    dedupe_key: dedupeKeyOf(overrides.display_phone),
    phone_type: 'work',
    phone_status: 'valid',
    is_primary: false,
    last_seen_at: '2026-08-01T00:00:00.000Z',
    suppressed_at: null,
    ...overrides,
  };
}

function sourceRow(
  contactPhoneId: string,
  provider: string | null,
  acquisitionMode: string | null,
  suppressedAt: string | null = null,
): StoredOfficialPhoneSourceRow {
  return {
    contact_phone_id: contactPhoneId,
    provider,
    acquisition_mode: acquisitionMode,
    suppressed_at: suppressedAt,
  };
}

const NO_SCALARS: readonly (string | null)[] = [null, null];

// ═══════════════════════════════════════════════════════════════
// 1. Cardinalidad: 0 · 1 · N
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — cuántos números adicionales hay', () => {
  it('0 extras: colección vacía', () => {
    const input = { phones: [], sources: [], visibleScalarPhones: NO_SCALARS };
    assert.equal(countAdditionalStoredOfficialPhones(input), 0);
    assert.deepEqual(selectAdditionalStoredOfficialPhones(input), []);
  });

  it('0 extras: el único número almacenado ES el escalar visible', () => {
    // El caso que hace que el CTA NO deba existir. Si esto contara 1, el operador
    // vería «Ver 1 número más» y al abrirlo encontraría el número que ya tenía
    // delante.
    const input = {
      phones: [phoneRow({ id: 'p1', display_phone: '+57 300 123 4567', is_primary: true })],
      sources: [sourceRow('p1', 'apollo', 'reveal')],
      visibleScalarPhones: ['+57 300 123 4567', null],
    };
    assert.equal(countAdditionalStoredOfficialPhones(input), 0);
  });

  it('1 extra: se proyecta con número, tipo, primario y fuentes', () => {
    const input = {
      phones: [
        phoneRow({ id: 'p1', display_phone: '+573001234567', is_primary: true }),
        phoneRow({ id: 'p2', display_phone: '+573009998888', phone_type: 'mobile' }),
      ],
      sources: [sourceRow('p1', 'apollo', 'reveal'), sourceRow('p2', 'lusha', 'reveal')],
      visibleScalarPhones: ['+573001234567', null],
    };
    const extras = selectAdditionalStoredOfficialPhones(input);
    assert.equal(extras.length, 1);
    assert.deepEqual(extras[0], {
      id: 'p2',
      number: '+573009998888',
      type: 'mobile',
      isPrimary: false,
      sources: ['lusha_reveal'],
    });
  });

  it('N extras: todos salen, y el conteo coincide con la lista', () => {
    const input = {
      phones: [
        phoneRow({ id: 'p1', display_phone: '+573001111111', is_primary: true }),
        phoneRow({ id: 'p2', display_phone: '+573002222222' }),
        phoneRow({ id: 'p3', display_phone: '+573003333333' }),
        phoneRow({ id: 'p4', display_phone: '+573004444444' }),
      ],
      sources: [],
      visibleScalarPhones: ['+573001111111', null],
    };
    assert.equal(countAdditionalStoredOfficialPhones(input), 3);
    assert.equal(selectAdditionalStoredOfficialPhones(input).length, 3);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Tombstones — de NÚMERO y de PROCEDENCIA
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — un tombstone se obedece, no se muestra', () => {
  it('un número suprimido no se lista, ni enmascarado ni como hueco', () => {
    const input = {
      phones: [
        phoneRow({ id: 'p2', display_phone: '+573009998888' }),
        phoneRow({
          id: 'p3',
          display_phone: '+573007776666',
          suppressed_at: '2026-08-02T00:00:00.000Z',
        }),
      ],
      sources: [],
      visibleScalarPhones: NO_SCALARS,
    };
    const extras = selectAdditionalStoredOfficialPhones(input);
    assert.deepEqual(
      extras.map((phone) => phone.id),
      ['p2'],
    );
    assert.equal(
      JSON.stringify(extras).includes('7776666'),
      false,
      'el número suprimido no puede aparecer de ninguna forma',
    );
  });

  it('una PROCEDENCIA retirada deja de rotular el número (divergencia con 4O-G)', () => {
    // La 114 permite retirar la observación de UN proveedor sin tumbar el número
    // que otro sigue justificando. Mostrar «Apollo» después de retirar Apollo
    // reintroduciría en la UI el vínculo proveedor↔persona que la erasure rompió.
    const input = {
      phones: [phoneRow({ id: 'p2', display_phone: '+573009998888' })],
      sources: [
        sourceRow('p2', 'apollo', 'reveal', '2026-08-02T00:00:00.000Z'),
        sourceRow('p2', 'lusha', 'reveal'),
      ],
      visibleScalarPhones: NO_SCALARS,
    };
    const extras = selectAdditionalStoredOfficialPhones(input);
    assert.equal(extras.length, 1);
    assert.deepEqual(extras[0].sources, ['lusha_reveal']);
  });

  it('si TODAS las procedencias están retiradas, el número vive pero sin fuentes', () => {
    // La fila canónica es la autoridad sobre si el número está vivo; este módulo no
    // la recalcula. Se muestra sin procedencia en vez de inventar una o de ocultar
    // un número que la base sigue afirmando vivo.
    const input = {
      phones: [phoneRow({ id: 'p2', display_phone: '+573009998888' })],
      sources: [sourceRow('p2', 'apollo', 'reveal', '2026-08-02T00:00:00.000Z')],
      visibleScalarPhones: NO_SCALARS,
    };
    const extras = selectAdditionalStoredOfficialPhones(input);
    assert.equal(extras.length, 1);
    assert.deepEqual(extras[0].sources, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Procedencia: cross-provider, manual, unknown
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — procedencia', () => {
  it('cross-provider: UNA fila canónica con DOS fuentes, en orden estable', () => {
    // Es el caso que la 114 existe para representar. Aplanarlo a una sola fuente
    // inventaría una exclusividad que la base no afirma.
    const input = {
      phones: [phoneRow({ id: 'p2', display_phone: '+573009998888' })],
      sources: [sourceRow('p2', 'lusha', 'reveal'), sourceRow('p2', 'apollo', 'reveal')],
      visibleScalarPhones: NO_SCALARS,
    };
    const extras = selectAdditionalStoredOfficialPhones(input);
    assert.equal(extras.length, 1, 'sigue siendo UN número, no dos');
    assert.deepEqual(extras[0].sources, ['apollo_reveal', 'lusha_reveal']);
  });

  it('el orden de las fuentes no depende del orden en que la base las devolvió', () => {
    const build = (sources: readonly StoredOfficialPhoneSourceRow[]) =>
      selectAdditionalStoredOfficialPhones({
        phones: [phoneRow({ id: 'p2', display_phone: '+573009998888' })],
        sources,
        visibleScalarPhones: NO_SCALARS,
      })[0].sources;

    assert.deepEqual(
      build([sourceRow('p2', 'apollo', 'reveal'), sourceRow('p2', 'lusha', 'reveal')]),
      build([sourceRow('p2', 'lusha', 'reveal'), sourceRow('p2', 'apollo', 'reveal')]),
    );
  });

  it('manual: un número tecleado por una persona se rotula manual', () => {
    const input = {
      phones: [phoneRow({ id: 'p2', display_phone: '+573009998888' })],
      sources: [sourceRow('p2', 'manual', 'manual')],
      visibleScalarPhones: NO_SCALARS,
    };
    assert.deepEqual(selectAdditionalStoredOfficialPhones(input)[0].sources, ['manual']);
  });

  it('apollo reutilizado (cache) NO se confunde con un reveal recién pagado', () => {
    const input = {
      phones: [phoneRow({ id: 'p2', display_phone: '+573009998888' })],
      sources: [sourceRow('p2', 'apollo_cache', 'cache')],
      visibleScalarPhones: NO_SCALARS,
    };
    assert.deepEqual(selectAdditionalStoredOfficialPhones(input)[0].sources, ['apollo_cache']);
  });

  it('unknown: un par no reconocido cae a «desconocida» y NUNCA a una conocida', () => {
    // Rotular de más es peor que rotular de menos: «Apollo reveal» sobre algo que
    // no lo era es una afirmación falsa sobre de dónde salió un dato personal.
    for (const [provider, mode] of [
      ['unknown', 'reveal'],
      ['apollo', 'inventado'],
      ['lusha', 'search'],
      [null, null],
      ['', ''],
    ] as const) {
      const extras = selectAdditionalStoredOfficialPhones({
        phones: [phoneRow({ id: 'p2', display_phone: '+573009998888' })],
        sources: [sourceRow('p2', provider, mode)],
        visibleScalarPhones: NO_SCALARS,
      });
      assert.deepEqual(
        extras[0].sources,
        ['unknown'],
        `(${String(provider)}, ${String(mode)}) no debe asimilarse a una fuente conocida`,
      );
    }
  });

  it('un número sin ninguna fila de procedencia se muestra con la lista vacía', () => {
    const input = {
      phones: [phoneRow({ id: 'p2', display_phone: '+573009998888' })],
      sources: [],
      visibleScalarPhones: NO_SCALARS,
    };
    assert.deepEqual(selectAdditionalStoredOfficialPhones(input)[0].sources, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Deduplicación contra lo que ya está en pantalla
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — «adicional» significa «que no está ya a la vista»', () => {
  it('se compara por clave canónica, no por igualdad de cadenas', () => {
    // `+57 300 123 4567` y `+573001234567` son el MISMO número.
    const input = {
      phones: [phoneRow({ id: 'p1', display_phone: '+573001234567' })],
      sources: [],
      visibleScalarPhones: ['+57 300 123 4567', null],
    };
    assert.equal(countAdditionalStoredOfficialPhones(input), 0);
  });

  it('el conjunto de escalares visibles es plural: excluye TODOS los que reciba', () => {
    // Hoy la lectura pasa uno solo (`contacts.phone`) —el escalar heredado de móvil
    // NO se consulta a propósito, ver la lectura y la guarda estática—, pero el
    // núcleo trata «lo que ya está en pantalla» como un conjunto para que H5 pueda
    // añadirle el móvil sin que esto deje de ser un conjunto.
    const input = {
      phones: [
        phoneRow({ id: 'p1', display_phone: '+573001234567' }),
        phoneRow({ id: 'p2', display_phone: '+573009998888' }),
        phoneRow({ id: 'p3', display_phone: '+573007776666' }),
      ],
      sources: [],
      visibleScalarPhones: ['+573001234567', '+573009998888'],
    };
    assert.deepEqual(
      selectAdditionalStoredOfficialPhones(input).map((phone) => phone.id),
      ['p3'],
    );
  });

  it('la fila marcada `is_primary` se excluye aunque el escalar no coincida', () => {
    const input = {
      phones: [phoneRow({ id: 'p1', display_phone: '+573001234567', is_primary: true })],
      sources: [],
      visibleScalarPhones: NO_SCALARS,
    };
    assert.equal(countAdditionalStoredOfficialPhones(input), 0);
  });

  it('escalares nulos o vacíos no excluyen nada', () => {
    const input = {
      phones: [phoneRow({ id: 'p2', display_phone: '+573009998888' })],
      sources: [],
      visibleScalarPhones: [null, '   ', undefined],
    };
    assert.equal(countAdditionalStoredOfficialPhones(input), 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Elegibilidad y orden
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — mostrable y en qué orden', () => {
  it('un número AFIRMADO inválido no se muestra', () => {
    const input = {
      phones: [
        phoneRow({ id: 'p2', display_phone: '+573009998888', phone_status: 'invalid' }),
        phoneRow({ id: 'p3', display_phone: '+573007776666' }),
      ],
      sources: [],
      visibleScalarPhones: NO_SCALARS,
    };
    assert.deepEqual(
      selectAdditionalStoredOfficialPhones(input).map((phone) => phone.id),
      ['p3'],
    );
  });

  it('`unknown` NO es `invalid`: la ausencia de evidencia sigue siendo mostrable', () => {
    const input = {
      phones: [phoneRow({ id: 'p2', display_phone: '+573009998888', phone_status: null })],
      sources: [],
      visibleScalarPhones: NO_SCALARS,
    };
    assert.equal(countAdditionalStoredOfficialPhones(input), 1);
  });

  it('el orden es canónico y no el orden físico de la base', () => {
    const rows = [
      phoneRow({ id: 'p-work', display_phone: '+573001111111', phone_type: 'work' }),
      phoneRow({ id: 'p-mobile', display_phone: '+573002222222', phone_type: 'mobile' }),
    ];
    const forward = selectAdditionalStoredOfficialPhones({
      phones: rows,
      sources: [],
      visibleScalarPhones: NO_SCALARS,
    }).map((phone) => phone.id);
    const reversed = selectAdditionalStoredOfficialPhones({
      phones: [...rows].reverse(),
      sources: [],
      visibleScalarPhones: NO_SCALARS,
    }).map((phone) => phone.id);

    assert.deepEqual(forward, reversed, 'el orden no puede depender del orden de llegada');
    assert.deepEqual(forward, ['p-mobile', 'p-work'], 'móvil antes que trabajo (ranking canónico)');
  });

  it('un tipo desconocido o no reconocido se proyecta como `null`, no se inventa', () => {
    const input = {
      phones: [phoneRow({ id: 'p2', display_phone: '+573009998888', phone_type: 'inventado' })],
      sources: [],
      visibleScalarPhones: NO_SCALARS,
    };
    assert.equal(selectAdditionalStoredOfficialPhones(input)[0].type, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Privacidad de la proyección
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — la proyección es más pobre que la fila, a propósito', () => {
  it('sólo salen cinco campos: id, number, type, isPrimary, sources', () => {
    // Fija la lista, porque «no lo mandamos» es una propiedad que se pierde por
    // descuido en cuanto alguien añade un campo «que ya que estamos».
    const extras = selectAdditionalStoredOfficialPhones({
      phones: [phoneRow({ id: 'p2', display_phone: '+573009998888' })],
      sources: [sourceRow('p2', 'apollo', 'reveal')],
      visibleScalarPhones: NO_SCALARS,
    });
    assert.deepEqual(Object.keys(extras[0]).sort(), [
      'id',
      'isPrimary',
      'number',
      'sources',
      'type',
    ]);
  });

  it('ni `dedupe_key`, ni marcas de supresión, ni punteros de auditoría viajan', () => {
    const serialized = JSON.stringify(
      selectAdditionalStoredOfficialPhones({
        phones: [
          phoneRow({
            id: 'p2',
            display_phone: '+573009998888',
            dedupe_key: 'e164:SECRETO-NO-DEBE-SALIR',
          }),
        ],
        sources: [sourceRow('p2', 'apollo', 'reveal')],
        visibleScalarPhones: NO_SCALARS,
      }),
    );
    for (const forbidden of [
      'SECRETO-NO-DEBE-SALIR',
      'dedupe',
      'suppress',
      'last_seen',
      'contact_phone_id',
      'acquisition_mode',
    ]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} no debe viajar al cliente`);
    }
  });
});
