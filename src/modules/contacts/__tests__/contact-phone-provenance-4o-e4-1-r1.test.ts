/**
 * Agente 2A — invalidación de procedencia al editar `contacts.phone` a mano
 * (AGENT2A-PHONE-REVEAL-4O-E4.1-R1).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ DEMUESTRA ESTE ARCHIVO
 * ═══════════════════════════════════════════════════════════════════
 *
 * 4O-E4 dejó la supresión de teléfonos oficiales apoyada por completo en
 * `contacts.phone_source`: sólo borra cuando el valor observado está en
 * `SUPPRESSIBLE_CONTACT_PHONE_SOURCES`. Esa premisa sólo se sostiene si la
 * procedencia sigue describiendo el número GUARDADO, y hasta R1 no lo hacía:
 * `updateContact` escribía `phone` y no tocaba `phone_source`.
 *
 * Aquí se recorre la cadena entera con las piezas REALES:
 *
 *     helper puro de procedencia   (`resolveManualContactPhoneEdit`)
 *   → patch que aplica la acción   (el mismo objeto que `updateContact` fusiona)
 *   → plan de supresión            (`buildPhoneCacheSuppressionPlan`)
 *   → ¿el número manual sobrevive?
 *
 * El eslabón que faltaba en E4 es el primero: sus pruebas escribían
 * `phone_source = 'manual'` A MANO para simular una edición, con lo que demostraban
 * una propiedad de un escritor ficticio. Aquí el `'manual'` NO se teclea en ningún
 * caso de privacidad: sale siempre de la misma función que usa la server action, así
 * que si el helper dejara de invalidar la procedencia, estas pruebas fallarían en vez
 * de seguir pasando sobre una premisa falsa.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no toca Producción ni base alguna; no
 * ejecuta ninguna DSAR real; no gasta créditos. Todos los números son sintéticos 555.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildManualContactPhoneEditPatch,
  resolveManualContactPhoneEdit,
  type ManualContactPhoneEdit,
  type ManualContactPhoneEditPatch,
} from '../contact-phone-provenance';
import {
  SUPPRESSIBLE_CONTACT_PHONE_SOURCES,
  buildPhoneCacheSuppressionPlan,
  isSuppressibleContactPhoneSource,
  type PhoneCacheSuppressionInput,
  type SuppressibleCandidate,
  type SuppressibleContact,
} from '@/modules/contact-enrichment/phone-cache-suppression-core';
import type { ContactPhoneSource, ContactPhoneType, ConfidenceLevel } from '../types';

// ═══════════════════════════════════════════════════════════════
// Escenario sintético
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_A = 'acc-aaaa-0001';
const PERSON_ID = 'a1b2c3d4e5f60718293a4b5c';
const ACTOR = 'user-admin-0001';
const NOW = '2026-08-10T12:00:00.000Z';

const PROVIDER_PHONE = '+15550000101';
const MANUAL_PHONE = '+15550000303';
const MANUAL_MOBILE = '+15550000202';

/**
 * Proyección de `contacts` con las columnas que R1 gobierna. Es deliberadamente la
 * TUPLA COMPLETA de teléfono: cualquier columna que sobreviviera a la edición sería
 * una afirmación falsa sobre el número nuevo.
 */
interface ContactRow {
  phone: string | null;
  phone_source: ContactPhoneSource | null;
  phone_type: ContactPhoneType | null;
  phone_raw_type: string | null;
  phone_revealed_at: string | null;
  phone_processing_basis: string | null;
  phone_confidence: ConfidenceLevel | null;
  mobile_phone: string | null;
}

function providerContact(source: ContactPhoneSource): ContactRow {
  return {
    phone: PROVIDER_PHONE,
    phone_source: source,
    phone_type: 'mobile',
    phone_raw_type: 'mobile',
    phone_revealed_at: '2026-07-01T10:00:00.000Z',
    phone_processing_basis: 'legitimate_interest',
    phone_confidence: 'high',
    mobile_phone: MANUAL_MOBILE,
  };
}

