/**
 * AGENT1-COUNTRY-EVIDENCE-MULTICOUNTRY-1 — la evidencia de país deja de ser
 * «ausente» por definición fuera de Colombia y Argentina.
 *
 * El defecto, medido en Producción el 2026-09-29 (México × Tecnología, lote
 * `41977202`): `evaluateCountryEvidence` sólo implementaba CO y AR, así que las
 * 282 organizaciones de Apollo —109 de ellas con dominio `.mx`— salieron con
 * `evidence_policy:country_evidence_absent_survives_incomplete`: ninguna contaba
 * hacia el objetivo ni autorizaba gasto. La corrida no podía aceptar a nadie.
 *
 *   § 1 · las 282 reales: el gate previo al writer ya no las bloquea a todas;
 *   § 2 · cada país del mago tiene URL, texto y consulta;
 *   § 3 · límites de palabra y homónimos: la evidencia no se fabrica;
 *   § 4 · Colombia y Argentina no cambian;
 *   § 5 · la tabla cubre exactamente los países de la regla de dominios;
 *   § 6 · la política de persistencia lee el nuevo resultado como siempre.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateApolloPreWriterQualityGate } from '../apollo-pre-writer-target-conditions';
import { COUNTRY_DOMAIN_RULES } from '../country-compatibility';
import { evaluateCountryEvidence } from '../country-evidence-gate';
import { COUNTRY_EVIDENCE_SIGNALS } from '../country-evidence-multicountry';
import { computeEvidencePersistencePolicy } from '../evidence-persistence-policy';
import { normalizeDomain } from '../normalization';
import { APOLLO_MX_TECHNOLOGY_2026_09_29 as MX_ROWS } from './fixtures/apollo-mx-technology-2026-09-29';

const apolloSnippet = (title: string) => `Empresa: ${title} | [Fuente: Apollo Organizations]`;

function evidence(
  targetCountryCode: string,
  overrides: Partial<{
    website: string | null;
    domain: string | null;
    sourceSnippet: string | null;
    sourceTitle: string | null;
    queryText: string | null;
  }> = {},
) {
  return evaluateCountryEvidence({
    website: null,
    domain: null,
    sourceSnippet: null,
    sourceTitle: null,
    queryText: null,
    targetCountryCode,
    ...overrides,
  });
}

// ─── § 1 ──────────────────────────────────────────────────────────────────────

describe('§ 1 — las 282 organizaciones reales de México × Tecnología', () => {
  const results = MX_ROWS.map(([website, title, rejectionReason]) => {
    const domain = website ? normalizeDomain(website) : null;
    const gate = evaluateApolloPreWriterQualityGate({
      name: title,
      website,
      domain,
      sourceSnippet: apolloSnippet(title),
      sourceTitle: title,
      queryText: null,
      targetCountryCode: 'MX',
      subindustries: [],
      additionalCriteria: null,
      candidate: {},
    });
    return { website, domain, rejectionReason, gate };
  });
  const free = results.filter((r) => r.rejectionReason === null);

  it('el fixture es el lote completo: 282 filas, 166 sin otro rechazo', () => {
    assert.equal(results.length, 282);
    assert.equal(free.length, 166);
  });

  it('🔴 antes 0 de 166 pasaban el gate; ahora pasan 114', () => {
    const passing = free.filter((r) => r.gate.verdict === 'pass');
    assert.equal(passing.length, 114);
  });

  it('🔴 TODA organización con dominio mexicano pasa el eje país', () => {
    const mexicanDomains = results.filter((r) => r.domain?.endsWith('.mx'));
    assert.ok(mexicanDomains.length >= 109);
    for (const r of mexicanDomains) {
      assert.notEqual(
        r.gate.blockingReason,
        'evidence_policy:country_evidence_absent_survives_incomplete',
        `${r.domain} tiene TLD mexicano`,
      );
    }
  });

  it('las 52 que siguen «ausentes» no tienen ni dominio ni mención de México', () => {
    const stillAbsent = free.filter(
      (r) => r.gate.blockingReason === 'evidence_policy:country_evidence_absent_survives_incomplete',
    );
    assert.equal(stillAbsent.length, 52);
    for (const r of stillAbsent) {
      assert.ok(!r.domain?.endsWith('.mx'), `${r.domain} no debía seguir ausente`);
    }
  });
});

// ─── § 2 ──────────────────────────────────────────────────────────────────────

/** Un caso por país: hostname nativo, locale en la ruta, mención en el título, consulta. */
const PER_COUNTRY: Record<string, { host: string; path: string; title: string; query: string }> = {
  MX: { host: 'empresa.com.mx', path: 'https://global.com/es-mx/', title: 'Acme México', query: 'software en México' },
  CL: { host: 'empresa.cl', path: 'https://global.com/es-cl/', title: 'Acme Chile', query: 'software en Chile' },
  BR: { host: 'empresa.com.br', path: 'https://global.com/pt-br/', title: 'Acme Brasil', query: 'software no Brasil' },
  PE: { host: 'empresa.com.pe', path: 'https://global.com/es-pe/', title: 'Acme Perú', query: 'software en Perú' },
  UY: { host: 'empresa.com.uy', path: 'https://global.com/es-uy/', title: 'Acme Uruguay', query: 'software en Uruguay' },
  EC: { host: 'empresa.com.ec', path: 'https://global.com/es-ec/', title: 'Acme Ecuador', query: 'software en Ecuador' },
  PY: { host: 'empresa.com.py', path: 'https://global.com/es-py/', title: 'Acme Paraguay', query: 'software en Paraguay' },
  BO: { host: 'empresa.com.bo', path: 'https://global.com/es-bo/', title: 'Acme Bolivia', query: 'software en Bolivia' },
  VE: { host: 'empresa.com.ve', path: 'https://global.com/es-ve/', title: 'Acme Venezuela', query: 'software en Venezuela' },
  GT: { host: 'empresa.com.gt', path: 'https://global.com/es-gt/', title: 'Acme Guatemala', query: 'software en Guatemala' },
  HN: { host: 'empresa.hn', path: 'https://global.com/es-hn/', title: 'Acme Honduras', query: 'software en Honduras' },
  SV: { host: 'empresa.com.sv', path: 'https://global.com/es-sv/', title: 'Acme El Salvador', query: 'software en El Salvador' },
  NI: { host: 'empresa.com.ni', path: 'https://global.com/es-ni/', title: 'Acme Nicaragua', query: 'software en Nicaragua' },
  CR: { host: 'empresa.co.cr', path: 'https://global.com/es-cr/', title: 'Acme Costa Rica', query: 'software en Costa Rica' },
  PA: { host: 'empresa.com.pa', path: 'https://global.com/es-pa/', title: 'Acme Panamá', query: 'software en Panamá' },
  DO: { host: 'empresa.com.do', path: 'https://global.com/es-do/', title: 'Acme República Dominicana', query: 'software en República Dominicana' },
  US: { host: 'empresa.us', path: 'https://global.com/en-us/', title: 'Acme Estados Unidos', query: 'software en Estados Unidos' },
  ES: { host: 'empresa.es', path: 'https://global.com/es-es/', title: 'Acme España', query: 'software en España' },
};

