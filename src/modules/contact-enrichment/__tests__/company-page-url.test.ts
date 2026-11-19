/**
 * Feedback 19-11 — pegar el LinkedIn de la empresa en «Prospectar contactos» ya no busca la
 * empresa «LinkedIn»: se busca por el nombre que dice el enlace.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { humanizePageSlug, parseCompanyPageUrl } from '../company-page-url';
import { parseAgent2AInput } from '../agent2a-input';
import {
  buildResolveInput,
  classifyCompanyQuery,
  companyQueryDomain,
  extraDataPrefill,
  manualCandidateFromExtraData,
} from '@/components/contact-enrichment/contact-enrichment-chat-reducer';

describe('parseCompanyPageUrl', () => {
  it('lee el nombre de la página de empresa en LinkedIn, con o sin protocolo y subdominio', () => {
    for (const raw of [
      'https://www.linkedin.com/company/cemaco-guatemala/',
      'linkedin.com/company/cemaco-guatemala',
      'https://gt.linkedin.com/company/cemaco-guatemala/about/?trk=x',
    ]) {
      const page = parseCompanyPageUrl(raw);
      assert.equal(page?.nameGuess, 'Cemaco Guatemala', raw);
      assert.equal(page?.host, 'linkedin.com');
      assert.equal(page?.linkedinCompanyUrl, 'https://www.linkedin.com/company/cemaco-guatemala');
    }
  });

  it('un ID numérico no es nombre; tampoco un perfil de persona', () => {
    assert.equal(parseCompanyPageUrl('linkedin.com/company/12345678')?.nameGuess, null);
    assert.equal(parseCompanyPageUrl('linkedin.com/in/ana-perez')?.nameGuess, null);
  });

  it('otras redes con ruta también aportan el nombre', () => {
    assert.equal(parseCompanyPageUrl('https://www.facebook.com/CemacoGT')?.nameGuess, 'CemacoGT');
    assert.equal(parseCompanyPageUrl('instagram.com/@grupo_refax')?.nameGuess, 'Grupo Refax');
  });

  it('no toca dominios propios, nombres, correos ni la red sin ruta', () => {
    assert.equal(parseCompanyPageUrl('cemaco.com/contacto'), null);
    assert.equal(parseCompanyPageUrl('Cemaco Guatemala'), null);
    assert.equal(parseCompanyPageUrl('ana@cemaco.com'), null);
    assert.equal(parseCompanyPageUrl('linkedin.com'), null);
    assert.equal(parseCompanyPageUrl('https://www.linkedin.com/'), null);
  });

  it('humanizePageSlug quita el número final', () => {
    assert.equal(humanizePageSlug('acme-latam-98765'), 'Acme Latam');
    assert.equal(humanizePageSlug('98765'), null);
  });
});

describe('asistente «Por empresa» con enlace de LinkedIn', () => {
  const q = 'https://www.linkedin.com/company/cemaco-guatemala/';

  it('no es un dominio y se busca por nombre', () => {
    assert.equal(companyQueryDomain(q), null);
    assert.equal(classifyCompanyQuery(q), 'company_page');
    assert.deepEqual(buildResolveInput(q), {
      companyName: 'Cemaco Guatemala',
      linkedinCompanyUrl: 'https://www.linkedin.com/company/cemaco-guatemala',
    });
    assert.deepEqual(extraDataPrefill(q), { name: 'Cemaco Guatemala', domain: '' });
  });

  it('sin nombre en el enlace no busca nada', () => {
    assert.equal(buildResolveInput('linkedin.com/company/12345678').companyName, undefined);
    assert.deepEqual(extraDataPrefill('linkedin.com/company/12345678'), { name: '', domain: '' });
  });

  it('«linkedin.com» a secas sigue siendo un dominio (LinkedIn como prospecto)', () => {
    assert.equal(classifyCompanyQuery('linkedin.com'), 'domain');
    assert.deepEqual(buildResolveInput('linkedin.com'), { companyDomain: 'linkedin.com' });
  });

  it('empresa manual con el enlace en «dominio»: nombre de la ruta, sin dominio linkedin.com', () => {
    const c = manualCandidateFromExtraData({ name: '', domain: q, countryCode: 'GT', countryName: 'Guatemala' });
    assert.equal(c.name, 'Cemaco Guatemala');
    assert.equal(c.domain, undefined);
    assert.equal(c.linkedinUrl, 'https://www.linkedin.com/company/cemaco-guatemala');
  });
});

describe('parseAgent2AInput (servidor)', () => {
  it('un enlace de LinkedIn en companyDomain se vuelve nombre, nunca dominio linkedin.com', () => {
    const input = parseAgent2AInput({ companyDomain: 'https://www.linkedin.com/company/cemaco-guatemala' });
    assert.equal(input.companyDomain, undefined);
    assert.equal(input.companyName, 'Cemaco Guatemala');
    assert.equal(input.linkedinCompanyUrl, 'https://www.linkedin.com/company/cemaco-guatemala');
  });

  it('respeta el nombre escrito', () => {
    const input = parseAgent2AInput({ companyName: 'CEMACO', companyDomain: 'linkedin.com/company/cemaco-gt' });
    assert.equal(input.companyName, 'CEMACO');
  });

  it('un dominio propio no cambia', () => {
    assert.equal(parseAgent2AInput({ companyDomain: 'https://www.cemaco.com' }).companyDomain, 'cemaco.com');
  });
});
