/**
 * SOURCES-SV-COMPANY-WEB-1 — web de las empresas de la capa gratuita de El Salvador
 * por su nombre, comprobada con su propia página. Casos reales medidos el 08-10-2026.
 * Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  svCompanyWebCandidates,
  svCompanyWebLabels,
  svCompanyWebNameKey,
  svCompanyWebVerdict,
  svExtractPageText,
  svIsBotWall,
  type SvFetchedPage,
} from '../sv-company-web';

const page = (partial: Partial<SvFetchedPage> & Pick<SvFetchedPage, 'host'>): SvFetchedPage => ({
  finalHost: partial.host,
  status: 200,
  blocked: false,
  title: null,
  text: null,
  ...partial,
});

describe('direcciones candidatas desde el nombre', () => {
  it('sin forma ni «(de) El Salvador», todas las palabras pegadas y la primera si es distintiva', () => {
    assert.equal(svCompanyWebNameKey('COMUNICACIONES IBW EL SALVADOR, S.A. DE C.V.'), 'COMUNICACIONES IBW');
    assert.deepEqual(svCompanyWebLabels('GBM DE EL SALVADOR, S.A. DE C.V.'), ['gbm']);
    assert.deepEqual(svCompanyWebLabels('LABORATORIOS SUIZOS, S. A. DE C. V.'), ['laboratoriossuizos']);
    assert.deepEqual(svCompanyWebLabels('COMERCIO Y REPRESENTACIONES, S. A. DE C. V.'), ['comercioyrepresentaciones', 'comerciorepresentaciones']);
    assert.deepEqual(svCompanyWebLabels('DATA & GRAPHICS, S. A. DE C. V.'), ['datagraphics']);
  });

  it('razón social y nombre comercial, con .com.sv, .sv, .com y .net', () => {
    const hosts = svCompanyWebCandidates(['TECNASA ES, S.A. DE C.V.', 'Tecnasa']);
    assert.deepEqual(hosts.slice(0, 4), ['tecnasaes.com.sv', 'tecnasaes.sv', 'tecnasaes.com', 'tecnasaes.net']);
    assert.ok(hosts.includes('tecnasa.com'));
  });
});

describe('la página tiene que nombrar a la empresa', () => {
  const ibw = { legal: ['COMUNICACIONES IBW EL SALVADOR, S.A. DE C.V.'], trade: ['IBW'] };
  const ok = (domain: string, matchedKey: string, check = 'page_names_company') => ({ domain, check, matchedKey });

  it('una palabra del nombre comercial que está en la razón social, en el título de una web .sv', () => {
    const verdict = svCompanyWebVerdict(page({ host: 'ibw.com.sv', title: 'Inicio - IBW El Salvador', text: 'Internet y datos' }), ibw);
    assert.deepEqual(verdict, ok('ibw.com.sv', 'IBW'));
  });

  it('un nombre comercial suelto ajeno a la razón social nunca (Prod 08-10: «salud.com.sv»)', () => {
    const verdict = svCompanyWebVerdict(
      page({ host: 'salud.com.sv', title: 'SALUD | Clínicas', text: 'San Salvador' }),
      { legal: ['COOPERATIVA GANADERA DE SONSONATE DE R. L. DE C.V.'], trade: ['SALUD'] },
    );
    assert.deepEqual(verdict, { rejected: 'not_named' });
  });

  it('fuera de .sv la página tiene que hablar de El Salvador (Prod 08-10: «telefonica.com»)', () => {
    const gbm = { legal: ['GBM DE EL SALVADOR, S.A. DE C.V.'], trade: [] };
    assert.deepEqual(
      svCompanyWebVerdict(page({ host: 'gbm.net', finalHost: 'www.gbm.net', title: 'Servicios y equipos de tecnología | GBM', text: 'Oficinas en Guatemala, El Salvador, Honduras' }), gbm),
      ok('gbm.net', 'GBM'),
    );
    assert.deepEqual(
      svCompanyWebVerdict(page({ host: 'telefonica.com', title: 'Telefónica', text: 'Telefónica Multiservicios en España' }), { legal: ['TELEFONICA MULTISERVICIOS, S.A. DE C.V.'], trade: ['Telefonica'] }),
      { rejected: 'not_salvadoran' },
    );
  });

  it('nunca una página aparcada, en venta o en construcción', () => {
    const verdict = svCompanyWebVerdict(
      page({ host: 'omegatechnology.com.sv', title: 'Under construction - Awesome site in the making!', text: 'OMEGA TECHNOLOGY coming soon' }),
      { legal: ['OMEGA TECHNOLOGY DE EL SALVADOR, S.A. DE C.V.'], trade: [] },
    );
    assert.deepEqual(verdict, { rejected: 'parked' });
  });

  it('una redirección a una dirección que no sale de la razón social no vale (Prod 08-10: «ehr.meditech.com»)', () => {
    const verdict = svCompanyWebVerdict(page({ host: 'quimex.com', finalHost: 'ehr.meditech.com', title: 'QUIMEX', text: 'El Salvador' }), { legal: ['QUIMEX, SOCIEDAD ANONIMA DE CAPITAL VARIABLE'], trade: [] });
    assert.deepEqual(verdict, { rejected: 'redirected_elsewhere' });
  });

  it('bloqueada por Cloudflare: sólo una .sv que es el nombre completo (8+ letras)', () => {
    const dg = svCompanyWebVerdict(page({ host: 'datagraphics.com.sv', status: 403, blocked: true, title: 'Attention Required! | Cloudflare' }), { legal: ['DATA & GRAPHICS, S. A. DE C. V.'], trade: [] });
    assert.deepEqual(dg, ok('datagraphics.com.sv', 'DATA&GRAPHICS', 'blocked_exact_name'));
    assert.deepEqual(svCompanyWebVerdict(page({ host: 'impressa.com', status: 403, blocked: true }), { legal: ['IMPRESSA, S.A. DE C.V.'], trade: [] }), { rejected: 'blocked_not_exact' });
  });

  it('sin respuesta, nada', () => {
    assert.deepEqual(svCompanyWebVerdict(page({ host: 'falmar.com.sv', finalHost: null, status: null }), { legal: ['FALMAR, S. A. DE C. V.'], trade: [] }), { rejected: 'no_response' });
  });
});

describe('lectura de la página', () => {
  it('título y texto sin scripts ni estilos; muro de bots', () => {
    const { title, text } = svExtractPageText('<html><head><title> LETERAGO </title><style>x{}</style></head><body><script>var a</script><h1>Leterago &amp; El Salvador</h1></body></html>');
    assert.equal(title, 'LETERAGO');
    assert.equal(text.includes('var a'), false);
    assert.ok(text.includes('Leterago & El Salvador'));
    assert.equal(svIsBotWall(403, 'Attention Required! | Cloudflare'), true);
    assert.equal(svIsBotWall(200, 'Inicio - IBW El Salvador'), false);
  });
});
