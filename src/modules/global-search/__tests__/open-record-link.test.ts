/**
 * Desde el buscador, una empresa o un contacto de SellUp se abre en su ficha lateral, no
 * en la página completa (dueña 17-11).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isOnRecordList,
  openRecordHref,
  readOpenRecordParam,
} from '../open-record-link';

const ID = '11111111-2222-3333-4444-555555555555';

describe('enlace a la ficha lateral', () => {
  it('va a la lista con ?abrir=<id>', () => {
    assert.equal(openRecordHref('account', ID), `/accounts?abrir=${ID}`);
    assert.equal(openRecordHref('contact', ID), `/contacts?abrir=${ID}`);
  });

  it('la lista lee el id y deja la dirección sin él; lo que no es un id se ignora', () => {
    assert.deepEqual(readOpenRecordParam(`?abrir=${ID}&vista=lista`), { id: ID, rest: '?vista=lista' });
    assert.deepEqual(readOpenRecordParam(`?abrir=${ID}`), { id: ID, rest: '' });
    assert.equal(readOpenRecordParam('?abrir=<script>').id, null);
    assert.equal(readOpenRecordParam('').id, null);
  });
});

describe('¿ya está en la lista con fichas?', () => {
  it('Empresas y Contactos (sin pestaña o la principal): se avisa a la lista', () => {
    assert.equal(isOnRecordList('http://app/accounts', 'account'), true);
    assert.equal(isOnRecordList('http://app/accounts?tab=empresas&vista=lista', 'account'), true);
    assert.equal(isOnRecordList('http://app/contacts', 'contact'), true);
    assert.equal(isOnRecordList('http://app/contacts?tab=approved', 'contact'), true);
  });

  it('en otra pestaña, en la página de un registro u otra pantalla: se navega', () => {
    assert.equal(isOnRecordList('http://app/accounts?tab=prospectos', 'account'), false);
    assert.equal(isOnRecordList(`http://app/accounts/${ID}`, 'account'), false);
    assert.equal(isOnRecordList('http://app/contacts?tab=candidates', 'contact'), false);
    assert.equal(isOnRecordList('http://app/accounts', 'contact'), false);
    assert.equal(isOnRecordList('http://app/pipeline', 'account'), false);
  });
});
