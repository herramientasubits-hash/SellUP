// AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE — qué pegó el usuario (LinkedIn o correo) y el enlace
// que abre la ficha del candidato en «Por revisar». Puro.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectContactSearchInput } from '../contact-search-input';
import {
  candidateReviewHref,
  readCandidateReviewParam,
  stripCandidateReviewParam,
} from '../candidate-review-link';

const ID = '3f2b8c1e-1a2b-4c3d-9e8f-001122334455';

describe('detectContactSearchInput', () => {
  it('reconoce correos y LinkedIn', () => {
    assert.deepEqual(detectContactSearchInput(' Ana@Empresa.test '), { kind: 'email', email: 'ana@empresa.test' });
    assert.deepEqual(detectContactSearchInput('https://es.linkedin.com/in/ana/'), {
      kind: 'linkedin',
      raw: 'https://es.linkedin.com/in/ana/',
    });
    // Un enlace de empresa también va a LinkedIn: su validación explica qué está mal.
    assert.equal(detectContactSearchInput('linkedin.com/company/x').kind, 'linkedin');
  });

  it('vacío o cualquier otra cosa no se busca', () => {
    assert.equal(detectContactSearchInput('   ').kind, 'empty');
    assert.equal(detectContactSearchInput(undefined).kind, 'empty');
    assert.equal(detectContactSearchInput('Ana Pérez de Ficticia').kind, 'unknown');
    assert.equal(detectContactSearchInput('https://empresa.test').kind, 'unknown');
  });
});

describe('enlace a la ficha del candidato', () => {
  it('se arma sobre la ruta de «Por revisar» y se lee de vuelta', () => {
    const href = candidateReviewHref('/contacts?tab=candidates', ID);
    assert.equal(href, `/contacts?tab=candidates&candidate=${ID}`);
    assert.equal(readCandidateReviewParam(href.slice(href.indexOf('?'))), ID);
    assert.equal(candidateReviewHref('/contacts', ID), `/contacts?candidate=${ID}`);
  });

  it('sólo acepta ids con forma de UUID', () => {
    assert.equal(readCandidateReviewParam('?candidate=../../x'), null);
    assert.equal(readCandidateReviewParam('?tab=candidates'), null);
  });

  it('se quita de la URL sin tocar lo demás', () => {
    assert.equal(stripCandidateReviewParam(`/contacts?tab=candidates&candidate=${ID}`), '/contacts?tab=candidates');
    assert.equal(stripCandidateReviewParam(`/contacts?candidate=${ID}#x`), '/contacts#x');
  });
});