describe('§ 2 — cada país del mago mide URL, texto y consulta', () => {
  for (const [code, c] of Object.entries(PER_COUNTRY)) {
    it(`${code}`, () => {
      const byHost = evidence(code, { website: `https://www.${c.host}`, domain: c.host });
      assert.equal(byHost.evidenceLevel, 'strong', 'hostname nativo');
      assert.ok(byHost.evidenceSources[0]?.startsWith('url:.'), byHost.evidenceSources.join());

      const byPath = evidence(code, { website: c.path, domain: 'global.com' });
      assert.equal(byPath.evidenceLevel, 'strong', 'locale en la ruta');

      const byTitle = evidence(code, { website: 'https://acme.com', domain: 'acme.com', sourceTitle: c.title });
      assert.equal(byTitle.evidenceLevel, 'strong', 'mención en el título');
      assert.ok(byTitle.evidenceSources.some((s) => s.startsWith('text:')));

      const byQuery = evidence(code, { website: 'https://acme.com', domain: 'acme.com', queryText: c.query });
      assert.equal(byQuery.evidenceLevel, 'query_only', 'sólo la consulta');
      assert.deepEqual(byQuery.evidenceSources, ['query_text']);

      const nothing = evidence(code, { website: 'https://acme.com', domain: 'acme.com', sourceTitle: 'Acme' });
      assert.equal(nothing.evidenceLevel, 'weak');
      assert.deepEqual(nothing.evidenceSources, []);
      assert.ok(nothing.warning, 'el hueco se declara, como en Colombia');
    });
  }

  it('a lo sumo UNA fuente de URL y UNA de texto, como en Colombia', () => {
    const r = evidence('MX', {
      website: 'https://acme.com.mx/es-mx/mexico',
      domain: 'acme.com.mx',
      sourceTitle: 'Acme México Monterrey',
    });
    assert.deepEqual(r.evidenceSources, ['url:.com.mx', 'text:mexico']);
  });

  it('el nombre del país en el host con guion cuenta (`leoni-mexico.com`); pegado no', () => {
    assert.equal(evidence('MX', { website: 'http://www.leoni-mexico.com', domain: 'leoni-mexico.com' }).evidenceLevel, 'strong');
    assert.equal(evidence('MX', { website: 'http://www.cemexmexico.com', domain: 'cemexmexico.com' }).evidenceLevel, 'weak');
  });
});

