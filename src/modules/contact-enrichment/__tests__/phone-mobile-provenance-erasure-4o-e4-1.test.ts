/**
 * Agente 2A — `contacts.mobile_phone` no se borra sin procedencia
 * (AGENT2A-PHONE-REVEAL-4O-E4.1).
 *
 * ═══════════════════════════════════════════════════════════════════
 * EL DEFECTO
 * ═══════════════════════════════════════════════════════════════════
 *
 * La supresión de privacidad de Apollo nulaba `contacts.mobile_phone` además de la
 * tupla de `phone`. La única evidencia que sostenía ese borrado era
 * `contacts.phone_source = apollo_reveal | apollo_cache` — un valor que describe la
 * columna `phone` y NINGUNA otra.
 *
 * La auditoría de escritores de este hito no encontró ninguna ruta, actual ni
 * histórica, por la que un proveedor escriba `mobile_phone`: sus únicos escritores
 * son `createContact` / `updateContact` (formularios manuales), `ContactInsertPayload`
 * no tiene la columna, Producción no tiene trigger, columna generada ni función que la
 * escriba, y los 16 commits del historial no contienen un solo escritor de proveedor.
 *
 * El caso que rompía es trivial de alcanzar y no requiere ninguna carrera:
 *
 *     contacto creado desde un candidato Apollo   → phone_source = apollo_reveal
 *     alguien teclea un celular en «Celular»      → mobile_phone = número manual
 *     `updateContact` NUNCA toca phone_source     → sigue valiendo apollo_reveal
 *     DSAR de Apollo                              → borraba el celular manual
 *
 * ═══════════════════════════════════════════════════════════════════
 * LA PROPIEDAD
 * ═══════════════════════════════════════════════════════════════════
 *
 *     NO PROVENANCE → NO DESTRUCTIVE ERASURE
 *
 * `phone_source` describe `phone`. No se extiende a `mobile_phone`, ni siquiera
 * cuando la procedencia de `phone` está demostrada de punta a punta.
 *
 * Esto NO afirma que `mobile_phone` no sea dato personal: afirma que esta operación
 * es provenance-scoped y no puede reclamar una columna sin procedencia. El borrado
 * integral por persona pertenece al modelo person-level, todavía pendiente.
 *
 * Puro y determinista: sin proveedores, sin créditos, sin DSAR real, sin DB, sin
 * flags, sin red. Todos los teléfonos son sintéticos 555.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as suppressionCore from '../phone-cache-suppression-core';
import {
  SUPPRESSIBLE_CONTACT_PHONE_SOURCES,
  buildContactPhoneSuppressionPatch,
  buildPhoneCacheSuppressionPlan,
  isSuppressibleContactPhoneSource,
  type ContactPhoneSuppressionPatch,
  type PhoneCacheSuppressionInput,
  type SuppressibleCandidate,
  type SuppressibleContact,
} from '../phone-cache-suppression-core';

// ═══════════════════════════════════════════════════════════════
// Escenario sintético
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_A = 'acc-aaaa-0001';
const PERSON_ID = 'a1b2c3d4e5f60718293a4b5c';
const ACTOR = 'user-admin-0001';
const NOW = '2026-08-10T12:00:00.000Z';
const CANDIDATE_ID = 'cand-1';

/** Teléfono revelado por un proveedor (el que SÍ tiene procedencia). */
const PROVIDER_PHONE = '+15550000101';
/** Celular escrito A MANO en el formulario (el que NO tiene procedencia). */
const MANUAL_MOBILE = '+15550000202';
/** Teléfono manual de reemplazo usado en la carrera del §11. */
const MANUAL_PHONE = '+15550000303';

/** Las 7 columnas de la tupla de `phone`, verificadas contra el esquema de Prod. */
const PHONE_TUPLE = [
  'phone',
  'phone_type',
  'phone_source',
  'phone_raw_type',
  'phone_revealed_at',
  'phone_processing_basis',
  'phone_confidence',
] as const;

