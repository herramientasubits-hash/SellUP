// «Contactos de otras fuentes» en la ficha de la empresa (Agente 1, Bryan 25-11).
//
// Selección pura (qué candidatos salen, en qué orden) + el cableado: la lectura del servidor, el
// orden de los bloques en la pestaña Contactos (panel y página) y las acciones de cada fila.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ACCOUNT_OTHER_SOURCES_STATUSES,
  classifyAccountOtherSourcesApprove,
  collectMatchedContactIds,
  groupAccountOtherSourceCandidates,
  selectAccountOtherSourceCandidates,
  type AccountOtherSourcesRow,
} from '../account-other-sources-candidates-core';
import { COMPANY_CHANGE_OPEN_METADATA_KEY } from '../official-contact-review-core';
import type { PendingContactCandidate } from '../types';

const ACC = '11111111-1111-4111-8111-111111111111';
const OTHER_ACC = '22222222-2222-4222-8222-222222222222';
const ME = 'user-me';

function candidate(overrides: Partial<PendingContactCandidate>): PendingContactCandidate {
  return {
    id: 'c1',
    full_name: 'Ana',
    title: null,
    email: null,
    linkedin_url: null,
    source_contact_id: null,
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0,
    enrichment_metadata: {},
    enrichment_run_id: null,
    created_at: '2026-11-20T00:00:00Z',
    phone_reveal_status: null,
    company_name: 'Acme',
    company_domain: null,
    account_id: ACC,
    hubspot_company_id: null,
    ...overrides,
  } as PendingContactCandidate;
}

function row(overrides: Partial<PendingContactCandidate>, extra: Partial<AccountOtherSourcesRow> = {}): AccountOtherSourcesRow {
  return {
    candidate: candidate(overrides),
    scopeFacts: { triggered_by: ME, account_owner_id: null, account_created_by: null },
    matchedContactId: null,
    ...extra,
  };
}

