/**
 * AGENT1-LUSHA-SOCIAL-DOMAIN-1 — un «dominio» que es una red social no es el sitio
 * de la empresa.
 *
 * Medido en Producción el 2026-09-30 (Colombia × Tecnología): Carvajal llegó de
 * Lusha con `cl.linkedin.com` como dominio. Esa clave decide el dedupe de la
 * corrida, el guard de activos, el reclamo global y la comprobación de HubSpot.
 *
 *   § 1 · redes sociales ⇒ dominio ausente, con constancia, sin descartar;
 *   § 2 · lo demás no cambia (dominios reales, plataformas que son empresas);
 *   § 3 · dos empresas con dominio de LinkedIn ya no se funden en una.
 *
 *   LIVE_LUSHA_CALLS = 0 · LUSHA_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { LushaCompanyProspectingV3Company } from '@/server/integrations/lusha-client';
import { resolveLushaSectorOption } from '@/server/prospect-batches/lusha-sector-mapping';
import {
  normalizeLushaPreviewCompanies,
  normalizeLushaPreviewCompany,
  type LushaPreviewCriteria,
} from '@/server/prospect-batches/lusha-preview';

function company(overrides: Partial<LushaCompanyProspectingV3Company> = {}): LushaCompanyProspectingV3Company {
  return {
    id: 'c1',
    name: 'Carvajal',
    domain: 'carvajal.com',
    country: 'Colombia',
    countryIso2: null,
    industry: 'Technology, Information & Media',
    employeeCount: 300,
    employeeCountExact: 300,
    employeeCountMin: null,
    employeeCountMax: null,
    linkedinUrl: 'https://co.linkedin.com/company/carvajal',
    ...overrides,
  };
}

const CRITERIA: LushaPreviewCriteria = {
  expectedCountryName: 'Colombia',
  expectedCountryIso2: 'CO',
  industryKey: 'technology',
  sectorLabel: 'Tecnología',
  matchKeywords: resolveLushaSectorOption('technology')?.matchKeywords ?? ['technology'],
  sizeBand: { min: 201, max: 5000 },
  minScore: 70,
};

describe('§ 1 — una red social no es el dominio de la empresa', () => {
  for (const domain of ['cl.linkedin.com', 'linkedin.com', 'www.linkedin.com', 'facebook.com', 'instagram.com', 'x.com']) {
    it(`🔴 «${domain}» ⇒ dominio ausente, constancia y la empresa se conserva`, () => {
      const c = normalizeLushaPreviewCompany(company({ domain }), CRITERIA);
      assert.equal(c.domain, null);
      assert.ok(c.issues.includes('missing_domain'));
      assert.ok(c.issues.includes('domain_is_social_network'));
      assert.equal(c.name, 'Carvajal', 'la empresa sigue ahí');
      assert.equal(c.linkedinUrl, 'https://co.linkedin.com/company/carvajal', 'y su LinkedIn real se conserva');
    });
  }
});

describe('§ 2 — lo demás no cambia', () => {
  it('un dominio real se queda tal cual y sin constancia', () => {
    const c = normalizeLushaPreviewCompany(company({ domain: 'carvajal.com' }), CRITERIA);
    assert.equal(c.domain, 'carvajal.com');
    assert.ok(!c.issues.includes('domain_is_social_network'));
    assert.ok(!c.issues.includes('missing_domain'));
  });

  it('🔴 plataformas que son EMPRESAS reales (HubSpot, Creatio) conservan su dominio', () => {
    for (const domain of ['hubspot.com', 'creatio.com']) {
      const c = normalizeLushaPreviewCompany(company({ domain }), CRITERIA);
      assert.equal(c.domain, domain, domain);
      assert.ok(!c.issues.includes('domain_is_social_network'), domain);
    }
  });

  it('sin dominio sigue siendo sólo missing_domain', () => {
    const c = normalizeLushaPreviewCompany(company({ domain: null }), CRITERIA);
    assert.equal(c.domain, null);
    assert.ok(c.issues.includes('missing_domain'));
    assert.ok(!c.issues.includes('domain_is_social_network'));
  });
});

describe('§ 3 — empresas distintas con dominio de LinkedIn no se funden', () => {
  it('🔴 antes, la segunda salía marcada `duplicate_domain` de la primera', () => {
    const out = normalizeLushaPreviewCompanies(
      [
        company({ id: 'a', name: 'Carvajal', domain: 'cl.linkedin.com' }),
        company({ id: 'b', name: 'Otra Empresa', domain: 'cl.linkedin.com' }),
      ],
      CRITERIA,
    );
    for (const c of out) {
      assert.ok(!c.issues.includes('duplicate_domain'), c.name ?? '');
      assert.equal(c.domain, null);
    }
  });

  it('dos empresas con el MISMO dominio real siguen siendo duplicadas', () => {
    const out = normalizeLushaPreviewCompanies(
      [company({ id: 'a', domain: 'igual.com' }), company({ id: 'b', domain: 'igual.com' })],
      CRITERIA,
    );
    assert.ok(out[1]!.issues.includes('duplicate_domain'));
  });
});
