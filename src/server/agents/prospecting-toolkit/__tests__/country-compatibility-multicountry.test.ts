/**
 * AGENT1-COUNTRY-COMPATIBILITY-MULTICOUNTRY-1 — el gate de país deja de ser un
 * no-op fuera de Colombia.
 *
 * Antes: para cualquier país ≠ CO devolvía `compatible: true` sin mirar nada
 * (`country_check_not_implemented_for_code`), así que una corrida en México
 * admitía un `.com.pe` o un `.com.co`. Lo usan Apollo (writer, condiciones
 * pre-writer, utilidad de paginación) y Lusha (`lusha-country-gate`).
 *
 *   § 1 · Colombia: EXACTAMENTE el mismo veredicto que en main (foto de 27 URLs);
 *   § 2 · cada país reconoce sus dominios y rechaza los de otro país;
 *   § 3 · los casos ambiguos no rechazan (`.co` desnudo, `/es/` como idioma).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { COUNTRY_DOMAIN_RULES, evaluateCountryCompatibility } from '../country-compatibility';
import { LATAM_COUNTRIES } from '../../../../modules/prospect-batches/types';

/** Veredictos de main 229c8d6e para Colombia (generados con la función original). */
const COLOMBIA_SNAPSHOT: Record<
  string,
  { compatible: boolean; confidence: string; reason: string }
> = {
  'https://www.exito.com.co': {
    compatible: true,
    confidence: 'high',
    reason: 'co_native_tld:.com.co',
  },
  'https://empresa.co': { compatible: true, confidence: 'high', reason: 'co_national_tld' },
  'https://acme.com': {
    compatible: true,
    confidence: 'medium',
    reason: 'global_domain_no_country_signal',
  },
  'https://acme.com/colombia/servicios': {
    compatible: true,
    confidence: 'high',
    reason: 'global_domain_with_co_path_signal',
  },
  'https://acme.com/co/': {
    compatible: true,
    confidence: 'high',
    reason: 'global_domain_with_co_path_signal',
  },
  'https://bimbo.com.mx': {
    compatible: false,
    confidence: 'high',
    reason: 'foreign_country_tld:.com.mx:MX',
  },
  'https://falabella.cl': {
    compatible: false,
    confidence: 'high',
    reason: 'foreign_country_tld:.cl:CL',
  },
  'https://alicorp.com.pe': {
    compatible: false,
    confidence: 'high',
    reason: 'foreign_country_tld:.com.pe:PE',
  },
  'https://acme.com/cl/consultoria': {
    compatible: false,
    confidence: 'medium',
    reason: 'global_domain_with_foreign_path:CL',
  },
  'https://acme.com/mx-es': {
    compatible: false,
    confidence: 'medium',
    reason: 'global_domain_with_foreign_path:MX',
  },
  'https://acme.com.pe/es-co/': {
    compatible: true,
    confidence: 'medium',
    reason: 'foreign_tld_.com.pe_but_co_path_signal',
  },
  'https://minsalud.gov.co': {
    compatible: true,
    confidence: 'high',
    reason: 'co_native_tld:.gov.co',
  },
  'https://acme.es': {
    compatible: false,
    confidence: 'high',
    reason: 'foreign_country_tld:.es:ES',
  },
  'https://acme.com.ar': {
    compatible: false,
    confidence: 'high',
    reason: 'foreign_country_tld:.com.ar:AR',
  },
  'https://natura.com.br': {
    compatible: false,
    confidence: 'high',
    reason: 'foreign_country_tld:.com.br:BR',
  },
  'https://acme.io': {
    compatible: true,
    confidence: 'medium',
    reason: 'global_domain_no_country_signal',
  },
  'https://sub.empresa.co': { compatible: true, confidence: 'high', reason: 'co_national_tld' },
  'https://acme.com.pa': {
    compatible: true,
    confidence: 'medium',
    reason: 'global_domain_no_country_signal',
  },
  'https://acme.gob.mx': {
    compatible: false,
    confidence: 'high',
    reason: 'foreign_country_tld:.mx:MX',
  },
  'https://acme.gov': {
    compatible: true,
    confidence: 'medium',
    reason: 'global_domain_no_country_signal',
  },
  'https://acme.com/es/': {
    compatible: true,
    confidence: 'medium',
    reason: 'global_domain_no_country_signal',
  },
  'https://acme.co.uk': {
    compatible: true,
    confidence: 'medium',
    reason: 'global_domain_no_country_signal',
  },
  'munlima.gob.pe': { compatible: false, confidence: 'high', reason: 'foreign_country_tld:.pe:PE' },
  'jalisco.gob.mx': { compatible: false, confidence: 'high', reason: 'foreign_country_tld:.mx:MX' },
  'https://acme.com/us/': {
    compatible: true,
    confidence: 'medium',
    reason: 'global_domain_no_country_signal',
  },
  'https://acme.cr': {
    compatible: true,
    confidence: 'medium',
    reason: 'global_domain_no_country_signal',
  },
  'https://acme.com.do': {
    compatible: true,
    confidence: 'medium',
    reason: 'global_domain_no_country_signal',
  },
};

