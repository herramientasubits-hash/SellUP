// AGENT2A-HUBSPOT-ALL-PHONES-CREATE-LINK (2026-11-12)
//
// Al CREAR un contacto en HubSpot y al COMPLETAR VACÍOS al vincular uno existente viajan TODOS
// los números de la colección del contacto (`contact_phones`, el principal primero), repartidos
// con la regla única `planRevealedPhonesForHubSpot`:
//   `phone` → `mobilephone` → `company_phone` (apagado) → `telefono_alterno` (encendido).
// Antes viajaban sólo `contacts.phone` / `contacts.mobile_phone`, y como la aprobación nunca
// llena `mobile_phone`, un contacto con dos números llegaba a HubSpot con uno.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHubSpotContactProperties,
  buildHubSpotFillEmptyProperties,
  collectContactPhonesForHubSpot,
  runSyncContactToHubSpot,
  type ContactForSync,
  type HubSpotContactCreateInput,
  type HubSpotContactFillProperties,
  type HubSpotExistingContactMatch,
  type RevealedPhoneForHubSpot,
  type SyncContactDeps,
} from '../contact-hubspot-sync-core';
import {
  buildHubSpotContactCreateBody,
  postHubSpotContactCreateWithLinkedinFallback,
} from '../../../server/integrations/hubspot-contact-sync';

const P1 = '+57 300 111 2222';
const P2 = '+57 315 444 5555';
const P3 = '+57 320 999 8888';
const P4 = '+57 601 777 0000';

function makeContact(overrides: Partial<ContactForSync> = {}): ContactForSync {
  return {
    id: 'contact-1',
    account_id: 'account-1',
    full_name: 'Ana María Pérez',
    first_name: 'Ana María',
    last_name: 'Pérez',
    email: 'ana@empresa.com',
    // Forma real tras aprobar: el principal proyectado a `phone`, `mobile_phone` nunca se llena.
    phone: P1,
    mobile_phone: null,
    job_title: 'Gerente de RRHH',
    linkedin_url: null,
    hubspot_contact_id: null,
    metadata: {},
    ...overrides,
  };
}

const collection = (...phones: string[]): RevealedPhoneForHubSpot[] => phones.map((phone) => ({ phone }));

// ── Regla pura: creación ────────────────────────────────────────

test('crear: dos números en la colección ⇒ phone + mobilephone', () => {
  const input = buildHubSpotContactProperties(makeContact(), 'ana@empresa.com', collection(P1, P2));
  assert.equal(input.phone, P1);
  assert.equal(input.mobilePhone, P2);
  assert.equal(input.companyPhone ?? null, null);
  assert.equal(input.alternatePhone ?? null, null);
});

test('crear: tres números ⇒ phone + mobilephone + telefono_alterno (company_phone apagado se salta)', () => {
  const input = buildHubSpotContactProperties(makeContact(), 'ana@empresa.com', collection(P1, P2, P3));
  assert.equal(input.phone, P1);
  assert.equal(input.mobilePhone, P2);
  assert.equal(input.companyPhone ?? null, null);
  assert.equal(input.alternatePhone ?? null, P3);
});

test('crear: más números que campos ⇒ el sobrante se queda en SellUp', () => {
  const input = buildHubSpotContactProperties(makeContact(), 'ana@empresa.com', collection(P1, P2, P3, P4));
  assert.deepEqual(
    [input.phone, input.mobilePhone, input.companyPhone ?? null, input.alternatePhone ?? null],
    [P1, P2, null, P3],
  );
});

test('crear: el escalar repetido en la colección cuenta una vez (con o sin indicativo)', () => {
  const input = buildHubSpotContactProperties(
    makeContact({ phone: '3001112222' }),
    'ana@empresa.com',
    collection(P1, P2),
  );
  assert.equal(input.phone, '3001112222'); // el escalar conserva su campo y su forma
  assert.equal(input.mobilePhone, P2);
  assert.equal(input.alternatePhone ?? null, null);
});

test('crear: sólo celular en SellUp ⇒ va a `mobilephone` (campo a campo, como la edición)', () => {
  const input = buildHubSpotContactProperties(makeContact({ phone: null, mobile_phone: P2 }), 'ana@empresa.com', []);
  assert.equal(input.phone, null);
  assert.equal(input.mobilePhone, P2);
});

