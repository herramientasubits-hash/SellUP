/**
 * Hipótesis de consulta y registro de organizaciones vistas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 3, § 4 y § 8.
 *
 * Offline: puro, sin proveedor y sin entorno.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRound1Hypothesis,
  buildRound2Hypothesis,
  resolveSectorSignalSet,
  isContradictoryIndustry,
} from '../query-hypothesis';
import {
  createSeenOrganizationRegistry,
  evaluateSeenOrganization,
  registerSeenOrganization,
  normalizeOrganizationDomain,
  normalizeLinkedInCompanyUrl,
  normalizeCanonicalCompanyName,
} from '../seen-registry';
import { APOLLO_ORGANIZATIONS_ALLOWED_PARAMS } from '../../apollo-organizations-request-contract';
import { testQueryContext } from './fixtures';

// ─── § 3: ronda 1 estricta ────────────────────────────────────────────────────

describe('§ 3 · ronda 1 estricta', () => {
  test('la consulta NO depende de la palabra suelta "retail"', () => {
    const hypothesis = buildRound1Hypothesis(testQueryContext(), 5);

    const tags = hypothesis.queryParameters.keywordTags.map((t) => t.toLowerCase());
    assert.ok(!tags.includes('retail'), `"retail" suelto no debe viajar: ${tags.join(', ')}`);
  });

  test('construye señales específicas del catálogo sectorial', () => {
    const hypothesis = buildRound1Hypothesis(testQueryContext(), 5);
    const tags = hypothesis.queryParameters.keywordTags.map((t) => t.toLowerCase());

    for (const expected of ['supermercado', 'hipermercado', 'grocery']) {
      assert.ok(tags.includes(expected), `falta la señal "${expected}"`);
    }
  });

  test('las señales contradictorias se aplican localmente, no viajan al proveedor', () => {
    const hypothesis = buildRound1Hypothesis(testQueryContext(), 5);

    for (const term of ['retail banking', 'financial services', 'software', 'consulting']) {
      assert.ok(
        hypothesis.locallyExcludedTerms.includes(term),
        `falta la exclusión local "${term}"`,
      );
      assert.ok(
        !hypothesis.queryParameters.keywordTags.includes(term),
        `"${term}" no debe enviarse a Apollo`,
      );
    }
  });

  test('sólo emite parámetros del allowlist del contrato — sin SIC/NAICS', () => {
    const hypothesis = buildRound1Hypothesis(testQueryContext(), 5);
    const emitted = Object.keys(
      (
        JSON.parse(
          JSON.stringify({
            organization_locations: hypothesis.queryParameters.locations,
            q_organization_keyword_tags: hypothesis.queryParameters.keywordTags,
            organization_num_employees_ranges: hypothesis.queryParameters.employeeRanges,
          }),
        ) as Record<string, unknown>
      ),
    );

    for (const param of emitted) {
      assert.ok(
        (APOLLO_ORGANIZATIONS_ALLOWED_PARAMS as readonly string[]).includes(param),
        `"${param}" no está en el allowlist del contrato`,
      );
    }
  });

  test('la subindustria manda sobre el sector cuando ambas están mapeadas', () => {
    const resolved = resolveSectorSignalSet('Retail y Consumo', 'Supermercados e Hipermercados');
    assert.equal(resolved?.usedSubindustry, true);
    assert.equal(resolved?.matchedKey, 'supermercados e hipermercados');
  });

  test('un sector sin catálogo se declara, no se inventa', () => {
    const hypothesis = buildRound1Hypothesis(
      testQueryContext({ sector: 'Sector Inexistente', subindustries: [] }),
      5,
    );
    assert.equal(hypothesis.sectorSignalsMissing, true);
    assert.deepEqual(hypothesis.queryParameters.keywordTags, []);
  });
});

// ─── § 8: ronda 2 adaptativa ──────────────────────────────────────────────────

describe('§ 8 · ronda 2 adaptativa', () => {
  const feedback = {
    remainingTarget: 2,
    excludedSeenOrganizationCount: 3,
    observedRejectionReasons: ['sector_evidence_contradictory'],
  };

  test('no repite exactamente la consulta de la ronda 1', () => {
    const round1 = buildRound1Hypothesis(testQueryContext(), 5);
    const round2 = buildRound2Hypothesis(testQueryContext(), feedback, 5);

    assert.equal(round2.differsFromRound1, true);
    assert.notDeepEqual(round2.queryParameters.keywordTags, round1.queryParameters.keywordTags);
  });

  test('usa sinónimos controlados del catálogo', () => {
    const round2 = buildRound2Hypothesis(testQueryContext(), feedback, 5);
    const tags = round2.queryParameters.keywordTags.map((t) => t.toLowerCase());

    assert.ok(tags.some((t) => ['grocery chain', 'supermarket chain', 'food retailer'].includes(t)));
  });

  test('registra por qué se adaptó', () => {
    const round2 = buildRound2Hypothesis(testQueryContext(), feedback, 5);

    assert.ok(round2.queryAdaptationReason?.includes('sinonimos_controlados'));
    assert.ok(round2.queryAdaptationReason?.includes('excluye_organizaciones_vistas'));
    assert.ok(round2.queryAdaptationReason?.includes('motivos_de_descarte_ronda_1'));
  });

  test('los términos negativos de falsos positivos se excluyen localmente', () => {
    const round2 = buildRound2Hypothesis(
      testQueryContext(),
      { ...feedback, falsePositiveTerms: ['banca de consumo'] },
      5,
    );

    assert.ok(round2.locallyExcludedTerms.includes('banca de consumo'));
    assert.ok(!round2.queryParameters.keywordTags.includes('banca de consumo'));
  });

  test('pide el límite configurado aunque falten menos de cinco', () => {
    const round2 = buildRound2Hypothesis(
      testQueryContext(),
      { ...feedback, remainingTarget: 1 },
      5,
    );
    assert.equal(round2.requestedResultLimit, 5);
  });

  test('sin sinónimos ni regiones se declara idéntica y no justifica una segunda búsqueda', () => {
    const context = testQueryContext({
      sector: 'Sector Inexistente',
      subindustries: [],
      targetLocations: [],
    });
    const round2 = buildRound2Hypothesis(context, feedback, 5);

    assert.equal(round2.differsFromRound1, false);
  });
});

// ─── § 5: contradicción por industria declarada ──────────────────────────────

describe('§ 5 · contradicción leída sólo en la industria declarada', () => {
  const signals = resolveSectorSignalSet('Retail y Consumo', 'Supermercados e Hipermercados');

  test('"retail banking" contradice', () => {
    assert.ok(signals);
    const verdict = isContradictoryIndustry('Retail Banking', signals.signals);
    assert.equal(verdict.contradictory, true);
    assert.equal(verdict.matchedTerm, 'retail banking');
  });

  test('"retail" a secas no contradice', () => {
    assert.ok(signals);
    assert.equal(isContradictoryIndustry('Retail', signals.signals).contradictory, false);
  });

  test('una industria ausente no contradice', () => {
    assert.ok(signals);
    assert.equal(isContradictoryIndustry(null, signals.signals).contradictory, false);
    assert.equal(isContradictoryIndustry('   ', signals.signals).contradictory, false);
  });
});

// ─── § 4: registro de vistas ──────────────────────────────────────────────────

describe('§ 4 · registro de organizaciones vistas', () => {
  test('normaliza dominios a su forma registrable', () => {
    assert.equal(normalizeOrganizationDomain('https://www.Grupoexito.com.co/tiendas'), 'grupoexito.com.co');
    assert.equal(normalizeOrganizationDomain('WWW.CITI.COM'), 'citi.com');
    assert.equal(normalizeOrganizationDomain('  '), null);
    assert.equal(normalizeOrganizationDomain('sin-punto'), null);
  });

  test('normaliza URLs de LinkedIn a su slug canónico', () => {
    assert.equal(
      normalizeLinkedInCompanyUrl('https://www.linkedin.com/company/grupo-exito/about/?trk=x'),
      'linkedin.com/company/grupo-exito',
    );
    assert.equal(
      normalizeLinkedInCompanyUrl('linkedin.com/company/grupo-exito'),
      'linkedin.com/company/grupo-exito',
    );
    assert.equal(normalizeLinkedInCompanyUrl('https://example.com/company/x'), null);
  });

  test('el nombre canónico ignora forma jurídica y orden', () => {
    assert.equal(
      normalizeCanonicalCompanyName('Almacenes Éxito S.A.'),
      normalizeCanonicalCompanyName('Exito, Almacenes SA'),
    );
    assert.equal(normalizeCanonicalCompanyName('Grupo S.A.'), null);
  });

  test('cualquiera de las cuatro identidades reconoce a una organización ya vista', () => {
    let registry = createSeenOrganizationRegistry();
    const first = evaluateSeenOrganization(registry, {
      providerOrganizationId: 'org-1',
      domain: 'grupoexito.com.co',
      linkedinUrl: 'https://www.linkedin.com/company/grupo-exito',
      name: 'Almacenes Éxito S.A.',
    });
    registry = registerSeenOrganization(registry, first.identity);

    // Por id, aunque el resto cambie.
    assert.equal(
      evaluateSeenOrganization(registry, { providerOrganizationId: 'org-1', domain: 'otro.com' })
        .seen,
      true,
    );
    // Por dominio, aunque el id cambie.
    const byDomain = evaluateSeenOrganization(registry, {
      providerOrganizationId: 'org-9',
      domain: 'https://www.grupoexito.com.co/',
    });
    assert.equal(byDomain.seen, true);
    assert.equal(byDomain.seen === true ? byDomain.matchReason : null, 'normalized_domain');
    // Por LinkedIn.
    assert.equal(
      evaluateSeenOrganization(registry, {
        providerOrganizationId: 'org-9',
        linkedinUrl: 'linkedin.com/company/grupo-exito/',
      }).seen,
      true,
    );
  });

  test('el nombre canónico SOLO cuenta acompañado de un dominio ya conocido', () => {
    let registry = createSeenOrganizationRegistry();
    registry = registerSeenOrganization(
      registry,
      evaluateSeenOrganization(registry, {
        providerOrganizationId: 'org-1',
        domain: 'exito-uno.com',
        name: 'Comercial Exito',
      }).identity,
    );

    // Homónimo con dominio propio: NO es la misma empresa.
    const homonym = evaluateSeenOrganization(registry, {
      providerOrganizationId: 'org-2',
      domain: 'exito-dos.com',
      name: 'Comercial Exito',
    });
    assert.equal(homonym.seen, false);
  });

  test('registrar no muta el registro recibido', () => {
    const registry = createSeenOrganizationRegistry();
    const verdict = evaluateSeenOrganization(registry, {
      providerOrganizationId: 'org-1',
      domain: 'a.com',
    });
    const next = registerSeenOrganization(registry, verdict.identity);

    assert.equal(registry.providerOrganizationIds.size, 0);
    assert.equal(next.providerOrganizationIds.size, 1);
  });
});