function baseInput(): PhoneCacheSuppressionInput {
  return {
    providerPersonId: PERSON_ID,
    accountId: ACCOUNT_A,
    countryCode: 'CO',
    reason: 'dsar_erasure_request',
    actorUserId: ACTOR,
    actorRoleKey: 'admin',
  };
}

function makeCandidate(): SuppressibleCandidate {
  return {
    id: CANDIDATE_ID,
    accountId: ACCOUNT_A,
    enrichmentRunId: 'run-1',
    enrichmentMetadata: {} as SuppressibleCandidate['enrichmentMetadata'],
    createdContactId: 'contact-1',
    matchedContactId: null,
  };
}

function makeContact(phoneSource: string | null): SuppressibleContact {
  return {
    id: 'contact-1',
    accountId: ACCOUNT_A,
    sourceCandidateId: CANDIDATE_ID,
    phoneSource,
  };
}

/**
 * Fila de `contacts` tal como estaría ANTES de la supresión: teléfono del proveedor
 * en `phone`, celular escrito a mano en `mobile_phone`.
 */
function makeRow(phoneSource: string | null): Record<string, unknown> {
  return {
    id: 'contact-1',
    account_id: ACCOUNT_A,
    phone: PROVIDER_PHONE,
    mobile_phone: MANUAL_MOBILE,
    phone_type: 'mobile',
    phone_source: phoneSource,
    phone_raw_type: 'mobile',
    phone_revealed_at: NOW,
    phone_processing_basis: 'legitimate_interest',
    phone_confidence: 'high',
  };
}

/** Plan de supresión para un contacto con la procedencia dada. */
function planFor(phoneSource: string | null) {
  return buildPhoneCacheSuppressionPlan(baseInput(), {
    nowIso: NOW,
    candidates: [makeCandidate()],
    contacts: [makeContact(phoneSource)],
  });
}

/**
 * Aplica la supresión sobre la fila EXACTAMENTE como lo hace la server action: sólo
 * si el plan emitió un patch, y sólo si la procedencia observada sigue siendo la de
 * la fila (predicado `.eq('phone_source', observado)`).
 *
 * Devuelve la fila resultante y cuántas filas habría afectado el UPDATE.
 */
function suppress(
  row: Record<string, unknown>,
  phoneSourceAtPlanTime: string | null,
): { after: Record<string, unknown>; affected: number } {
  const result = planFor(phoneSourceAtPlanTime);
  assert.equal(result.ok, true, 'el plan no debe rechazarse en este escenario');
  if (!result.ok) return { after: row, affected: 0 };

  const patches = result.plan.contactPatches;
  if (patches.length === 0) return { after: row, affected: 0 };
  assert.equal(patches.length, 1);
  const { patch, observedPhoneSource } = patches[0];

  // Predicado del UPDATE: id + account_id + procedencia OBSERVADA.
  if (row.phone_source !== observedPhoneSource) return { after: row, affected: 0 };
  return { after: { ...row, ...patch }, affected: 1 };
}

// ═══════════════════════════════════════════════════════════════
// 1. Los tres caminos con procedencia: phone se borra, mobile_phone NO
// ═══════════════════════════════════════════════════════════════