test('crear: sólo celular + colección con otro ⇒ el de la colección llena `phone`', () => {
  const input = buildHubSpotContactProperties(
    makeContact({ phone: null, mobile_phone: P2 }),
    'ana@empresa.com',
    collection(P2, P3),
  );
  assert.equal(input.phone, P3);
  assert.equal(input.mobilePhone, P2);
  assert.equal(input.alternatePhone ?? null, null);
});

test('crear: sin números adicionales, las claves `companyPhone` / `alternatePhone` no aparecen', () => {
  const input = buildHubSpotContactProperties(makeContact(), 'ana@empresa.com', collection(P1, P2));
  assert.ok(!('companyPhone' in input));
  assert.ok(!('alternatePhone' in input));
});

test('crear: sin colección (legacy) viajan los escalares, en orden', () => {
  const input = buildHubSpotContactProperties(makeContact({ phone: P1, mobile_phone: P2 }), 'ana@empresa.com');
  assert.equal(input.phone, P1);
  assert.equal(input.mobilePhone, P2);
  assert.equal(input.alternatePhone ?? null, null);
});

test('crear: sin ningún número ⇒ ningún campo de teléfono', () => {
  const input = buildHubSpotContactProperties(makeContact({ phone: null }), 'ana@empresa.com', []);
  assert.deepEqual([input.phone, input.mobilePhone, input.companyPhone ?? null, input.alternatePhone ?? null], [null, null, null, null]);
});

test('collectContactPhonesForHubSpot: colección primero, escalares al final, vacíos fuera', () => {
  assert.deepEqual(
    collectContactPhonesForHubSpot({ phone: P3, mobile_phone: '  ' }, [{ phone: P1, type: 'mobile' }, { phone: ' ' }]),
    [{ phone: P1, type: 'mobile' }, { phone: P3 }],
  );
});

// ── Cuerpo del POST de creación ─────────────────────────────────

const baseCreate = (over: Partial<HubSpotContactCreateInput> = {}): HubSpotContactCreateInput => ({
  email: 'ana@empresa.com',
  firstname: 'Ana',
  lastname: 'Pérez',
  jobtitle: null,
  phone: P1,
  mobilePhone: P2,
  linkedinUrl: null,
  ...over,
});

test('cuerpo: telefono_alterno viaja; company_phone (apagado) nunca, aunque se pase', () => {
  const body = buildHubSpotContactCreateBody(baseCreate({ alternatePhone: P3, companyPhone: P4 }), false);
  assert.equal(body.phone, P1);
  assert.equal(body.mobilephone, P2);
  assert.equal(body.telefono_alterno, P3);
  assert.ok(!('company_phone' in body));
});

test('cuerpo: sin números adicionales no aparecen sus claves (nunca cadena vacía)', () => {
  const body = buildHubSpotContactCreateBody(baseCreate({ alternatePhone: null }), false);
  assert.ok(!('telefono_alterno' in body));
  assert.ok(!('company_phone' in body));
});

const res = (status: number) => new Response(status === 201 ? '{"id":"1"}' : '{}', { status });

test('POST: un 400 con telefono_alterno reintenta UNA vez sin él (phone/mobilephone se conservan)', async () => {
  const calls: Array<Record<string, string>> = [];
  const response = await postHubSpotContactCreateWithLinkedinFallback(
    { email: 'a@b.co', phone: P1, mobilephone: P2, telefono_alterno: P3 },
    async (body) => {
      calls.push(body);
      return calls.length === 1 ? res(400) : res(201);
    },
  );
  assert.equal(response.status, 201);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { email: 'a@b.co', phone: P1, mobilephone: P2 });
});

test('POST: un 400 sin propiedades opcionales no reintenta', async () => {
  let n = 0;
  const response = await postHubSpotContactCreateWithLinkedinFallback({ email: 'a@b.co', phone: P1 }, async () => {
    n += 1;
    return res(400);
  });
  assert.equal(response.status, 400);
  assert.equal(n, 1);
});

// ── Regla pura: completar vacíos al vincular ────────────────────