const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe('selectAccountOtherSourceCandidates — qué sale en el bloque', () => {
  it('lista por revisar y duplicados; no aprobados ni rechazados', () => {
    const out = selectAccountOtherSourceCandidates(
      [
        row({ id: 'p', status: 'pending_review' }),
        row({ id: 'd', status: 'duplicate' }),
        row({ id: 'a', status: 'approved' }),
        row({ id: 'x', status: 'discarded' }),
      ],
      ACC,
      null,
    );
    assert.deepEqual(ids(out), ['p', 'd']);
    assert.deepEqual([...ACCOUNT_OTHER_SOURCES_STATUSES], ['pending_review', 'duplicate']);
  });

  it('excluye los de fuente HubSpot (tienen su propio bloque) y deja Apollo, Lusha y manual', () => {
    const out = selectAccountOtherSourceCandidates(
      [
        row({ id: 'h', source: 'hubspot' }),
        row({ id: 'ap', source: 'apollo' }),
        row({ id: 'lu', source: 'lusha' }),
        row({ id: 'ma', source: 'manual' }),
      ],
      ACC,
      null,
    );
    assert.deepEqual(ids(out).sort(), ['ap', 'lu', 'ma']);
  });

  it('sólo los de esta empresa: uno reasignado a otra empresa no sale', () => {
    // La server action ya aplicó la reasignación al mapear: `account_id` es la empresa vigente.
    const out = selectAccountOtherSourceCandidates(
      [row({ id: 'mine', account_id: ACC }), row({ id: 'moved', account_id: OTHER_ACC }), row({ id: 'none', account_id: null })],
      ACC,
      null,
    );
    assert.deepEqual(ids(out), ['mine']);
  });

  it('sin repetidos cuando las lecturas por búsqueda y por reasignación se solapan', () => {
    const out = selectAccountOtherSourceCandidates([row({ id: 'same' }), row({ id: 'same' })], ACC, null);
    assert.deepEqual(ids(out), ['same']);
  });

  it('respeta el alcance: lanzó alguien del alcance o la empresa es de alguien del alcance', () => {
    const out = selectAccountOtherSourceCandidates(
      [
        row({ id: 'by-me' }, { scopeFacts: { triggered_by: ME, account_owner_id: null, account_created_by: null } }),
        row({ id: 'my-account' }, { scopeFacts: { triggered_by: 'other', account_owner_id: ME, account_created_by: null } }),
        row({ id: 'foreign' }, { scopeFacts: { triggered_by: 'other', account_owner_id: 'other', account_created_by: null } }),
        row({ id: 'no-facts' }, { scopeFacts: null }),
      ],
      ACC,
      [ME],
    );
    assert.deepEqual(ids(out).sort(), ['by-me', 'my-account']);
  });

  it('sin restricción (admin o bandera apagada) ve todo', () => {
    const out = selectAccountOtherSourceCandidates([row({ id: 'x' }, { scopeFacts: null })], ACC, null);
    assert.deepEqual(ids(out), ['x']);
  });

  it('un cambio de empresa abierto por revisar lo ve cualquiera (misma regla que la ficha)', () => {
    const out = selectAccountOtherSourceCandidates(
      [
        row(
          { id: 'open', enrichment_metadata: { [COMPANY_CHANGE_OPEN_METADATA_KEY]: true } as never },
          { scopeFacts: { triggered_by: 'other', account_owner_id: null, account_created_by: null } },
        ),
      ],
      ACC,
      [ME],
    );
    assert.deepEqual(ids(out), ['open']);
  });

  it('primero «Por revisar» y después «Posibles duplicados»; en cada grupo, el más reciente primero', () => {
    const out = selectAccountOtherSourceCandidates(
      [
        row({ id: 'dup-old', status: 'duplicate', created_at: '2026-11-01T00:00:00Z' }),
        row({ id: 'pend-old', status: 'pending_review', created_at: '2026-11-02T00:00:00Z' }),
        row({ id: 'dup-new', status: 'duplicate', created_at: '2026-11-20T00:00:00Z' }),
        row({ id: 'pend-new', status: 'pending_review', created_at: '2026-11-21T00:00:00Z' }),
      ],
      ACC,
      null,
    );
    assert.deepEqual(ids(out), ['pend-new', 'pend-old', 'dup-new', 'dup-old']);
    const groups = groupAccountOtherSourceCandidates(out);
    assert.deepEqual(ids(groups.pending), ['pend-new', 'pend-old']);
    assert.deepEqual(ids(groups.duplicates), ['dup-new', 'dup-old']);
  });

  it('un duplicado dice con qué contacto coincide; un por revisar no', () => {
    const rows = [
      row({ id: 'd', status: 'duplicate' }, { matchedContactId: 'contact-1' }),
      row({ id: 'p', status: 'pending_review' }, { matchedContactId: 'contact-2' }),
    ];
    assert.deepEqual(collectMatchedContactIds(rows), ['contact-1']);
    const out = selectAccountOtherSourceCandidates(rows, ACC, null, new Map([['contact-1', 'Laura Jauregui']]));
    const dup = out.find((c) => c.id === 'd');
    const pend = out.find((c) => c.id === 'p');
    assert.deepEqual(dup?.matched_contact, { id: 'contact-1', fullName: 'Laura Jauregui' });
    assert.equal(pend?.matched_contact, null);
  });

  it('sin empresa no devuelve nada', () => {
    assert.deepEqual(selectAccountOtherSourceCandidates([row({ id: 'x' })], '  ', null), []);
  });
});

describe('classifyAccountOtherSourcesApprove — «Aprobar» desde la fila (igual que «Traer»)', () => {
  it('aprobado, duplicado, a la ficha o error', () => {
    assert.equal(classifyAccountOtherSourcesApprove({ ok: true }), 'approved');
    assert.equal(classifyAccountOtherSourcesApprove({ ok: false, duplicate: true }), 'duplicate');
    assert.equal(
      classifyAccountOtherSourcesApprove({ ok: false, code: 'IDENTITY_MISMATCH_REQUIRES_REVIEW' }),
      'needs_review',
    );
    assert.equal(
      classifyAccountOtherSourcesApprove({ ok: false, code: 'IDENTITY_OVERRIDE_REASON_REQUIRED' }),
      'needs_review',
    );
    assert.equal(classifyAccountOtherSourcesApprove({ ok: false }), 'failed');
  });
});