// ─── § 3 ──────────────────────────────────────────────────────────────────────

describe('§ 3 — la evidencia no se fabrica', () => {
  it('«climate» no es Lima', () => {
    assert.equal(evidence('PE', { sourceTitle: 'Climate Solutions' }).evidenceLevel, 'weak');
    assert.equal(evidence('PE', { sourceTitle: 'Oficina en Lima' }).evidenceLevel, 'strong');
  });

  it('«usa» en español es un verbo: no prueba Estados Unidos en el texto ni en la consulta', () => {
    assert.equal(evidence('US', { sourceTitle: 'La empresa que usa IA' }).evidenceLevel, 'weak');
    assert.equal(evidence('US', { queryText: 'empresas que usa software' }).evidenceLevel, 'weak');
  });

  it('`/usability` no es `/usa`; `/usa/` sí', () => {
    assert.equal(evidence('US', { website: 'https://acme.com/usability' }).evidenceLevel, 'weak');
    assert.equal(evidence('US', { website: 'https://acme.com/usa/' }).evidenceLevel, 'strong');
  });

  it('New Mexico / Nuevo México no es México', () => {
    assert.equal(evidence('MX', { sourceTitle: 'University of New Mexico' }).evidenceLevel, 'weak');
    assert.equal(evidence('MX', { queryText: 'software en Nuevo México' }).evidenceLevel, 'weak');
  });

  it('Panama City (Florida) no es Panamá', () => {
    assert.equal(evidence('PA', { sourceTitle: 'Panama City Beach Resort' }).evidenceLevel, 'weak');
  });

  it('un dominio colombiano no se lee como nativo de otro país', () => {
    const r = evidence('MX', { website: 'https://empresa.com.co', domain: 'empresa.com.co' });
    assert.equal(r.evidenceLevel, 'weak');
  });

  it('el TLD japonés de una filial no es evidencia; el título que dice México sí', () => {
    const r = evidence('MX', {
      website: 'http://www.kiw.co.jp',
      domain: 'kiw.co.jp',
      sourceTitle: 'Kitagawa Mexico S.A. de C.V.',
    });
    assert.deepEqual(r.evidenceSources, ['text:mexico']);
  });

  it('una ciudad en la consulta no basta: sólo el nombre del país', () => {
    assert.equal(evidence('MX', { queryText: 'software en Monterrey' }).evidenceLevel, 'weak');
  });

  it('«español» es un idioma, no España', () => {
    assert.equal(evidence('ES', { sourceTitle: 'Academia de español' }).evidenceLevel, 'weak');
  });
});

