/**
 * Agente 2A — Erasure provenance-safe de teléfonos oficiales
 * (AGENT2A-PHONE-REVEAL-4O-E4).
 *
 * ═══════════════════════════════════════════════════════════════════
 * EL DEFECTO
 * ═══════════════════════════════════════════════════════════════════
 *
 * La supresión de privacidad limpiaba la caché, el escalar del candidato y la
 * colección canónica (4O-E2), pero al llegar al contacto OFICIAL exigía que
 * `contacts.phone_source` estuviera en una allowlist que sólo contenía Apollo. Un
 * teléfono revelado por Lusha sobrevivía intacto en la fila visible —la que pinta la
 * UI y la que se sincroniza a HubSpot— y la operación se declaraba `ok`. El dato
 * personal seguía a la vista después de una DSAR.
 *
 * ═══════════════════════════════════════════════════════════════════
 * LAS DOS PROPIEDADES, EN TENSIÓN
 * ═══════════════════════════════════════════════════════════════════
 *
 *   1. procedencia Lusha DEMOSTRADA  ⇒ el teléfono se borra
 *   2. procedencia AUSENTE o ajena   ⇒ el teléfono SOBREVIVE
 *
 * La segunda es la que hace que la primera sea segura, y es la que este archivo
 * protege con más casos: `manual`, `unknown`, `NULL`, `apollo_search`,
 * `provider_payload` y cualquier fuente futura no aprobada no se tocan NUNCA, ni
 * siquiera cuando el número coincide exactamente con uno de la colección del
 * candidato. Coincidencia de valor no es procedencia.
 *
 * ═══════════════════════════════════════════════════════════════════
 * EL LÍMITE QUE SE DECLARA EN VEZ DE DISIMULAR
 * ═══════════════════════════════════════════════════════════════════
 *
 * `contacts.mobile_phone` NO tiene procedencia: no existe `mobile_phone_source` y
 * los únicos escritores del campo son los formularios manuales de contacto. Por eso
 * la erasure de Lusha NO lo toca, y por eso es PARCIAL cuando ese campo está
 * poblado — la UI lo prioriza (`mobile_phone ?? phone`), así que un número podría
 * seguir siendo visible. El test lo afirma en voz alta:
 *
 *     erasure_partial_due_to_missing_mobile_provenance = true
 *
 * Puro y determinista: sin proveedores, sin créditos, sin DSAR real, sin DB, sin
 * flags, sin HubSpot. Todos los teléfonos son sintéticos 555.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MOBILE_PHONE_SUPPRESSIBLE_PHONE_SOURCES,
  SUPPRESSIBLE_CONTACT_PHONE_SOURCES,
  buildContactPhoneSuppressionPatch,
  buildPhoneCacheSuppressionPlan,
  clearsMobilePhoneForSource,
  isSuppressibleContactPhoneSource,
  type PhoneCacheSuppressionInput,
  type PhoneCacheSuppressionPlanResult,
  type SuppressibleCandidate,
  type SuppressibleContact,
} from '../phone-cache-suppression-core';
import { buildContactPhoneMetadata } from '../candidate-review-core';

// ═══════════════════════════════════════════════════════════════
// Escenario sintético
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_A = 'acc-aaaa-0001';
const ACCOUNT_B = 'acc-bbbb-0002';
const PERSON_ID = 'a1b2c3d4e5f60718293a4b5c';
const ACTOR = 'user-admin-0001';
const NOW = '2026-08-10T12:00:00.000Z';

/** Teléfono sintético. Nunca se compara con nada real. */
const LUSHA_PHONE = '+15550000101';
/** Segundo número sintético, distinto, en `mobile_phone`. */
const OTHER_MOBILE = '+15550000202';

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

function makeCandidate(
  overrides: Partial<SuppressibleCandidate> = {},
): SuppressibleCandidate {
  return {
    id: 'cand-1',
    accountId: ACCOUNT_A,
    enrichmentRunId: 'run-1',
    enrichmentMetadata: {
      phone: { source: 'lusha_reveal', type: 'mobile', raw_type: 'mobile' },
    } as SuppressibleCandidate['enrichmentMetadata'],
    createdContactId: 'contact-1',
    matchedContactId: 'contact-1',
    ...overrides,
  };
}