// ── Cableado (lectura del código) ───────────────────────────────────────────────

const ROOT = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('cableado de «Contactos de otras fuentes»', () => {
  it('la lectura del servidor: por revisar y duplicados, sin HubSpot, por búsqueda y por reasignación', () => {
    const src = read('src/modules/contact-enrichment/actions.ts');
    const start = src.indexOf('export async function getAccountCandidatesFromOtherSources');
    assert.ok(start > 0, 'existe la acción');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    assert.match(body, /\.in\('status', \[\.\.\.ACCOUNT_OTHER_SOURCES_STATUSES\]\)/);
    assert.match(body, /\.neq\('source', ACCOUNT_OTHER_SOURCES_EXCLUDED_SOURCE\)/);
    assert.match(body, /\.eq\('run\.account_id', trimmedId\)/);
    assert.match(body, /CANDIDATE_COMPANY_REASSIGNMENT_KEY\}->>account_id/);
    assert.match(body, /selectAccountOtherSourceCandidates\(/);
    assert.match(body, /resolveCandidateScopeIds\(\)/);
  });

  it('panel de la empresa: Contactos → Contactos de otras fuentes → Contactos en HubSpot', () => {
    const src = read('src/components/accounts/account-detail-sheet.tsx');
    const contacts = src.indexOf('<ContactsTab');
    const others = src.indexOf('<AccountOtherSourcesContacts');
    // Con contactos en SellUp, HubSpot se pinta al final; sin contactos va PRIMERO
    // (Sportium 25-11, PR #925): el bloque se arma una vez y se pinta en uno de los dos lugares.
    const hubspotAfter = src.indexOf('{!hubspotFirst && hubspotBlock}');
    const hubspotBefore = src.indexOf('{hubspotFirst && hubspotBlock}');
    assert.ok(contacts > 0 && others > contacts && hubspotAfter > others, 'orden de los tres bloques');
    assert.ok(hubspotBefore > 0 && hubspotBefore < contacts, 'sin contactos, HubSpot va primero');
    assert.match(src, /const hubspotFirst = data\.contacts\.length === 0;/);
    assert.match(src, /enabled=\{tab === 'contactos'\}/);
  });

  it('página de la empresa: el bloque va entre los aprobados y los de HubSpot', () => {
    const tab = read('src/components/contacts/account-contacts-tab-client.tsx');
    assert.ok(tab.indexOf('<ContactsTab') < tab.indexOf('<AccountOtherSourcesContacts'));
    const page = read('src/app/(sellup)/accounts/[accountId]/page.tsx');
    // Con contactos en SellUp, HubSpot va después; sin contactos va primero (PR #925).
    const list = page.indexOf('<AccountContactsTabClient');
    assert.ok(list < page.indexOf('hubspotCompanyId && contacts.length > 0'));
    assert.ok(page.indexOf('hubspotCompanyId && contacts.length === 0') < list);
    assert.match(page, /archived=\{isArchived\}/);
  });

  it('las acciones de la fila usan las mismas del Agente 2A', () => {
    const ui = read('src/components/accounts/account-other-sources-contacts-section.tsx');
    for (const action of [
      'approveContactCandidate(',
      'discardContactCandidate(',
      'getDuplicateCandidateMergeOffer(',
      'mergeContactCandidateIntoExistingContactAction(',
    ]) {
      assert.ok(ui.includes(action), action);
    }
    // Vacío visible (Bryan 25-11) y sin acciones en una empresa archivada.
    assert.match(ui, /emptyTitle: 'No hay contactos por revisar'/);
    assert.match(ui, /archived \? undefined :/);
  });
});
