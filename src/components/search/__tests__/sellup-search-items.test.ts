/**
 * Búsqueda en todo SellUp (dueña 17-11): cada cosa encontrada va a su grupo y lleva a su
 * lista, abriendo la ficha cuando se puede.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SELLUP_RECORD_GROUPS, isSameListView, sellUpRecordTarget, sellUpSearchItems } from '../sellup-search-items';
import { normalizeRecordsQuery, foldedIncludes } from '@/modules/global-search/types';
import {
  CANDIDATE_REVIEW_OPEN_EVENT,
  PROSPECT_CANDIDATE_OPEN_EVENT,
} from '@/modules/contact-enrichment/candidate-review-link';
import type { SellUpRecordHit } from '@/modules/global-search/types';

const ID = '11111111-2222-3333-4444-555555555555';

describe('a dónde lleva', () => {
  it('una empresa por revisar: su lista filtrada por el nombre y su ficha abierta', () => {
    const target = sellUpRecordTarget({ kind: 'prospect', id: ID, title: 'FNL Laboratory', meta: [], keywords: [] });
    const url = new URL(target.href, 'http://x');
    assert.equal(url.pathname, '/accounts');
    assert.equal(url.searchParams.get('tab'), 'prospectos');
    assert.equal(url.searchParams.get('search'), 'FNL Laboratory');
    assert.equal(url.searchParams.get('candidate'), ID);
    assert.deepEqual(target.event, { type: PROSPECT_CANDIDATE_OPEN_EVENT, candidateId: ID });
  });

  it('una descartada: Descartadas filtrada por el nombre', () => {
    const url = new URL(sellUpRecordTarget({ kind: 'discarded_company', id: `candidate:${ID}`, title: 'Acme & Co', meta: [], keywords: [] }).href, 'http://x');
    assert.equal(url.searchParams.get('view'), 'descartadas');
    assert.equal(url.searchParams.get('search'), 'Acme & Co');
  });

  it('una búsqueda: Búsquedas con esa búsqueda enfocada', () => {
    assert.equal(sellUpRecordTarget({ kind: 'search', id: ID, title: 'Retail CO', meta: [], keywords: [] }).href, `/accounts?tab=busquedas&focus=${ID}`);
  });

  it('un candidato de contacto: su cola, y la ficha salvo si está rechazado', () => {
    const base = { kind: 'contact_candidate' as const, id: ID, title: 'Stephanie Lopez', meta: [], keywords: [] };
    const pending = sellUpRecordTarget({ ...base, queue: 'pending_review' });
    assert.equal(pending.href, `/contacts?tab=candidates&candidate=${ID}`);
    assert.deepEqual(pending.event, { type: CANDIDATE_REVIEW_OPEN_EVENT, candidateId: ID, queue: 'pending_review' });
    assert.equal(sellUpRecordTarget({ ...base, queue: 'duplicate' }).href, `/contacts?tab=duplicates&candidate=${ID}`);
    const rejected = sellUpRecordTarget({ ...base, queue: 'discarded' });
    assert.equal(rejected.href, '/contacts?tab=rejected');
    assert.equal(rejected.event, undefined);
  });
});

describe('en el buscador', () => {
  it('cada uno a su grupo, con id propio y abriéndose con su aviso', () => {
    const opened: Array<[string, unknown]> = [];
    const hits: SellUpRecordHit[] = [
      { kind: 'prospect', id: ID, title: 'FNL Laboratory', meta: ['Chile'], keywords: ['fnl.cl'] },
      { kind: 'contact_candidate', id: ID, title: 'Stephanie Lopez', meta: [], keywords: [], queue: 'duplicate' },
    ];
    const items = sellUpSearchItems(hits, (href, event) => opened.push([href, event]));
    assert.deepEqual(items.map((i) => i.group), [SELLUP_RECORD_GROUPS.prospect, SELLUP_RECORD_GROUPS.duplicate]);
    assert.notEqual(items[0].id, items[1].id);
    assert.deepEqual(items[0].keywords, ['fnl.cl']);
    items[0].onSelect?.();
    assert.equal(opened.length, 1);
    assert.match(opened[0][0], /candidate=/);
  });
});

describe('lo escrito', () => {
  it('sin comodines ni caracteres que rompan el filtro; 3 letras como mínimo', () => {
    assert.equal(normalizeRecordsQuery('fn'), null);
    assert.equal(normalizeRecordsQuery(12), null);
    assert.equal(normalizeRecordsQuery('  fnl%_lab,(x)  '), 'fnl lab x');
    assert.equal(normalizeRecordsQuery('a'.repeat(300))?.length, 120);
  });

  it('coincide sin tildes ni mayúsculas', () => {
    assert.equal(foldedIncludes('Búsqueda Logística', 'logistica'), true);
    assert.equal(foldedIncludes(null, 'x'), false);
  });
});

describe('¿ya está en esa lista?', () => {
  it('misma ruta, pestaña y vista: se avisa a la pantalla montada', () => {
    assert.equal(isSameListView('http://app/accounts?tab=prospectos&search=x', '/accounts?tab=prospectos&search=FNL&candidate=1'), true);
    assert.equal(isSameListView('http://app/contacts?tab=duplicates', '/contacts?tab=duplicates&candidate=1'), true);
  });

  it('otra pestaña o vista (otra cola): no, se monta la suya', () => {
    assert.equal(isSameListView('http://app/contacts?tab=candidates', '/contacts?tab=duplicates&candidate=1'), false);
    assert.equal(isSameListView('http://app/accounts?tab=prospectos&view=descartadas', '/accounts?tab=prospectos&candidate=1'), false);
    assert.equal(isSameListView('http://app/accounts', '/accounts?tab=prospectos'), false);
    assert.equal(isSameListView('http://app/pipeline', '/accounts?tab=prospectos'), false);
  });
});
