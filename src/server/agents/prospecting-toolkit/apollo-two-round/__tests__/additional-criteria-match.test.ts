/**
 * AGENT1-CRITERIA-QUICK-WINS-2 § 1 — el criterio libre del vendedor prioriza en
 * Apollo (enriquecimiento y orden de entrega) sin descartar a nadie.
 * Sin Supabase real. Sin proveedores.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { matchAdditionalCriteria, orderByAdditionalCriteriaMatch } from '../additional-criteria-match';
import { scoreCandidateForEnrichment, type FreeCandidateSignals } from '../enrichment-ranking';

describe('matchAdditionalCriteria', () => {
  it('coincide sin acentos ni mayúsculas, y por prefijo de palabra', () => {
    assert.deepEqual(matchAdditionalCriteria(['hospital', 'clinica'], ['Red de Hospitales y Clínicas']), ['hospital', 'clinica']);
  });

  it('un token corto exige palabra completa', () => {
    assert.deepEqual(matchAdditionalCriteria(['ti'], ['Tiendas del Norte']), []);
    assert.deepEqual(matchAdditionalCriteria(['ti'], ['Servicios de TI gestionados']), ['ti']);
    assert.deepEqual(matchAdditionalCriteria(['erp'], ['Implementación ERP/SAP']), ['erp']);
  });

  it('sin tokens o sin texto no hay coincidencias', () => {
    assert.deepEqual(matchAdditionalCriteria([], ['algo']), []);
    assert.deepEqual(matchAdditionalCriteria(['sap'], [null, undefined, '  ']), []);
  });

  it('no cuenta dos veces el mismo token', () => {
    assert.deepEqual(matchAdditionalCriteria(['sap', 'SAP'], ['usa SAP y SAP HANA']), ['sap']);
  });
});

describe('orderByAdditionalCriteriaMatch', () => {
  const items = [
    { id: 'a', text: 'Logística general' },
    { id: 'b', text: 'Hospitales privados con SAP' },
    { id: 'c', text: 'Clínica que usa SAP' },
    { id: 'd', text: 'Transporte' },
  ];
  const textsOf = (item: { text: string }) => [item.text];

  it('sin criterio devuelve el mismo orden', () => {
    assert.deepEqual(orderByAdditionalCriteriaMatch(items, [], textsOf).map((i) => i.id), ['a', 'b', 'c', 'd']);
  });

  it('más coincidencias primero; el empate conserva el orden original', () => {
    assert.deepEqual(
      orderByAdditionalCriteriaMatch(items, ['hospital', 'sap'], textsOf).map((i) => i.id),
      ['b', 'c', 'a', 'd'],
    );
  });

  it('no descarta a nadie', () => {
    assert.equal(orderByAdditionalCriteriaMatch(items, ['inexistente'], textsOf).length, items.length);
  });
});

describe('ranking de enriquecimiento', () => {
  const base: FreeCandidateSignals = {
    candidateKey: 'k',
    roundNumber: 1,
    providerRank: 1,
    countryCompatible: true,
    domainConfident: true,
    ownershipConfident: true,
    sectorKeywordMatchCount: 0,
    novel: true,
    hasCompanySizeSignal: false,
    hasLocationSignal: false,
    hasLinkedInUrl: false,
    freeOfContradictoryEvidence: true,
    sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
    knownDuplicate: false,
    cooldownActive: false,
  };

  it('sin la señal (checkpoint viejo) el puntaje es el de siempre', () => {
    const before = scoreCandidateForEnrichment(base);
    const zero = scoreCandidateForEnrichment({ ...base, additionalCriteriaMatchCount: 0 });
    assert.equal(zero.score, before.score);
    assert.ok(!zero.contributingSignals.includes('additional_criteria_match'));
  });

  it('coincidir con el criterio sube el puntaje, con tope', () => {
    const before = scoreCandidateForEnrichment(base).score;
    assert.equal(scoreCandidateForEnrichment({ ...base, additionalCriteriaMatchCount: 1 }).score, before + 6);
    assert.equal(scoreCandidateForEnrichment({ ...base, additionalCriteriaMatchCount: 5 }).score, before + 12);
  });

  it('el criterio no compensa un país incompatible', () => {
    const viable = scoreCandidateForEnrichment(base).score;
    const foreign = scoreCandidateForEnrichment({ ...base, countryCompatible: false, additionalCriteriaMatchCount: 5 }).score;
    assert.ok(foreign < viable);
  });
});

describe('cableado en el runner de dos rondas (estático)', () => {
  const src = readFileSync(
    path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts'),
    'utf8',
  );
  it('el criterio se parsea, entra a las señales y ordena lo persistible', () => {
    assert.match(src, /parseAdditionalCriteriaTokens\(input\.additionalCriteria\)/);
    assert.match(src, /additionalCriteriaMatchCount: matchAdditionalCriteria\(/);
    assert.match(src, /orderByAdditionalCriteriaMatch\(\s*await resolvePersistableCandidates\(\)/);
  });
});