describe('§ 1 — Colombia no cambia', () => {
  for (const [url, expected] of Object.entries(COLOMBIA_SNAPSHOT)) {
    it(`CO · ${url}`, () => {
      assert.deepEqual(evaluateCountryCompatibility(url, 'CO'), expected);
    });
  }
});

describe('§ 2 — cada país con sus reglas', () => {
  it('🔴 todo país del mago tiene reglas (ninguno queda en no-op)', () => {
    for (const country of LATAM_COUNTRIES) {
      assert.ok(COUNTRY_DOMAIN_RULES[country.code], country.code);
    }
  });

  const cases: [string, string, boolean, RegExp][] = [
    ['MX', 'https://bimbo.com.mx', true, /^native_tld:\.com\.mx$/],
    ['MX', 'jalisco.gob.mx', true, /^native_tld:\.gob\.mx$/],
    ['MX', 'https://alicorp.com.pe', false, /^foreign_country_tld:\.com\.pe:PE$/],
    ['MX', 'https://www.exito.com.co', false, /^foreign_country_tld:\.com\.co:CO$/],
    ['PE', 'munlima.gob.pe', true, /^native_tld:\.gob\.pe$/],
    ['PE', 'https://bimbo.com.mx', false, /:MX$/],
    ['CL', 'https://falabella.cl', true, /^native_tld:\.cl$/],
    ['BR', 'https://natura.com.br', true, /^native_tld:\.com\.br$/],
    ['BR', 'https://natura.com.br/pt-br', true, /native_tld/],
    ['ES', 'https://telefonica.es', true, /^native_tld:\.es$/],
    ['US', 'https://acme.com', true, /^global_domain_no_country_signal$/],
    ['US', 'https://agency.gov', true, /^native_tld:\.gov$/],
    ['US', 'https://acme.com.mx', false, /:MX$/],
    ['AR', 'https://acme.com/cl/consultoria', false, /^global_domain_with_foreign_path:CL$/],
    ['AR', 'https://acme.com/argentina/servicios', true, /^global_domain_with_target_path_signal$/],
    ['MX', 'https://acme.com.pe/es-mx/', true, /but_target_path_signal$/],
    ['CR', 'https://acme.co.cr', true, /^native_tld:\.co\.cr$/],
  ];
  for (const [code, url, compatible, reason] of cases) {
    it(`${code} · ${url} ⇒ ${compatible ? 'compatible' : 'rechazo'}`, () => {
      const r = evaluateCountryCompatibility(url, code);
      assert.equal(r.compatible, compatible, r.reason);
      assert.match(r.reason, reason);
    });
  }
});

describe('§ 3 — lo ambiguo no rechaza', () => {
  it('🔴 `.co` desnudo NO es «colombiano» para los demás países (uso global)', () => {
    for (const code of ['MX', 'PE', 'US', 'ES']) {
      assert.equal(evaluateCountryCompatibility('https://startup.co', code).compatible, true, code);
    }
  });

  it('🔴 `/es/` es idioma, no España: no rechaza en ningún país', () => {
    for (const code of ['MX', 'PE', 'CL', 'AR', 'US']) {
      assert.equal(
        evaluateCountryCompatibility('https://acme.com/es/servicios', code).compatible,
        true,
        code,
      );
    }
  });

  it('sin URL ⇒ compatible con confianza baja (como siempre)', () => {
    assert.deepEqual(evaluateCountryCompatibility(null, 'MX'), {
      compatible: true,
      confidence: 'low',
      reason: 'no_url_to_evaluate',
    });
  });

  it('país fuera de la tabla ⇒ neutral, como antes', () => {
    assert.equal(
      evaluateCountryCompatibility('https://acme.fr', 'FR').reason,
      'country_check_not_implemented_for_code',
    );
  });
});
