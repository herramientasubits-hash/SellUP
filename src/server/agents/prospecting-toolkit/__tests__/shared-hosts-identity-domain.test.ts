/**
 * AGENT1-SHARED-HOSTS-1 — una sola lista de hosts compartidos; la identidad de
 * empresa nunca usa uno como dominio, y los conectores de país la importan.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isPlatformHostByLabel, isSharedPlatformHost, SHARED_PLATFORM_HOSTS } from '../shared-hosts';
import {
  buildCompanySearchTerms,
  buildNormalizedNameLookupVariants,
  escapeIlikePattern,
  normalizeDomain,
  normalizeIdentityDomain,
  normalizeStoredCompanyName,
} from '../normalization';
import { normalizeName } from '../candidate-writer-pure-gates';
import { buildCompanyIdentityEvidence } from '../company-identity-evidence';
import { evaluateExternalPlatformGate } from '../external-platform-blocklist';
import { isVenezuelaPlatformHost } from '@/server/source-catalog/connectors/ve-sources/ve-domain';
import { isNicaraguaPlatformHost } from '@/server/source-catalog/connectors/ni-sources/ni-domain';
import {
  EC_NON_CORPORATE_HOSTS,
  hostFromDeclaredUrl,
} from '@/server/source-catalog/connectors/ec-scvs/ec-sercop-domain';

describe('normalizeIdentityDomain', () => {
  it('🔴 dos empresas en Google Sites ya no comparten «sites.google.com» como identidad', () => {
    assert.equal(normalizeDomain('https://sites.google.com/view/acme'), 'sites.google.com');
    assert.equal(normalizeIdentityDomain('https://sites.google.com/view/acme'), null);
    assert.equal(normalizeIdentityDomain('https://sites.google.com/view/otra'), null);
  });

  for (const shared of [
    'https://linktr.ee/acme',
    'https://wa.me/573001234567',
    'https://bit.ly/3xYz',
    'https://acme.business.site',
    'https://www.facebook.com/acme',
    'acme.wixsite.com/inicio',
    'acme.blogspot.com',
    'gmail.com',
  ]) {
    it(`host compartido «${shared}» ⇒ null`, () => {
      assert.equal(normalizeIdentityDomain(shared), null);
    });
  }

  it('un dominio propio sigue igual que con normalizeDomain', () => {
    for (const value of ['https://www.siigo.com/co', 'ww2.mutual.cl', 'bitcoin-colombia.com', 'wala.com.co']) {
      assert.equal(normalizeIdentityDomain(value), normalizeDomain(value));
    }
  });

  it('quita el punto final del FQDN', () => {
    assert.equal(normalizeIdentityDomain('acme.com.'), 'acme.com');
  });

  it('nulos y basura ⇒ null', () => {
    assert.equal(normalizeIdentityDomain(null), null);
    assert.equal(normalizeIdentityDomain(''), null);
    assert.equal(normalizeIdentityDomain('localhost'), null);
  });
});

describe('evidencia de identidad y términos de búsqueda', () => {
  it('🔴 con `domain` compartido usa la web propia; con los dos compartidos, null', () => {
    const withWebsite = buildCompanyIdentityEvidence({
      countryCode: 'CO',
      domain: 'facebook.com',
      website: 'https://www.acme.com.co',
      name: 'Acme',
    });
    assert.equal(withWebsite.normalizedDomain, 'acme.com.co');
    const onlyShared = buildCompanyIdentityEvidence({
      countryCode: 'CO',
      domain: 'sites.google.com',
      website: 'https://linktr.ee/acme',
      name: 'Acme',
    });
    assert.equal(onlyShared.normalizedDomain, null);
  });

  it('buscar duplicados por `facebook.com` ya no encuentra «otra empresa con Facebook»', () => {
    const terms = buildCompanySearchTerms({ name: 'Acme', website: 'https://facebook.com/acme' });
    assert.equal(terms.domain, null);
  });
});

describe('nombre normalizado guardado y escape de ilike', () => {
  it('🔴 normalizeStoredCompanyName es idéntica a `normalizeName` del writer', () => {
    for (const name of ['Acme S.A.S.', 'Café Ñandú Ltda', '  Grupo   Éxito  ', '100% Natural', 'A&B Co.']) {
      assert.equal(normalizeStoredCompanyName(name), normalizeName(name));
    }
  });

  it('las variantes cubren la forma guardada (con sufijo) y la de comparación (sin sufijo)', () => {
    assert.deepEqual(buildNormalizedNameLookupVariants('Acme S.A.S.').sort(), ['acme', 'acme s a s']);
    assert.deepEqual(buildNormalizedNameLookupVariants('Siigo'), ['siigo']);
  });

  it('escapa % _ y la barra', () => {
    assert.equal(escapeIlikePattern('100% Natural_Co\\x'), '100\\% Natural\\_Co\\\\x');
  });
});

describe('una sola lista: gate de plataformas y conectores de país', () => {
  for (const url of ['https://sites.google.com/view/x', 'https://linktr.ee/x', 'https://acme.business.site', 'https://wa.me/57300', 'https://bit.ly/x']) {
    it(`el gate bloquea ${url}`, () => {
      assert.equal(evaluateExternalPlatformGate(url).allowed, false);
    });
  }

  it('el gate deja pasar un sitio propio', () => {
    assert.equal(evaluateExternalPlatformGate('https://www.acme.com.co').allowed, true);
  });

  it('Venezuela y Nicaragua conservan lo que ya bloqueaban', () => {
    for (const host of [
      'facebook.com', 'm.facebook.com', 'facebook.com.ve', 'x.wixsite.com', 'sites.google.com', 'linktr.ee',
      'wa.me', 'bit.ly', 'negocio.site', 'acme.business.site', 'es.tl', 'acme.blogspot.com', 'tinyurl.com',
    ]) {
      assert.equal(isVenezuelaPlatformHost(host), true, `VE ${host}`);
      assert.equal(isNicaraguaPlatformHost(host), true, `NI ${host}`);
    }
    for (const host of ['bancaribe.com.ve', 'casapellas.com.ni']) {
      assert.equal(isVenezuelaPlatformHost(host), false);
      assert.equal(isNicaraguaPlatformHost(host), false);
    }
  });

  it('Ecuador conserva TODAS sus entradas anteriores', () => {
    for (const host of [
      'facebook.com', 'faceboook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
      'youtube.com', 'tiktok.com', 'wa.me', 'whatsapp.com', 'google.com', 'gmail.com', 'hotmail.com',
      'outlook.com', 'yahoo.com', 'blogspot.com', 'wordpress.com', 'wixsite.com', 'wix.com', 'jimdo.com',
      'weebly.com', 'bit.ly', 'linktr.ee', 'compraspublicas.gob.ec',
    ]) {
      assert.ok(EC_NON_CORPORATE_HOSTS.has(host), host);
    }
    assert.equal(hostFromDeclaredUrl('https://www.acme.com.ec/contacto'), 'acme.com.ec');
  });

  it('isSharedPlatformHost es exacta/por subdominio (no por etiqueta): «bit» o «wa» propios no se pierden', () => {
    assert.equal(isSharedPlatformHost('bitcoin.com.co'), false);
    assert.equal(isSharedPlatformHost('wa.gov.au'), false);
    assert.equal(isSharedPlatformHost('acme.wixsite.com'), true);
    assert.equal(isPlatformHostByLabel('facebook.com.ve'), true);
    assert.ok(SHARED_PLATFORM_HOSTS.size > 30);
  });

  it('los conectores de país IMPORTAN la lista (no la copian)', () => {
    const root = join(__dirname, '..', '..', '..', 'source-catalog', 'connectors');
    for (const file of ['ve-sources/ve-domain.ts', 'ni-sources/ni-domain.ts', 'ec-scvs/ec-sercop-domain.ts']) {
      const source = readFileSync(join(root, file), 'utf8');
      assert.match(source, /prospecting-toolkit\/shared-hosts/, file);
      assert.doesNotMatch(source, /const PLATFORM_HOST\s*=/, `${file} ya no define su propia lista`);
    }
  });
});
