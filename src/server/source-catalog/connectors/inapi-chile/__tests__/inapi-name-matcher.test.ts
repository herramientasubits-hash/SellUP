import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  removeCompanySuffix,
  parseApplicant,
} from '../normalizers';
import {
  matchByName,
  computeTokenSimilarity,
  isStrongMatch,
  isWeakMatch,
  tokenize,
} from '../name-matcher';

describe('normalizeName', () => {
  it('lowercases and strips accents', () => {
    assert.equal(normalizeName('Banco de Chile'), 'banco de chile');
  });

  it('removes tildes', () => {
    assert.equal(normalizeName('Falabella S.A.'), 'falabella s a');
  });

  it('handles mixed accents', () => {
    assert.equal(normalizeName('FERRETERÍA EL CÓNDOR'), 'ferreteria el condor');
  });

  it('removes punctuation', () => {
    assert.equal(normalizeName('SODIMAC S.A.'), 'sodimac s a');
  });

  it('trims extra spaces', () => {
    assert.equal(normalizeName('  Banco   de   Chile  '), 'banco de chile');
  });

  it('handles ñ correctly', () => {
    assert.equal(normalizeName('MUÑOZ'), 'munoz');
  });

  it('returns empty string for empty input', () => {
    assert.equal(normalizeName(''), '');
  });
});

describe('removeCompanySuffix', () => {
  it('removes SPA', () => {
    assert.equal(removeCompanySuffix('INVERSIONES ABC SPA'), 'inversiones abc');
  });

  it('removes S.A.', () => {
    assert.equal(removeCompanySuffix('BANCO DE CHILE S.A.'), 'banco de chile');
  });

  it('removes SA', () => {
    assert.equal(removeCompanySuffix('CENCOSUD SA'), 'cencosud');
  });

  it('removes LTDA', () => {
    assert.equal(removeCompanySuffix('COMERCIAL XYZ LTDA'), 'comercial xyz');
  });

  it('removes Limitada', () => {
    assert.equal(removeCompanySuffix('DISTRIBUIDORA ABC LIMITADA'), 'distribuidora abc');
  });

  it('removes EIRL', () => {
    assert.equal(removeCompanySuffix('SERVICIOS PROFESIONALES EIRL'), 'servicios profesionales');
  });

  it('removes S.R.L.', () => {
    assert.equal(removeCompanySuffix('TRANSPORTES RAPIDO S.R.L.'), 'transportes rapido');
  });

  it('handles Sociedad Anonima', () => {
    assert.equal(removeCompanySuffix('EMPRESA NACIONAL SOCIEDAD ANONIMA'), 'empresa nacional');
  });

  it('handles Sociedad por Acciones', () => {
    assert.equal(removeCompanySuffix('NUEVA EMPRESA SOCIEDAD POR ACCIONES'), 'nueva empresa');
  });

  it('removes E.I.R.L.', () => {
    assert.equal(removeCompanySuffix('CONSULTORA ABC E.I.R.L.'), 'consultora abc');
  });

  it('removes spaced suffix (s a after punctuation removal)', () => {
    assert.equal(removeCompanySuffix('falabella s a'), 'falabella');
  });

  it('does not change name without suffix', () => {
    assert.equal(removeCompanySuffix('BANCO DE CHILE'), 'banco de chile');
  });
});

describe('parseApplicant', () => {
  it('parses (CL) applicant', () => {
    const result = parseApplicant('(CL) Banco de Chile');
    assert.equal(result?.countryCode, 'CL');
    assert.equal(result?.applicantName, 'Banco de Chile');
  });

  it('parses foreign applicant', () => {
    const result = parseApplicant('(DE) Siemens AG');
    assert.equal(result?.countryCode, 'DE');
    assert.equal(result?.applicantName, 'Siemens AG');
  });

  it('returns null for empty input', () => {
    assert.equal(parseApplicant(''), null);
  });

  it('returns null for non-string input', () => {
    assert.equal(parseApplicant(null), null);
  });

  it('handles applicant with multiple words and special chars', () => {
    const result = parseApplicant('(CL) Falabella S.A.');
    assert.equal(result?.countryCode, 'CL');
    assert.equal(result?.applicantName, 'Falabella S.A.');
  });

  it('handles applicant without country prefix', () => {
    const result = parseApplicant('EMPRESA SIN CODIGO DE PAIS');
    assert.equal(result?.countryCode, null);
    assert.equal(result?.applicantName, 'EMPRESA SIN CODIGO DE PAIS');
  });
});

describe('matchByName — exact match', () => {
  it('matches identical names after normalization', () => {
    const result = matchByName('Banco de Chile', 'Banco de Chile');
    assert.equal(result.matchMethod, 'exact_normalized');
    assert.equal(result.confidenceScore, 0.95);
  });

  it('matches ignoring company suffix', () => {
    const result = matchByName('Falabella', 'Falabella S.A.');
    assert.equal(result.matchMethod, 'exact_normalized');
    assert.equal(result.confidenceScore, 0.95);
  });

  it('matches with different casing and suffix variation', () => {
    const result = matchByName('cencosud sa', 'CENCOSUD');
    assert.equal(result.matchMethod, 'exact_normalized');
    assert.equal(result.confidenceScore, 0.95);
  });

  it('matches with accents normalized and suffix', () => {
    const result = matchByName('Cencosud', 'Cencosud S.A.');
    assert.equal(result.matchMethod, 'exact_normalized');
    assert.equal(result.confidenceScore, 0.95);
  });

  it('matches company name against applicant with suffix', () => {
    const result = matchByName('Banco de Chile', 'Banco de Chile S.A.');
    assert.equal(result.matchMethod, 'exact_normalized');
    assert.equal(result.confidenceScore, 0.95);
  });
});

