/**
 * Tests — Importación de teléfonos ya guardados en Apollo (Agente 2A · APOLLO-SAVED-CONTACT-PHONES-1)
 *
 * Núcleo PURO que decide, para cada persona sin teléfono en SellUp, si el teléfono
 * que el equipo ya tiene guardado en Apollo (contacts/search, 0 créditos) se puede
 * importar. Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SAVED_CONTACT_PHONE_PROCESSING_BASIS,
  buildSavedContactImportPayload,
  classifyApolloDncStatus,
  decideSavedContactPhoneImport,
  extractSavedContactPhones,
  maskPhoneForReport,
  matchApolloSavedContact,
  type ApolloSavedContact,
  type SavedContactImportTarget,
} from '../apollo-saved-contact-phone-import-core';

const PID = '64edd22acd759900012c2815';
const OTHER_PID = '5a9d1698a6da98d94d8a369b';

function target(overrides: Partial<SavedContactImportTarget> = {}): SavedContactImportTarget {
  return {
    kind: 'candidate',
    id: 'cand-1',
    accountId: 'acc-1',
    apolloPersonId: PID,
    email: 'luz@sanitas.cl',
    linkedinUrl: 'http://www.linkedin.com/in/luz-valderrama-m-761b79277',
    ...overrides,
  };
}

function saved(overrides: Partial<ApolloSavedContact> = {}): ApolloSavedContact {
  return {
    id: 'apollo-contact-1',
    person_id: PID,
    email: null,
    linkedin_url: null,
    phone_numbers: [{ sanitized_number: '+56912345678', type_cd: 'mobile', status_cd: 'valid_number' }],
    ...overrides,
  };
}

describe('matchApolloSavedContact — identidad estricta, nunca por nombre', () => {
  it('coincide por person_id', () => {
    const m = matchApolloSavedContact(target(), [saved()]);
    assert.equal(m.kind, 'matched');
    assert.equal(m.kind === 'matched' && m.matchedBy, 'person_id');
  });

  it('coincide por LinkedIn normalizado (protocolo, www, barra final, mayúsculas)', () => {
    const m = matchApolloSavedContact(target({ apolloPersonId: null }), [
      saved({ person_id: null, linkedin_url: 'https://LinkedIn.com/in/luz-valderrama-m-761b79277/' }),
    ]);
    assert.equal(m.kind === 'matched' && m.matchedBy, 'linkedin');
  });

  it('coincide por correo sin distinguir mayúsculas', () => {
    const m = matchApolloSavedContact(target({ apolloPersonId: null, linkedinUrl: null }), [
      saved({ person_id: null, email: 'LUZ@sanitas.cl' }),
    ]);
    assert.equal(m.kind === 'matched' && m.matchedBy, 'email');
  });

  it('mismo correo pero OTRO person_id ⇒ conflicto de identidad, no se usa', () => {
    const m = matchApolloSavedContact(target(), [saved({ person_id: OTHER_PID, email: 'luz@sanitas.cl' })]);
    assert.equal(m.kind, 'identity_conflict');
  });

  it('dos contactos guardados distintos que coinciden ⇒ ambiguo', () => {
    const m = matchApolloSavedContact(target({ apolloPersonId: null }), [
      saved({ id: 'a', person_id: null, email: 'luz@sanitas.cl' }),
      saved({ id: 'b', person_id: null, linkedin_url: 'linkedin.com/in/luz-valderrama-m-761b79277' }),
    ]);
    assert.equal(m.kind, 'ambiguous');
  });

  it('el mismo contacto devuelto dos veces no es ambiguo', () => {
    const m = matchApolloSavedContact(target(), [saved(), saved()]);
    assert.equal(m.kind, 'matched');
  });

  it('sólo coincide el nombre ⇒ sin coincidencia', () => {
    const m = matchApolloSavedContact(target(), [
      saved({ person_id: null, email: 'otra@sanitas.cl', linkedin_url: 'linkedin.com/in/otra' }),
    ]);
    assert.equal(m.kind, 'none');
  });
});

describe('classifyApolloDncStatus — «no llamar» fail-closed', () => {
  it('ausente o vacío ⇒ sin marca', () => {
    for (const raw of [undefined, null, '', '  ']) assert.equal(classifyApolloDncStatus(raw), 'none');
  });
  it('valores explícitos de "no está en lista" ⇒ sin marca', () => {
    for (const raw of ['not_on_dnc', 'NOT_ON_DNC', 'clear']) assert.equal(classifyApolloDncStatus(raw), 'none');
  });
  it('cualquier otro valor (conocido o no) ⇒ flagged', () => {
    for (const raw of ['on_dnc', 'dnc', 'national_dnc', 'whatever', true, 1]) {
      assert.equal(classifyApolloDncStatus(raw), 'flagged', `raw=${String(raw)}`);
    }
  });
});

describe('extractSavedContactPhones', () => {
  it('lee sanitized_number o raw_number, type_cd/type y status_cd/status', () => {
    const phones = extractSavedContactPhones(
      saved({
        phone_numbers: [
          { sanitized_number: '+56911111111', type_cd: 'mobile', status_cd: 'valid' },
          { raw_number: '+56 2 2222 2222', type: 'work_hq', status: 'no_status' },
          { sanitized_number: '', raw_number: null },
        ],
      }),
    );
    assert.equal(phones.length, 2);
    assert.equal(phones[0].phoneType, 'mobile');
    assert.equal(phones[0].phoneStatus, 'valid');
    assert.equal(phones[1].displayPhone, '+56 2 2222 2222');
    assert.equal(phones[1].phoneType, 'hq');
  });

  it('sin phone_numbers usa sanitized_phone del contacto', () => {
    const phones = extractSavedContactPhones(saved({ phone_numbers: [], sanitized_phone: '+56933333333' }));
    assert.equal(phones.length, 1);
    assert.equal(phones[0].dnc, 'none');
  });

  it('marca dnc por número', () => {
    const phones = extractSavedContactPhones(
      saved({ phone_numbers: [{ sanitized_number: '+56944444444', dnc_status: 'on_dnc' }] }),
    );
    assert.equal(phones[0].dnc, 'flagged');
  });

  it('dos entradas con el mismo número colapsan en una', () => {
    const phones = extractSavedContactPhones(
      saved({
        phone_numbers: [{ sanitized_number: '+56955555555' }, { raw_number: '+56 9 5555 5555' }],
      }),
    );
    assert.equal(phones.length, 1);
  });

  it('phone_numbers con forma rara no rompe', () => {
    assert.deepEqual(extractSavedContactPhones(saved({ phone_numbers: 'x' as unknown as [] })), []);
    assert.deepEqual(extractSavedContactPhones(saved({ phone_numbers: [null, 3] as unknown as [] })), []);
  });
});

describe('decideSavedContactPhoneImport', () => {
  const allowed = { kind: 'allowed' } as const;
  const noTombstones = new Set<string>();

  it('caso feliz ⇒ would_import con primario', () => {
    const d = decideSavedContactPhoneImport({
      target: target(),
      match: matchApolloSavedContact(target(), [saved()]),
      suppression: allowed,
      tombstonedDedupeKeys: noTombstones,
    });
    assert.equal(d.decision, 'would_import');
    assert.ok(d.decision === 'would_import' && d.phones.length === 1);
    assert.ok(d.decision === 'would_import' && d.primaryDedupeKey === d.phones[0].dedupeKey);
    assert.equal(d.apolloPersonId, PID);
  });

  it('identidad para supresión: la del objetivo; si falta, la del contacto guardado', () => {
    const t = target({ kind: 'contact', apolloPersonId: null });
    const d = decideSavedContactPhoneImport({
      target: t,
      match: matchApolloSavedContact(t, [saved({ person_id: OTHER_PID, email: 'luz@sanitas.cl' })]),
      suppression: allowed,
      tombstonedDedupeKeys: noTombstones,
    });
    assert.equal(d.apolloPersonId, OTHER_PID);
  });

  const matched = () => matchApolloSavedContact(target(), [saved()]);
  const skipCases: Array<[string, Parameters<typeof decideSavedContactPhoneImport>[0], string]> = [
    ['sin contacto guardado', { target: target(), match: { kind: 'none' }, suppression: allowed, tombstonedDedupeKeys: noTombstones }, 'skip_not_saved_in_apollo'],
    ['ambiguo', { target: target(), match: { kind: 'ambiguous', count: 2 }, suppression: allowed, tombstonedDedupeKeys: noTombstones }, 'skip_ambiguous_match'],
    ['conflicto', { target: target(), match: { kind: 'identity_conflict' }, suppression: allowed, tombstonedDedupeKeys: noTombstones }, 'skip_identity_conflict'],
    ['suprimido', { target: target(), match: matched(), suppression: { kind: 'blocked_suppressed' }, tombstonedDedupeKeys: noTombstones }, 'skip_suppressed'],
    ['no verificable', { target: target(), match: matched(), suppression: { kind: 'check_unavailable' }, tombstonedDedupeKeys: noTombstones }, 'skip_suppression_unverifiable'],
    ['sin identidad', { target: target(), match: matched(), suppression: { kind: 'not_evaluable' }, tombstonedDedupeKeys: noTombstones }, 'skip_suppression_unverifiable'],
    ['sin teléfono guardado', { target: target(), match: matchApolloSavedContact(target(), [saved({ phone_numbers: [] })]), suppression: allowed, tombstonedDedupeKeys: noTombstones }, 'skip_saved_without_phone'],
    ['todos no-llamar', { target: target(), match: matchApolloSavedContact(target(), [saved({ phone_numbers: [{ sanitized_number: '+56966666666', dnc_status: 'on_dnc' }] })]), suppression: allowed, tombstonedDedupeKeys: noTombstones }, 'skip_all_numbers_do_not_call'],
  ];
  for (const [name, input, expected] of skipCases) {
    it(`${name} ⇒ ${expected}`, () => {
      assert.equal(decideSavedContactPhoneImport(input).decision, expected);
    });
  }

  it('número borrado antes (tombstone) no se re-escribe; si eran todos ⇒ skip', () => {
    const probe = decideSavedContactPhoneImport({
      target: target(),
      match: matched(),
      suppression: allowed,
      tombstonedDedupeKeys: noTombstones,
    });
    assert.ok(probe.decision === 'would_import');
    const key = probe.decision === 'would_import' ? probe.phones[0].dedupeKey : '';
    const d = decideSavedContactPhoneImport({
      target: target(),
      match: matched(),
      suppression: allowed,
      tombstonedDedupeKeys: new Set([key]),
    });
    assert.equal(d.decision, 'skip_all_numbers_tombstoned');
  });

  it('descarta sólo los números no-llamar y conserva el resto', () => {
    const d = decideSavedContactPhoneImport({
      target: target(),
      match: matchApolloSavedContact(target(), [
        saved({
          phone_numbers: [
            { sanitized_number: '+56977777777', dnc_status: 'on_dnc' },
            { sanitized_number: '+56988888888', type_cd: 'mobile' },
          ],
        }),
      ]),
      suppression: allowed,
      tombstonedDedupeKeys: noTombstones,
    });
    assert.equal(d.decision, 'would_import');
    assert.ok(d.decision === 'would_import' && d.phones.length === 1 && d.droppedDoNotCall === 1);
  });
});

describe('maskPhoneForReport', () => {
  it('nunca deja ver más de los 2 últimos dígitos', () => {
    assert.equal(maskPhoneForReport('+56912345678'), '••••78');
    assert.equal(maskPhoneForReport(null), '—');
  });
});

describe('buildSavedContactImportPayload — lo que reciben las funciones de la 155', () => {
  const allowed = { kind: 'allowed' } as const;

  function importable(phoneNumbers: ApolloSavedContact['phone_numbers'], id: string | null = 'apollo-contact-1') {
    const d = decideSavedContactPhoneImport({
      target: target(),
      match: matchApolloSavedContact(target(), [saved({ id, phone_numbers: phoneNumbers })]),
      suppression: allowed,
      tombstonedDedupeKeys: new Set(),
    });
    assert.equal(d.decision, 'would_import');
    return d as Extract<typeof d, { decision: 'would_import' }>;
  }

  it('procedencia: apollo + reveal + clave apollo_saved_contact:<id>, sin punteros contables', () => {
    const payload = buildSavedContactImportPayload(importable([{ sanitized_number: '+56912345678', type_cd: 'mobile' }]));
    assert.equal(payload.sources.length, 1);
    const [source] = payload.sources;
    assert.equal(source.provider, 'apollo');
    assert.equal(source.acquisition_mode, 'reveal');
    assert.equal(source.source_event_key, 'apollo_saved_contact:apollo-contact-1');
    assert.equal('waterfall_run_id' in source, false);
    assert.equal('reservation_id' in source, false);
  });

  it('sin id del contacto guardado usa el person_id en la clave', () => {
    const payload = buildSavedContactImportPayload(importable([{ sanitized_number: '+56912345678' }], null));
    assert.equal(payload.sources[0].source_event_key, `apollo_saved_contact:person:${PID}`);
  });

  it('el primario va primero y los inválidos no son candidatos a primario', () => {
    const payload = buildSavedContactImportPayload(
      importable([
        { sanitized_number: '+56211111111', type_cd: 'work_hq' },
        { sanitized_number: '+56922222222', type_cd: 'mobile' },
        { sanitized_number: '+56933333333', type_cd: 'mobile', status_cd: 'invalid' },
      ]),
    );
    assert.equal(payload.phones.length, 3);
    assert.equal(payload.primaryCandidates[0].phone, '+56922222222');
    assert.equal(payload.primaryCandidates[0].phone_type, 'mobile');
    assert.ok(payload.primaryCandidates.every((c) => c.phone !== '+56933333333'));
  });

  it('base de tratamiento fija: legitimate_interest_b2b', () => {
    assert.equal(SAVED_CONTACT_PHONE_PROCESSING_BASIS, 'legitimate_interest_b2b');
  });
});