function makeContact(
  overrides: Partial<SuppressibleContact> = {},
): SuppressibleContact {
  return {
    id: 'contact-1',
    accountId: ACCOUNT_A,
    sourceCandidateId: 'cand-1',
    phoneSource: 'lusha_reveal',
    ...overrides,
  };
}

function plan(
  contacts: SuppressibleContact[],
  input: Partial<PhoneCacheSuppressionInput> = {},
): PhoneCacheSuppressionPlanResult {
  return buildPhoneCacheSuppressionPlan(baseInput(input), {
    nowIso: NOW,
    candidates: [makeCandidate()],
    contacts,
  });
}

function erasedIds(result: PhoneCacheSuppressionPlanResult): string[] {
  return result.ok ? result.plan.contactPatches.map((c) => c.contactId) : [];
}

function onlyPatch(result: PhoneCacheSuppressionPlanResult) {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('plan rechazado');
  assert.equal(result.plan.contactPatches.length, 1);
  return result.plan.contactPatches[0];
}

// ═══════════════════════════════════════════════════════════════
// 1. Procedencia Lusha demostrada ⇒ se borra
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 — un teléfono oficial con procedencia Lusha se borra', () => {
  it('lusha_reveal está en la allowlist de procedencias borrables', () => {
    assert.equal(isSuppressibleContactPhoneSource('lusha_reveal'), true);
    assert.ok(SUPPRESSIBLE_CONTACT_PHONE_SOURCES.includes('lusha_reveal'));
  });

  it('la allowlist es EXACTAMENTE Apollo reveal + Apollo cache + Lusha reveal', () => {
    assert.deepEqual([...SUPPRESSIBLE_CONTACT_PHONE_SOURCES].sort(), [
      'apollo_cache',
      'apollo_reveal',
      'lusha_reveal',
    ]);
  });

  it('el contacto con procedencia Lusha y vínculo probado entra en el plan', () => {
    assert.deepEqual(erasedIds(plan([makeContact()])), ['contact-1']);
  });

  it('la procedencia observada viaja con el patch', () => {
    assert.equal(onlyPatch(plan([makeContact()])).observedPhoneSource, 'lusha_reveal');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Regresión Apollo — E1/E2/E3 intactos
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 — las procedencias Apollo siguen borrándose igual', () => {
  for (const source of ['apollo_reveal', 'apollo_cache']) {
    it(`${source} sigue siendo borrable`, () => {
      assert.deepEqual(erasedIds(plan([makeContact({ phoneSource: source })])), [
        'contact-1',
      ]);
    });

    it(`${source} sigue borrando ADEMÁS mobile_phone (contrato previo intacto)`, () => {
      const { patch } = onlyPatch(plan([makeContact({ phoneSource: source })]));
      assert.equal(
        Object.prototype.hasOwnProperty.call(patch, 'mobile_phone'),
        true,
        `${source} debe seguir nulando mobile_phone`,
      );
      assert.equal(patch.mobile_phone, null);
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 3. Preservación — NO PROVENANCE ⇒ NO DESTRUCTIVE ERASURE
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 — sin procedencia demostrable el teléfono SOBREVIVE', () => {
  for (const source of [
    'manual',
    'unknown',
    'apollo_search',
    'provider_payload',
    'hubspot',
    'lusha_search',
    'future_unapproved_source',
    '',
    null,
  ]) {
    it(`procedencia ${JSON.stringify(source)} ⇒ 0 patches`, () => {
      assert.deepEqual(erasedIds(plan([makeContact({ phoneSource: source })])), []);
      assert.equal(isSuppressibleContactPhoneSource(source), false);
    });
  }

  // §8: coincidencia de valor NO demuestra procedencia. El plan no recibe el
  // teléfono del contacto precisamente para que no pueda decidir por su valor: la
  // proyección `SuppressibleContact` sólo lleva id, cuenta, candidato y procedencia.
  it('un contacto manual NO se borra aunque el número coincida con el de la colección', () => {
    const contact = makeContact({ id: 'contact-manual', phoneSource: 'manual' });
    assert.equal(
      Object.prototype.hasOwnProperty.call(contact, 'phone'),
      false,
      'la proyección no debe exponer el teléfono: no hay nada que comparar',
    );
    assert.deepEqual(erasedIds(plan([contact])), []);
  });

  it('un contacto de otra cuenta con procedencia Lusha NO se borra', () => {
    assert.deepEqual(
      erasedIds(plan([makeContact({ id: 'contact-x', accountId: ACCOUNT_B })])),
      [],
    );
  });

  it('procedencia Lusha SIN vínculo probado NO se borra', () => {
    assert.deepEqual(
      erasedIds(plan([makeContact({ id: 'contact-y', sourceCandidateId: null })])),
      [],
    );
    assert.deepEqual(
      erasedIds(
        plan([makeContact({ id: 'contact-z', sourceCandidateId: 'cand-ajeno' })]),
      ),
      [],
    );
  });

  it('una mezcla sólo borra las filas con procedencia demostrada', () => {
    const result = plan([
      makeContact({ id: 'c-lusha', phoneSource: 'lusha_reveal' }),
      makeContact({ id: 'c-apollo', phoneSource: 'apollo_reveal' }),
      makeContact({ id: 'c-manual', phoneSource: 'manual' }),
      makeContact({ id: 'c-null', phoneSource: null }),
      makeContact({ id: 'c-unknown', phoneSource: 'unknown' }),
    ]);
    assert.deepEqual(erasedIds(result).sort(), ['c-apollo', 'c-lusha']);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. La tupla completa — sin metadata huérfana
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 — la tupla telefónica se limpia entera', () => {
  /** Las 7 columnas de la tupla, verificadas contra el esquema real de Prod. */
  const TUPLE = [
    'phone',
    'phone_type',
    'phone_source',
    'phone_raw_type',
    'phone_revealed_at',
    'phone_processing_basis',
    'phone_confidence',
  ] as const;

  for (const source of SUPPRESSIBLE_CONTACT_PHONE_SOURCES) {
    it(`${source}: las 7 columnas de la tupla quedan null`, () => {
      const { patch } = onlyPatch(plan([makeContact({ phoneSource: source })]));
      for (const column of TUPLE) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(patch, column),
          true,
          `${column} debe estar en el patch`,
        );
        assert.equal(
          (patch as unknown as Record<string, unknown>)[column],
          null,
          `${column} debe quedar null`,
        );
      }
    });
  }

  it('NUNCA queda phone_source con phone ya borrado (metadata delatora)', () => {
    const { patch } = onlyPatch(plan([makeContact()]));
    assert.equal(patch.phone, null);
    assert.equal(patch.phone_source, null);
  });

  it('NUNCA queda phone_type ni phone_revealed_at con phone ya borrado', () => {
    const { patch } = onlyPatch(plan([makeContact()]));
    assert.equal(patch.phone_type, null);
    assert.equal(patch.phone_revealed_at, null);
    assert.equal(patch.phone_processing_basis, null);
  });

  it('el patch no escribe NADA fuera de la tupla (ni email, ni nombre, ni metadata)', () => {
    const { patch } = onlyPatch(plan([makeContact()]));
    const allowed = new Set<string>([...TUPLE, 'mobile_phone']);
    for (const key of Object.keys(patch)) {
      assert.ok(allowed.has(key), `el patch no debe escribir ${key}`);
    }
  });

  // §14: un solo UPDATE por contacto. El patch es un único objeto plano, así que no
  // hay forma de que la fila quede a medias entre dos escrituras.
  it('la tupla viaja en UN solo objeto de patch (un único UPDATE por fila)', () => {
    const result = plan([makeContact()]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.contactPatches.length, 1);
    assert.equal(typeof result.plan.contactPatches[0].patch, 'object');
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. mobile_phone — el límite declarado
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 — mobile_phone NO se borra por procedencia Lusha', () => {
  it('la lista de procedencias que borran mobile_phone es SUBCONJUNTO ESTRICTO', () => {
    assert.deepEqual([...MOBILE_PHONE_SUPPRESSIBLE_PHONE_SOURCES].sort(), [
      'apollo_cache',
      'apollo_reveal',
    ]);
    for (const source of MOBILE_PHONE_SUPPRESSIBLE_PHONE_SOURCES) {
      assert.ok(
        SUPPRESSIBLE_CONTACT_PHONE_SOURCES.includes(source),
        `${source} debe estar también en la allowlist general`,
      );
    }
    assert.ok(
      MOBILE_PHONE_SUPPRESSIBLE_PHONE_SOURCES.length <
        SUPPRESSIBLE_CONTACT_PHONE_SOURCES.length,
      'debe ser un subconjunto ESTRICTO',
    );
  });

  it('lusha_reveal NO borra mobile_phone', () => {
    assert.equal(clearsMobilePhoneForSource('lusha_reveal'), false);
  });

  it('el patch de Lusha NO contiene la clave mobile_phone (no toca la columna)', () => {
    const { patch } = onlyPatch(plan([makeContact({ phoneSource: 'lusha_reveal' })]));
    assert.equal(
      Object.prototype.hasOwnProperty.call(patch, 'mobile_phone'),
      false,
      'la clave no debe existir: mandarla como undefined invitaría a un writer a nularla',
    );
  });

  /**
   * §11 — el caso obligatorio, con el límite declarado en voz alta.
   *
   * phone = teléfono Lusha, phone_source = lusha_reveal, mobile_phone = OTRO número.
   * Después de la supresión: phone borrado, mobile_phone intacto.
   */
  it('caso obligatorio: phone Lusha se borra y mobile_phone queda intacto', () => {
    // Fila simulada tal como estaría en `contacts` antes de la supresión.
    const row: Record<string, unknown> = {
      id: 'contact-1',
      phone: LUSHA_PHONE,
      phone_source: 'lusha_reveal',
      phone_type: 'mobile',
      phone_raw_type: 'mobile',
      phone_revealed_at: NOW,
      phone_processing_basis: 'legitimate_interest',
      phone_confidence: 'high',
      mobile_phone: OTHER_MOBILE,
    };

    const { patch } = onlyPatch(plan([makeContact({ phoneSource: 'lusha_reveal' })]));
    // El UPDATE aplica el patch sobre la fila: sólo las claves presentes cambian.
    const after = { ...row, ...patch };

    assert.equal(after.phone, null, 'el teléfono Lusha debe desaparecer');
    assert.equal(after.phone_source, null);
    assert.equal(after.phone_revealed_at, null);
    assert.equal(after.phone_confidence, null);
    assert.equal(
      after.mobile_phone,
      OTHER_MOBILE,
      'mobile_phone NO tiene procedencia: debe quedar EXACTAMENTE igual',
    );

    // El límite se declara, no se disimula.
    const erasurePartialDueToMissingMobileProvenance =
      after.mobile_phone !== null;
    assert.equal(erasurePartialDueToMissingMobileProvenance, true);

    // Y con ello, el número sigue siendo VISIBLE: la UI resuelve `mobile_phone ?? phone`.
    const visiblePhone = (after.mobile_phone ?? after.phone) as string | null;
    assert.equal(
      visiblePhone,
      OTHER_MOBILE,
      'consecuencia declarada: un número puede sobrevivir por mobile_phone',
    );
  });

  it('Apollo, en cambio, sí lo borra: el contrato previo no se toca', () => {
    const row = { phone: LUSHA_PHONE, mobile_phone: OTHER_MOBILE };
    const { patch } = onlyPatch(plan([makeContact({ phoneSource: 'apollo_reveal' })]));
    const after = { ...row, ...patch };
    assert.equal(after.phone, null);
    assert.equal(after.mobile_phone, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. La fábrica del patch, aislada
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 — buildContactPhoneSuppressionPatch', () => {
  it('devuelve la tupla sin mobile_phone para lusha_reveal', () => {
    const patch = buildContactPhoneSuppressionPatch('lusha_reveal');
    assert.equal(Object.prototype.hasOwnProperty.call(patch, 'mobile_phone'), false);
    assert.equal(patch.phone, null);
    assert.equal(patch.phone_confidence, null);
  });

  it('devuelve la tupla CON mobile_phone para las procedencias Apollo', () => {
    for (const source of ['apollo_reveal', 'apollo_cache']) {
      const patch = buildContactPhoneSuppressionPatch(source);
      assert.equal(Object.prototype.hasOwnProperty.call(patch, 'mobile_phone'), true);
      assert.equal(patch.mobile_phone, null);
    }
  });

  it('todos los valores del patch son null: nunca escribe un dato', () => {
    for (const source of SUPPRESSIBLE_CONTACT_PHONE_SOURCES) {
      const patch = buildContactPhoneSuppressionPatch(source);
      for (const [key, value] of Object.entries(patch)) {
        assert.equal(value, null, `${key} debe ser null`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Auditoría sin PII
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 8. La cadena de procedencia — el reveal llega al contacto intacto
// ═══════════════════════════════════════════════════════════════

/**
 * §3/§9 — sin esta cadena la ampliación de la allowlist no valdría nada: si la
 * aprobación degradara `lusha_reveal` a `provider_payload`, `unknown` o `null`, el
 * contacto oficial nunca sería borrable por procedencia y la erasure seguiría siendo
 * un no-op silencioso. Se prueba el eslabón que la aprobación controla: metadata del
 * candidato → `contacts.phone_source`.
 */
describe('4O-E4 — la aprobación propaga la procedencia sin degradarla', () => {
  const candidateWithPhoneSource = (source: unknown) =>
    ({
      enrichment_metadata: {
        phone: { source, type: 'mobile', raw_type: 'mobile' },
      },
    }) as Parameters<typeof buildContactPhoneMetadata>[0];

  it('lusha_reveal llega LITERAL a contacts.phone_source', () => {
    const meta = buildContactPhoneMetadata(candidateWithPhoneSource('lusha_reveal'));
    assert.equal(meta.phone_source, 'lusha_reveal');
  });

  it('la procedencia propagada es borrable: la cadena cierra de punta a punta', () => {
    const meta = buildContactPhoneMetadata(candidateWithPhoneSource('lusha_reveal'));
    assert.equal(isSuppressibleContactPhoneSource(meta.phone_source), true);
  });

  for (const source of ['apollo_reveal', 'apollo_cache', 'manual', 'unknown']) {
    it(`${source} se propaga sin cambiar (vocabulario general intacto)`, () => {
      assert.equal(
        buildContactPhoneMetadata(candidateWithPhoneSource(source)).phone_source,
        source,
      );
    });
  }

  it('una procedencia fuera del vocabulario se degrada a null y por tanto NO es borrable', () => {
    for (const source of ['lusha_search', 'inventada', 42, null, undefined]) {
      const meta = buildContactPhoneMetadata(candidateWithPhoneSource(source));
      assert.equal(meta.phone_source, null);
      assert.equal(isSuppressibleContactPhoneSource(meta.phone_source), false);
    }
  });

  it('sin bloque phone en la metadata la procedencia es null (no se inventa)', () => {
    const meta = buildContactPhoneMetadata({
      enrichment_metadata: {},
    } as Parameters<typeof buildContactPhoneMetadata>[0]);
    assert.equal(meta.phone_source, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Auditoría sin PII
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 — el plan no transporta PII del contacto', () => {
  it('el patch de contacto no contiene teléfono, email, nombre ni dedupe key', () => {
    const { patch } = onlyPatch(plan([makeContact()]));
    const serialized = JSON.stringify(patch);
    for (const forbidden of [LUSHA_PHONE, OTHER_MOBILE, '555']) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `el patch no debe contener ${forbidden}`,
      );
    }
    for (const key of ['email', 'full_name', 'first_name', 'dedupe_key']) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(patch, key),
        false,
        `el patch no debe llevar ${key}`,
      );
    }
  });

  it('la procedencia observada es un valor de vocabulario, no un dato personal', () => {
    const { observedPhoneSource } = onlyPatch(plan([makeContact()]));
    assert.ok(SUPPRESSIBLE_CONTACT_PHONE_SOURCES.includes(observedPhoneSource));
  });
});