/**
 * Réplica EXACTA de lo que hace `updateContact` con la procedencia del teléfono:
 * resuelve la edición con el helper compartido y, si hay patch, lo fusiona sobre la
 * fila en la MISMA operación. Ninguna prueba de este archivo escribe `phone_source`
 * por su cuenta — ése era justamente el vicio de E4.
 */
function applyManualEdit(
  row: ContactRow,
  input: { phone?: string | null; mobile_phone?: string | null },
): { row: ContactRow; edit: ManualContactPhoneEdit } {
  const edit = resolveManualContactPhoneEdit({
    currentPhone: row.phone,
    inputPhone: input.phone,
  });

  const next: ContactRow = { ...row };
  if (edit.kind === 'replaced' || edit.kind === 'cleared') {
    Object.assign(next, edit.patch);
  }
  // `mobile_phone` viaja fuera de la procedencia, igual que en la acción real.
  if (input.mobile_phone !== undefined) {
    next.mobile_phone = input.mobile_phone?.trim() || null;
  }
  return { row: next, edit };
}

// ── Plan de supresión sobre el resultado de la edición ─────────

function baseInput(
  overrides: Partial<PhoneCacheSuppressionInput> = {},
): PhoneCacheSuppressionInput {
  return {
    providerPersonId: PERSON_ID,
    accountId: ACCOUNT_A,
    countryCode: 'CO',
    reason: 'dsar_erasure_request',
    actorUserId: ACTOR,
    actorRoleKey: 'admin',
    ...overrides,
  };
}

function makeCandidate(): SuppressibleCandidate {
  return {
    id: 'cand-1',
    accountId: ACCOUNT_A,
    enrichmentRunId: 'run-1',
    enrichmentMetadata: {
      phone: { source: 'lusha_reveal', type: 'mobile', raw_type: 'mobile' },
    } as SuppressibleCandidate['enrichmentMetadata'],
    createdContactId: 'contact-1',
    matchedContactId: 'contact-1',
  };
}

/**
 * Contacto suprimible construido DESDE la fila resultante de la edición: el
 * `phoneSource` que ve la supresión es el que dejó el helper, nunca uno tecleado.
 */
function suppressibleFrom(row: ContactRow): SuppressibleContact {
  return {
    id: 'contact-1',
    accountId: ACCOUNT_A,
    sourceCandidateId: 'cand-1',
    phoneSource: row.phone_source,
  };
}

function erasedIds(row: ContactRow): string[] {
  const result = buildPhoneCacheSuppressionPlan(baseInput(), {
    nowIso: NOW,
    candidates: [makeCandidate()],
    contacts: [suppressibleFrom(row)],
  });
  assert.equal(result.ok, true, 'el plan no debería rechazarse en este escenario');
  if (!result.ok) throw new Error('plan rechazado');
  return result.plan.contactPatches.map((p) => p.contactId);
}

/** Tupla del proveedor completamente limpia salvo el número escrito. */
function assertManualTuple(row: ContactRow, expectedPhone: string | null) {
  assert.equal(row.phone, expectedPhone);
  assert.equal(row.phone_source, expectedPhone === null ? null : 'manual');
  assert.equal(row.phone_type, null, 'el tipo del proveedor no puede sobrevivir');
  assert.equal(row.phone_raw_type, null, 'el raw_type del proveedor no puede sobrevivir');
  assert.equal(
    row.phone_revealed_at,
    null,
    'revealed_at describiría un reveal que no produjo este número',
  );
  assert.equal(row.phone_processing_basis, null);
  assert.equal(row.phone_confidence, null);
}

// ═══════════════════════════════════════════════════════════════
// 1. Los cuatro casos del helper
// ═══════════════════════════════════════════════════════════════