test('vincular: HubSpot sin números ⇒ viajan los de la colección a cada campo vacío y leído', () => {
  const fill = buildHubSpotFillEmptyProperties(
    makeContact(),
    { firstname: 'Ana María', lastname: 'Pérez', jobtitle: 'X', phone: null, mobilephone: null, company_phone: null, telefono_alterno: null },
    collection(P1, P2, P3),
  );
  assert.deepEqual(fill, { phone: P1, mobilephone: P2, telefono_alterno: P3 });
});

test('vincular: con `phone` ocupado en HubSpot, los nuevos siguen el orden sin pisar', () => {
  const fill = buildHubSpotFillEmptyProperties(
    makeContact(),
    { firstname: 'Ana María', lastname: 'Pérez', jobtitle: 'X', phone: P4, mobilephone: '', company_phone: null, telefono_alterno: null },
    collection(P1, P2),
  );
  assert.deepEqual(fill, { mobilephone: P1, telefono_alterno: P2 });
});

test('vincular: el candidato (sin colección) conserva su comportamiento', () => {
  const fill = buildHubSpotFillEmptyProperties(makeContact(), {
    firstname: 'Ana María',
    lastname: 'Pérez',
    jobtitle: 'X',
    phone: null,
    mobilephone: null,
  });
  assert.deepEqual(fill, { phone: P1 });
});

// ── Motor completo ──────────────────────────────────────────────

interface Spy {
  created: HubSpotContactCreateInput[];
  fills: HubSpotContactFillProperties[];
  phoneReads: number;
}

function makeDeps(
  existing: HubSpotExistingContactMatch | null,
  spy: Spy,
  loadRevealedPhones: SyncContactDeps['loadRevealedPhones'],
): SyncContactDeps {
  const contact = makeContact();
  return {
    actorId: 'user-1',
    nowIso: '2026-11-12T12:00:00.000Z',
    method: 'auto',
    loadContact: async () => contact,
    loadAccount: async () => ({ id: 'account-1', name: 'Empresa', hubspot_company_id: 'hs-co-1' }),
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactByEmail: async () => existing,
    createHubSpotContact: async (input) => {
      spy.created.push(input);
      return { id: 'hs-new' };
    },
    updateHubSpotContact: async () => {
      throw new Error('PATCH_DE_TELEFONO_PROHIBIDO_EN_ALTA');
    },
    associateContactWithCompany: async () => ({ ok: true }),
    fillEmptyHubSpotContactProperties: async (_id, props) => {
      spy.fills.push(props);
      return { ok: true, written: Object.keys(props) as never };
    },
    loadRevealedPhones: loadRevealedPhones
      ? async (id) => {
          spy.phoneReads += 1;
          return loadRevealedPhones(id);
        }
      : undefined,
    persistSync: async () => ({}),
  };
}

const freshSpy = (): Spy => ({ created: [], fills: [], phoneReads: 0 });

test('motor · creado: el POST lleva los dos números de la colección', async () => {
  const spy = freshSpy();
  const result = await runSyncContactToHubSpot('contact-1', makeDeps(null, spy, async () => collection(P1, P2)));
  assert.equal(result.ok, true);
  assert.equal(spy.phoneReads, 1);
  assert.equal(spy.created.length, 1);
  assert.equal(spy.created[0].phone, P1);
  assert.equal(spy.created[0].mobilePhone, P2);
});

test('motor · creado: si la colección no se puede leer, se crea igual con los escalares', async () => {
  const spy = freshSpy();
  const result = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps(null, spy, async () => {
      throw new Error('db down');
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(spy.created[0].phone, P1);
  assert.equal(spy.created[0].mobilePhone, null);
});

test('motor · vinculado: el completado de vacíos lleva todos los números de la colección', async () => {
  const spy = freshSpy();
  const existing: HubSpotExistingContactMatch = {
    id: 'hs-1',
    properties: {
      firstname: 'Ana María',
      lastname: 'Pérez',
      jobtitle: 'Gerente de RRHH',
      phone: null,
      mobilephone: null,
      company_phone: null,
      telefono_alterno: null,
      hs_linkedin_url: null,
    },
  };
  const result = await runSyncContactToHubSpot('contact-1', makeDeps(existing, spy, async () => collection(P1, P2, P3)));
  assert.equal(result.ok, true);
  assert.equal(spy.created.length, 0);
  assert.deepEqual(spy.fills, [{ phone: P1, mobilephone: P2, telefono_alterno: P3 }]);
});