// ─── § 4 ──────────────────────────────────────────────────────────────────────

describe('§ 4 — Colombia y Argentina conservan sus ramas', () => {
  it('CO: TLD, texto, consulta y ausencia, igual que antes', () => {
    assert.deepEqual(evidence('CO', { website: 'https://a.com.co', domain: 'a.com.co' }).evidenceSources, ['url:.com.co']);
    assert.deepEqual(evidence('CO', { sourceTitle: 'Acme Bogotá' }).evidenceSources, ['text:bogotá']);
    assert.equal(evidence('CO', { queryText: 'software Colombia' }).evidenceLevel, 'query_only');
    assert.deepEqual(evidence('CO', { website: 'https://a.com', domain: 'a.com' }), {
      evidenceLevel: 'weak',
      evidenceSources: [],
      warning: 'País no confirmado por ninguna evidencia del candidato',
    });
  });

  it('AR: sigue por subcadena y sin el ccTLD desnudo (límite declarado)', () => {
    assert.deepEqual(evidence('AR', { website: 'https://a.com.ar', domain: 'a.com.ar' }).evidenceSources, ['argentina_domain_com_ar']);
    assert.equal(evidence('AR', { website: 'https://empresa.ar', domain: 'empresa.ar' }).evidenceLevel, 'weak');
  });

  it('un país fuera de la tabla sigue devolviendo weak SIN warning', () => {
    assert.deepEqual(evidence('FR', { website: 'https://a.fr', domain: 'a.fr' }), {
      evidenceLevel: 'weak',
      evidenceSources: [],
      warning: null,
    });
    assert.deepEqual(
      evaluateCountryEvidence({
        website: 'https://a.com.mx',
        domain: 'a.com.mx',
        sourceSnippet: null,
        sourceTitle: null,
        queryText: null,
        targetCountryCode: null,
      }),
      { evidenceLevel: 'weak', evidenceSources: [], warning: null },
    );
  });
});

// ─── § 5 ──────────────────────────────────────────────────────────────────────

describe('§ 5 — la tabla cubre exactamente los países de la regla de dominios', () => {
  it('COUNTRY_EVIDENCE_SIGNALS = COUNTRY_DOMAIN_RULES − {CO, AR}', () => {
    const expected = Object.keys(COUNTRY_DOMAIN_RULES).filter((c) => c !== 'CO' && c !== 'AR').sort();
    assert.deepEqual(Object.keys(COUNTRY_EVIDENCE_SIGNALS).sort(), expected);
    assert.deepEqual(Object.keys(PER_COUNTRY).sort(), expected, 'y § 2 prueba cada uno');
  });

  it('todo término está en minúsculas y sin tildes (se compara contra texto normalizado)', () => {
    for (const [code, s] of Object.entries(COUNTRY_EVIDENCE_SIGNALS)) {
      for (const term of [...s.names, ...s.textSignals, ...s.urlFragments, ...(s.excludedPhrases ?? [])]) {
        assert.equal(term, term.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), `${code}: ${term}`);
      }
    }
  });
});

// ─── § 6 ──────────────────────────────────────────────────────────────────────

describe('§ 6 — la política lee el resultado como siempre', () => {
  it('`.com.mx` autoriza aceptación y gasto; `.com` sin mención sigue sin autorizar', () => {
    const mx = computeEvidencePersistencePolicy({
      countryEvidence: evidence('MX', { website: 'https://a.com.mx', domain: 'a.com.mx' }),
    });
    assert.equal(mx.targetAcceptanceAuthorized, true);
    assert.equal(mx.paidCompletionAuthorized, true);

    const absent = computeEvidencePersistencePolicy({
      countryEvidence: evidence('MX', { website: 'https://a.com', domain: 'a.com' }),
    });
    assert.equal(absent.targetAcceptanceAuthorized, false);
    assert.equal(absent.primaryReason, 'country_evidence_absent_survives_incomplete');
  });
});