describe('R1 — el campo ausente NUNCA toca la procedencia', () => {
  it('input sin `phone` ⇒ field_absent y sin patch', () => {
    const edit = resolveManualContactPhoneEdit({
      currentPhone: PROVIDER_PHONE,
      inputPhone: undefined,
    });
    assert.equal(edit.kind, 'field_absent');
    assert.equal('patch' in edit, false, 'sin patch no hay forma de arrastrar columnas');
  });

  it('editar OTRO campo deja la fila del proveedor intacta', () => {
    const before = providerContact('apollo_reveal');
    const { row, edit } = applyManualEdit(before, {});
    assert.equal(edit.kind, 'field_absent');
    assert.deepEqual(row, before, 'ninguna columna de teléfono cambia');
  });

  it('editar sólo `mobile_phone` no invalida la procedencia de `phone`', () => {
    const { row } = applyManualEdit(providerContact('lusha_reveal'), {
      mobile_phone: '+15550000999',
    });
    assert.equal(row.phone, PROVIDER_PHONE);
    assert.equal(row.phone_source, 'lusha_reveal');
    assert.equal(row.mobile_phone, '+15550000999');
  });
});

describe('R1 — reenviar el MISMO valor conserva la procedencia', () => {
  it('mismo número ⇒ unchanged', () => {
    const edit = resolveManualContactPhoneEdit({
      currentPhone: PROVIDER_PHONE,
      inputPhone: PROVIDER_PHONE,
    });
    assert.equal(edit.kind, 'unchanged');
  });

  it('el formulario reenvía el número guardado y `apollo_reveal` SOBREVIVE', () => {
    const before = providerContact('apollo_reveal');
    const { row } = applyManualEdit(before, { phone: PROVIDER_PHONE });
    assert.deepEqual(row, before);
    assert.equal(row.phone_source, 'apollo_reveal');
  });

  it('espacios alrededor del mismo número siguen siendo el mismo valor', () => {
    const { row, edit } = applyManualEdit(providerContact('apollo_cache'), {
      phone: `  ${PROVIDER_PHONE}  `,
    });
    assert.equal(edit.kind, 'unchanged');
    assert.equal(row.phone_source, 'apollo_cache');
  });

  it('un contacto sin teléfono que recibe vacío sigue sin cambios', () => {
    const empty: ContactRow = {
      phone: null,
      phone_source: null,
      phone_type: null,
      phone_raw_type: null,
      phone_revealed_at: null,
      phone_processing_basis: null,
      phone_confidence: null,
      mobile_phone: null,
    };
    const { edit } = applyManualEdit(empty, { phone: '' });
    assert.equal(edit.kind, 'unchanged');
  });
});

describe('R1 — un número nuevo pasa la tupla entera a manual', () => {
  it('replaced escribe `manual` y limpia la metadata del proveedor', () => {
    const { row, edit } = applyManualEdit(providerContact('apollo_reveal'), {
      phone: MANUAL_PHONE,
    });
    assert.equal(edit.kind, 'replaced');
    assertManualTuple(row, MANUAL_PHONE);
  });

  it('el número se guarda normalizado (trim), no crudo', () => {
    const { row } = applyManualEdit(providerContact('apollo_reveal'), {
      phone: `  ${MANUAL_PHONE}  `,
    });
    assert.equal(row.phone, MANUAL_PHONE);
  });

  it('`manual` es vocabulario existente del CHECK, no uno nuevo', () => {
    const patch = buildManualContactPhoneEditPatch(MANUAL_PHONE);
    const allowed: ContactPhoneSource[] = [
      'apollo_search',
      'apollo_reveal',
      'apollo_cache',
      'lusha_reveal',
      'provider_payload',
      'manual',
      'unknown',
    ];
    assert.ok(allowed.includes(patch.phone_source as ContactPhoneSource));
    assert.equal(patch.phone_source, 'manual');
  });

  it('el patch tiene EXACTAMENTE las 7 columnas de la tupla de teléfono', () => {
    const patch = buildManualContactPhoneEditPatch(MANUAL_PHONE);
    assert.deepEqual(Object.keys(patch).sort(), [
      'phone',
      'phone_confidence',
      'phone_processing_basis',
      'phone_raw_type',
      'phone_revealed_at',
      'phone_source',
      'phone_type',
    ]);
  });

  it('el patch NO puede tocar `mobile_phone` (4O-E4.1 intacto)', () => {
    const patch = buildManualContactPhoneEditPatch(MANUAL_PHONE) as ManualContactPhoneEditPatch &
      Record<string, unknown>;
    assert.equal('mobile_phone' in patch, false);
  });

  it('el celular manual sobrevive a un reemplazo de `phone`', () => {
    const { row } = applyManualEdit(providerContact('apollo_reveal'), {
      phone: MANUAL_PHONE,
    });
    assert.equal(row.mobile_phone, MANUAL_MOBILE);
  });
});