describe('4O-E4.1 — con procedencia demostrada se borra `phone`, nunca `mobile_phone`', () => {
  for (const source of ['apollo_reveal', 'apollo_cache', 'lusha_reveal']) {
    it(`${source}: la tupla de phone queda NULL`, () => {
      const { after, affected } = suppress(makeRow(source), source);
      assert.equal(affected, 1, `${source} debe ser borrable`);
      for (const column of PHONE_TUPLE) {
        assert.equal(after[column], null, `${column} debe quedar null`);
      }
    });

    it(`${source}: mobile_phone queda EXACTAMENTE igual`, () => {
      const { after } = suppress(makeRow(source), source);
      assert.equal(
        after.mobile_phone,
        MANUAL_MOBILE,
        `${source} no puede reclamar una columna sin procedencia`,
      );
    });

    it(`${source}: el patch ni siquiera lleva la clave mobile_phone`, () => {
      const result = planFor(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const { patch } = result.plan.contactPatches[0];
      assert.equal(
        Object.prototype.hasOwnProperty.call(patch, 'mobile_phone'),
        false,
        'mandarla como undefined invitaría a un writer a nularla',
      );
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 2. §6 — el caso obligatorio, sin ninguna carrera
// ═══════════════════════════════════════════════════════════════

describe('4O-E4.1 — phone_source describe `phone`, no `mobile_phone`', () => {
  /**
   * phone   = teléfono Apollo   → phone_source = apollo_reveal
   * mobile  = número tecleado a mano por un humano
   *
   * Tras la supresión: `phone` y su metadata desaparecen; el celular manual sigue ahí.
   */
  it('caso obligatorio: phone Apollo se borra y el celular MANUAL sobrevive', () => {
    const { after, affected } = suppress(makeRow('apollo_reveal'), 'apollo_reveal');

    assert.equal(affected, 1);
    assert.equal(after.phone, null, 'el teléfono Apollo debe desaparecer');
    assert.equal(after.phone_source, null);
    assert.equal(after.phone_revealed_at, null);
    assert.equal(after.phone_processing_basis, null);
    assert.equal(after.phone_confidence, null);

    assert.equal(
      after.mobile_phone,
      MANUAL_MOBILE,
      'el celular manual no fue escrito por Apollo: borrarlo es destruir dato ajeno',
    );
  });

  it('§13 — consecuencia declarada: la UI (`mobile_phone ?? phone`) sigue mostrando el manual', () => {
    const { after } = suppress(makeRow('apollo_reveal'), 'apollo_reveal');
    const visible = (after.mobile_phone ?? after.phone) as string | null;
    assert.equal(
      visible,
      MANUAL_MOBILE,
      'es lo esperado: un valor manual visible NO se oculta como compensación',
    );
  });

  it('la procedencia de `phone` no se propaga a otra columna en NINGÚN caso', () => {
    // Ni siquiera cuando ambos números fueran iguales: el patch no mira valores.
    const row = { ...makeRow('apollo_cache'), mobile_phone: PROVIDER_PHONE };
    const { after } = suppress(row, 'apollo_cache');
    assert.equal(after.phone, null);
    assert.equal(
      after.mobile_phone,
      PROVIDER_PHONE,
      'coincidencia de valor no es procedencia (§8 de la cadena 4O-E)',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. §9 — manual / unknown / NULL: nada se toca
// ═══════════════════════════════════════════════════════════════

describe('4O-E4.1 — sin procedencia admitida no hay patch destructivo', () => {
  for (const source of ['manual', 'unknown', null, 'apollo_search', 'provider_payload']) {
    it(`procedencia ${JSON.stringify(source)}: 0 patches y la fila intacta`, () => {
      const before = makeRow(source);
      const { after, affected } = suppress(before, source);

      assert.equal(affected, 0, 'no debe emitirse ningún UPDATE');
      assert.equal(isSuppressibleContactPhoneSource(source), false);
      assert.deepEqual(after, before, 'ni una sola columna puede cambiar');
      assert.equal(after.phone, PROVIDER_PHONE);
      assert.equal(after.mobile_phone, MANUAL_MOBILE);
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 4. §11 — el UPDATE sigue siendo condicional
// ═══════════════════════════════════════════════════════════════

describe('4O-E4.1 — la escritura stale afecta 0 filas', () => {
  it('Tx B escribe un teléfono manual; la erasure de Tx A llega tarde y no borra nada', () => {
    // Tx A observa `apollo_reveal` (el plan se construye con esa procedencia).
    const observed = 'apollo_reveal';

    // Tx B reemplaza el número por uno MANUAL y commitea.
    const afterTxB: Record<string, unknown> = {
      ...makeRow(observed),
      phone: MANUAL_PHONE,
      phone_source: 'manual',
      mobile_phone: MANUAL_MOBILE,
    };

    // Tx A ejecuta su UPDATE con la procedencia que observó.
    const { after, affected } = suppress(afterTxB, observed);

    assert.equal(affected, 0, 'la escritura stale debe afectar 0 filas');
    assert.equal(after.phone, MANUAL_PHONE, 'el reemplazo manual SOBREVIVE');
    assert.equal(after.phone_source, 'manual');
    assert.equal(after.mobile_phone, MANUAL_MOBILE);
  });

  it('un cambio entre procedencias ADMITIDAS tampoco deja aplicar el patch observado', () => {
    const afterTxB = { ...makeRow('apollo_reveal'), phone_source: 'lusha_reveal' };
    const { after, affected } = suppress(afterTxB, 'apollo_reveal');

    assert.equal(affected, 0, 'un `.in(allowlist)` sí habría casado aquí');
    assert.equal(after.phone, PROVIDER_PHONE);
    assert.equal(after.phone_source, 'lusha_reveal');
  });

  it('el plan siempre transporta la procedencia observada (predicado del UPDATE)', () => {
    for (const source of SUPPRESSIBLE_CONTACT_PHONE_SOURCES) {
      const result = planFor(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.plan.contactPatches[0].observedPhoneSource, source);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. §16 — mutaciones detectadas ejecutando el core
// ═══════════════════════════════════════════════════════════════

describe('4O-E4.1 — guardas de mutación sobre el core ejecutado', () => {
  it('el patch es el MISMO objeto para toda procedencia admitida', () => {
    const patches = SUPPRESSIBLE_CONTACT_PHONE_SOURCES.map(
      (source) => planFor(source),
    ).map((result) => {
      assert.equal(result.ok, true);
      return result.ok ? result.plan.contactPatches[0].patch : null;
    });
    for (const patch of patches) {
      assert.deepEqual(patch, patches[0], 'ninguna procedencia puede tener patch propio');
    }
  });

  it('el patch tiene EXACTAMENTE las 7 columnas de la tupla y ninguna más', () => {
    assert.deepEqual(
      Object.keys(buildContactPhoneSuppressionPatch()).sort(),
      [...PHONE_TUPLE].sort(),
    );
  });

  it('la fábrica no acepta procedencia: no hay parámetro del que colgar columnas', () => {
    assert.equal(
      buildContactPhoneSuppressionPatch.length,
      0,
      'un parámetro de procedencia reabriría la inferencia entre columnas',
    );
  });

  it('la fábrica ignora cualquier argumento que se le cuele', () => {
    const sneaky = buildContactPhoneSuppressionPatch as unknown as (
      s?: string,
    ) => ContactPhoneSuppressionPatch;
    for (const source of ['apollo_reveal', 'apollo_cache', 'lusha_reveal', 'manual']) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(sneaky(source), 'mobile_phone'),
        false,
      );
    }
  });

  it('el core ya NO exporta una allowlist de mobile_phone', () => {
    // Ejecutable, no textual: si alguien reintroduce la lista, esto falla aunque
    // el comentario que la explicaba desapareciera.
    for (const removed of [
      'MOBILE_PHONE_SUPPRESSIBLE_PHONE_SOURCES',
      'clearsMobilePhoneForSource',
    ]) {
      assert.equal(
        removed in suppressionCore,
        false,
        `${removed} volvió: la procedencia de una columna no se extiende a otra`,
      );
    }
  });

  it('phone SIGUE borrándose para Apollo: la corrección no degrada la erasure', () => {
    for (const source of ['apollo_reveal', 'apollo_cache']) {
      const { after, affected } = suppress(makeRow(source), source);
      assert.equal(affected, 1, `${source} debe seguir siendo borrable`);
      assert.equal(after.phone, null);
      assert.equal(after.phone_source, null);
    }
  });

  it('ningún valor del patch es distinto de null: nunca escribe un dato', () => {
    for (const [key, value] of Object.entries(buildContactPhoneSuppressionPatch())) {
      assert.equal(value, null, `${key} debe ser null`);
    }
  });

  it('el patch no transporta PII', () => {
    const serialized = JSON.stringify(buildContactPhoneSuppressionPatch());
    for (const forbidden of [PROVIDER_PHONE, MANUAL_MOBILE, '555']) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });
});