describe('matchByName — contains match', () => {
  it('matches when one name contains the other with sufficient length ratio', () => {
    const result = matchByName('Inversiones Santa Maria', 'Inversiones Santa Maria Del Valle');
    assert.equal(result.matchMethod, 'contains_normalized');
    assert.equal(result.confidenceScore, 0.80);
  });

  it('matches when company name extends applicant', () => {
    const result = matchByName('Servicios Generales Del Norte', 'Servicios Generales');
    assert.equal(result.matchMethod, 'contains_normalized');
    assert.equal(result.confidenceScore, 0.80);
  });
});

describe('matchByName — token similarity', () => {
  it('returns token_similarity with 0.55 for partial overlap (Empresas Cencosud / Cencosud)', () => {
    const result = matchByName('Empresas Cencosud', 'Cencosud S.A.');
    assert.equal(result.matchMethod, 'token_similarity');
    assert.equal(result.confidenceScore, 0.55);
  });

  it('returns token_similarity with 0.55 for medium similarity', () => {
    const result = matchByName('Comercial Perez', 'Perez y Cia Ltda');
    assert.equal(result.matchMethod, 'token_similarity');
    assert.equal(result.confidenceScore, 0.55);
  });

  it('confidence stays within token_similarity bounds', () => {
    const result = matchByName('Servicios Generales', 'Servicios Generales Del Norte');
    assert.ok(result.confidenceScore >= 0.80);
  });
});

describe('matchByName — no match', () => {
  it('returns no_match for completely different names', () => {
    const result = matchByName('Banco de Chile', 'Farmacias Ahumada');
    assert.equal(result.matchMethod, 'no_match');
    assert.equal(result.confidenceScore, 0);
  });

  it('returns no_match for empty applicant', () => {
    const result = matchByName('Banco de Chile', '');
    assert.equal(result.matchMethod, 'no_match');
    assert.equal(result.confidenceScore, 0);
  });

  it('returns no_match for applicant without meaningful overlap', () => {
    const result = matchByName('Not Company Fake XYZ', 'Comercial Perez Limitada');
    assert.equal(result.matchMethod, 'no_match');
    assert.equal(result.confidenceScore, 0);
  });
});

describe('matchByName — international applicant', () => {
  it('matches foreign applicant with same name', () => {
    const result = matchByName('Falabella', 'Falabella');
    assert.equal(result.matchMethod, 'exact_normalized');
    assert.equal(result.confidenceScore, 0.95);
  });
});

describe('isStrongMatch / isWeakMatch', () => {
  it('confidence 0.95 is strong', () => {
    assert.equal(isStrongMatch(0.95), true);
    assert.equal(isWeakMatch(0.95), false);
  });

  it('confidence 0.80 is strong (boundary)', () => {
    assert.equal(isStrongMatch(0.80), true);
  });

  it('confidence 0.79 is weak', () => {
    assert.equal(isStrongMatch(0.79), false);
    assert.equal(isWeakMatch(0.79), true);
  });

  it('confidence 0.70 is weak', () => {
    assert.equal(isStrongMatch(0.70), false);
    assert.equal(isWeakMatch(0.70), true);
  });

  it('confidence 0.55 is weak', () => {
    assert.equal(isStrongMatch(0.55), false);
    assert.equal(isWeakMatch(0.55), true);
  });

  it('confidence 0 is not strong nor weak', () => {
    assert.equal(isStrongMatch(0), false);
    assert.equal(isWeakMatch(0), false);
  });
});

describe('computeTokenSimilarity', () => {
  it('identical token sets return 1', () => {
    assert.equal(computeTokenSimilarity(['banco', 'chile'], ['banco', 'chile']), 1);
  });

  it('disjoint sets return 0', () => {
    assert.equal(computeTokenSimilarity(['banco'], ['farmacia']), 0);
  });

  it('partial overlap returns fraction', () => {
    const result = computeTokenSimilarity(['banco', 'chile', 'santiago'], ['banco', 'chile']);
    assert.equal(result, 2 / 3);
  });

  it('empty sets return 0', () => {
    assert.equal(computeTokenSimilarity([], []), 0);
  });
});

describe('tokenize', () => {
  it('splits on whitespace', () => {
    assert.deepEqual(tokenize('banco de chile'), ['banco', 'de', 'chile']);
  });

  it('filters single-character tokens', () => {
    assert.deepEqual(tokenize('a b c'), []);
  });

  it('filters numeric-only tokens', () => {
    assert.deepEqual(tokenize('empresa 123'), ['empresa']);
  });
});