describe('R1 — borrar el teléfono deja la tupla entera en NULL', () => {
  for (const [label, value] of [
    ['cadena vacía', ''],
    ['sólo espacios', '   '],
    ['null explícito', null],
  ] as const) {
    it(`${label} ⇒ cleared, sin metadata huérfana`, () => {
      const { row, edit } = applyManualEdit(providerContact('lusha_reveal'), {
        phone: value,
      });
      assert.equal(edit.kind, 'cleared');
      assertManualTuple(row, null);
      assert.equal(
        row.phone_source,
        null,
        'nunca `phone = NULL` con `phone_source = lusha_reveal`',
      );
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 2. Matriz de procedencias (§16)
// ═══════════════════════════════════════════════════════════════

describe('R1 — matriz de procedencias de origen', () => {
  const SOURCES: ContactPhoneSource[] = [
    'apollo_reveal',
    'apollo_cache',
    'lusha_reveal',
    'apollo_search',
    'provider_payload',
    'manual',
    'unknown',
  ];

  for (const source of SOURCES) {
    it(`${source} → reemplazo manual ⇒ manual`, () => {
      const { row } = applyManualEdit(providerContact(source), { phone: MANUAL_PHONE });
      assertManualTuple(row, MANUAL_PHONE);
    });
  }

  it('procedencia NULL → reemplazo manual ⇒ manual (deja de ser «se desconoce»)', () => {
    const row: ContactRow = { ...providerContact('unknown'), phone_source: null };
    const { row: after } = applyManualEdit(row, { phone: MANUAL_PHONE });
    assertManualTuple(after, MANUAL_PHONE);
  });

  it('manual → manual: sigue siendo manual, sin resucitar metadata', () => {
    const { row } = applyManualEdit(providerContact('manual'), { phone: MANUAL_PHONE });
    assertManualTuple(row, MANUAL_PHONE);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Regresión de privacidad (§9–§11): el número manual sobrevive
// ═══════════════════════════════════════════════════════════════

describe('R1 — tras la edición manual, la supresión ya NO borra el número', () => {
  for (const source of SUPPRESSIBLE_CONTACT_PHONE_SOURCES) {
    it(`${source} → teléfono manual ⇒ el plan NO lo incluye`, () => {
      const before = providerContact(source as ContactPhoneSource);

      // Antes de la edición, la fila SÍ es borrable: el escenario es válido y la
      // prueba no pasa por vacuidad.
      assert.deepEqual(erasedIds(before), ['contact-1']);

      const { row } = applyManualEdit(before, { phone: MANUAL_PHONE });

      assert.equal(isSuppressibleContactPhoneSource(row.phone_source), false);
      assert.deepEqual(
        erasedIds(row),
        [],
        'el número tecleado a mano no pertenece al dataset del proveedor',
      );
    });
  }

  it('reenviar el MISMO número del proveedor mantiene la fila borrable', () => {
    const before = providerContact('apollo_reveal');
    const { row } = applyManualEdit(before, { phone: PROVIDER_PHONE });
    assert.deepEqual(
      erasedIds(row),
      ['contact-1'],
      'guardar sin cambiar el teléfono no puede blindar un número del proveedor',
    );
  });

  it('editar otro campo mantiene la fila borrable', () => {
    const { row } = applyManualEdit(providerContact('lusha_reveal'), {
      mobile_phone: '+15550000777',
    });
    assert.deepEqual(erasedIds(row), ['contact-1']);
  });

  it('borrar el teléfono a mano deja la fila fuera del plan', () => {
    const { row } = applyManualEdit(providerContact('apollo_cache'), { phone: '' });
    assert.deepEqual(erasedIds(row), []);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Mutation tests (§17) — qué tiene que hacer fallar la suite
// ═══════════════════════════════════════════════════════════════

describe('R1 — mutantes que la suite debe detectar', () => {
  /** Mutante 1: la acción olvida el patch y sólo escribe `phone`. */
  function mutantPhoneOnly(row: ContactRow, phone: string): ContactRow {
    return { ...row, phone };
  }

  /** Mutante 2: la regla ingenua «campo presente ⇒ manual». */
  function mutantPresenceMeansManual(
    row: ContactRow,
    input: { phone?: string },
  ): ContactRow {
    if (input.phone === undefined) return row;
    return { ...row, phone: input.phone, phone_source: 'manual' };
  }

  for (const source of SUPPRESSIBLE_CONTACT_PHONE_SOURCES) {
    it(`mutante «sólo phone» deja ${source} vivo y la DSAR borraría el número manual`, () => {
      const mutated = mutantPhoneOnly(
        providerContact(source as ContactPhoneSource),
        MANUAL_PHONE,
      );
      assert.equal(mutated.phone_source, source);
      assert.deepEqual(
        erasedIds(mutated),
        ['contact-1'],
        'es el defecto de R1: reproducido aquí para que la suite lo distinga',
      );

      const fixed = applyManualEdit(
        providerContact(source as ContactPhoneSource),
        { phone: MANUAL_PHONE },
      ).row;
      assert.notDeepEqual(erasedIds(fixed), erasedIds(mutated));
    });
  }

  it('mutante «presencia ⇒ manual» pierde procedencia válida al reenviar el mismo valor', () => {
    const mutated = mutantPresenceMeansManual(providerContact('apollo_reveal'), {
      phone: PROVIDER_PHONE,
    });
    assert.equal(mutated.phone_source, 'manual');
    assert.deepEqual(erasedIds(mutated), [], 'el mutante blinda un número Apollo');

    const fixed = applyManualEdit(providerContact('apollo_reveal'), {
      phone: PROVIDER_PHONE,
    }).row;
    assert.deepEqual(erasedIds(fixed), ['contact-1']);
  });

  it('mutante «presencia ⇒ manual» convertiría en manual al editar otro campo', () => {
    // El formulario real reenvía SIEMPRE `phone`, así que guardar un cargo bastaría.
    const mutated = mutantPresenceMeansManual(providerContact('lusha_reveal'), {
      phone: PROVIDER_PHONE,
    });
    assert.equal(mutated.phone_source, 'manual');
    assert.equal(
      applyManualEdit(providerContact('lusha_reveal'), { phone: PROVIDER_PHONE }).row
        .phone_source,
      'lusha_reveal',
    );
  });

  it('un mutante que conservara revealed_at rompe la tupla esperada', () => {
    const patch = buildManualContactPhoneEditPatch(MANUAL_PHONE);
    const mutated: ContactRow = {
      ...providerContact('apollo_reveal'),
      ...patch,
      phone_revealed_at: '2026-07-01T10:00:00.000Z',
    };
    assert.throws(() => assertManualTuple(mutated, MANUAL_PHONE));
  });

  it('un mutante que conservara raw_type rompe la tupla esperada', () => {
    const patch = buildManualContactPhoneEditPatch(MANUAL_PHONE);
    const mutated: ContactRow = {
      ...providerContact('apollo_reveal'),
      ...patch,
      phone_raw_type: 'mobile',
    };
    assert.throws(() => assertManualTuple(mutated, MANUAL_PHONE));
  });

  it('un mutante que nulificara `mobile_phone` rompe la garantía de 4O-E4.1', () => {
    const { row } = applyManualEdit(providerContact('apollo_reveal'), {
      phone: MANUAL_PHONE,
    });
    assert.equal(row.mobile_phone, MANUAL_MOBILE);
    const mutated: ContactRow = { ...row, mobile_phone: null };
    assert.notEqual(mutated.mobile_phone, row.mobile_phone);
  });
});
