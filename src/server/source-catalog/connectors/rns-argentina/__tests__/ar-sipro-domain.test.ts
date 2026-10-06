/**
 * SOURCES-AR-SIPRO-DOMAIN-1 — dominio desde el correo del SIPRO histórico.
 * Puro, sin E/S. CUIT con dígito verificador válido.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AR_SIPRO_SHARED_DOMAIN_MIN_CUITS,
  arCorporateDomainFromSiproEmail,
  arNameForDomainMatch,
  buildArSiproDomainMap,
  domainMatchesCurrentArName,
  registrableDomain,
} from '../ar-sipro-domain';

const TELECOM = '30639453738';
const ARCOR = '30704464076';

function sipro(cuit: string, denominacion: string, email: string): Record<string, string> {
  return { cuit, denominacion, email, tipo_proveedor: 'Persona Jurídica' };
}

describe('arNameForDomainMatch', () => {
  it('quita la forma societaria (también compuesta) y «Argentina» final', () => {
    assert.equal(arNameForDomainMatch('TELECOM ARGENTINA SOCIEDAD ANONIMA'), 'TELECOM');
    assert.equal(arNameForDomainMatch('ROEMMERS S A I C F'), 'ROEMMERS');
    assert.equal(arNameForDomainMatch('IRON MOUNTAIN ARGENTINA S. A.'), 'IRON MOUNTAIN');
    assert.equal(arNameForDomainMatch('TELEFONICA DE ARGENTINA S A'), 'TELEFONICA');
  });
});

describe('arCorporateDomainFromSiproEmail', () => {
  it('acepta el dominio que se parece a la razón social', () => {
    assert.equal(arCorporateDomainFromSiproEmail({ legalName: 'TELECOM ARGENTINA S.A.', email: 'ventas@telecom.com.ar' }), 'telecom.com.ar');
    assert.equal(arCorporateDomainFromSiproEmail({ legalName: 'IRON MOUNTAIN ARGENTINA S.A.', email: 'x@ironmountain.com.ar' }), 'ironmountain.com.ar');
  });

  it('se queda con el dominio registrable, no con el subdominio del correo', () => {
    assert.equal(arCorporateDomainFromSiproEmail({ legalName: 'HEXACTA S.A.', email: 'a@mail.hexacta.com' }), 'hexacta.com');
  });

  it('nunca correo gratuito, de proveedor de internet ni de gobierno', () => {
    for (const email of ['a@gmail.com', 'a@arnet.com.ar', 'a@speedy.com.ar', 'a@fibertel.com.ar', 'a@hotmail.com.ar']) {
      assert.equal(arCorporateDomainFromSiproEmail({ legalName: 'ARNET SPEEDY GMAIL S.A.', email }), null, email);
    }
    assert.equal(arCorporateDomainFromSiproEmail({ legalName: 'MECON S.A.', email: 'a@mecon.gov.ar' }), null);
  });

  it('nunca un dominio que no se parece a la razón social', () => {
    assert.equal(arCorporateDomainFromSiproEmail({ legalName: 'AMX ARGENTINA S.A.', email: 'a@claro.com.ar' }), null);
    assert.equal(arCorporateDomainFromSiproEmail({ legalName: 'HORIZONTES S.A.', email: 'a@eltribuno.com.ar' }), null);
  });

  it('dos dominios distintos aceptables en el mismo correo ⇒ ninguno', () => {
    assert.equal(
      arCorporateDomainFromSiproEmail({ legalName: 'TELECOM ARGENTINA S.A.', email: 'a@telecom.com.ar; b@telecomsur.com.ar' }),
      null,
    );
  });
});

describe('buildArSiproDomainMap', () => {
  it('CUIT de persona jurídica válida → dominio; personas humanas y CUIT inválidas fuera', () => {
    const map = buildArSiproDomainMap([
      sipro(TELECOM, 'TELECOM ARGENTINA S.A.', 'a@telecom.com.ar'),
      sipro('20333449588', 'PEREZ JUAN', 'a@perez.com.ar'),
      sipro('30639453739', 'TELECOM BIS S.A.', 'a@telecom.com.ar'),
    ]);
    assert.deepEqual([...map], [[TELECOM, 'telecom.com.ar']]);
  });

  it('una CUIT con dos dominios distintos en filas distintas ⇒ ninguno', () => {
    const map = buildArSiproDomainMap([
      sipro(ARCOR, 'ARCOR S A I C', 'a@arcor.com'),
      sipro(ARCOR, 'ARCOR S A I C', 'a@arcor.com.ar'),
    ]);
    assert.equal(map.has(ARCOR), false);
  });

  it(`un dominio en ${AR_SIPRO_SHARED_DOMAIN_MIN_CUITS}+ CUIT no es de ninguna`, () => {
    const cuits = ['30704464076', '30639453738', '30685856715'];
    const map = buildArSiproDomainMap(cuits.map((c) => sipro(c, 'ESTUDIO NORTE S.A.', 'a@estudionorte.com.ar')));
    assert.equal(map.size, 0);
  });
});

describe('domainMatchesCurrentArName', () => {
  it('el dominio tiene que parecerse también al nombre ACTUAL', () => {
    assert.equal(domainMatchesCurrentArName('telecom.com.ar', 'TELECOM ARGENTINA SOCIEDAD ANONIMA'), true);
    // SIPRO «SYSTEMNET S.A.» → hoy «EC SISTEMAS S R L».
    assert.equal(domainMatchesCurrentArName('system-net.com.ar', 'EC SISTEMAS S R L'), false);
    assert.equal(domainMatchesCurrentArName('telecom.com.ar', null), false);
  });
});

describe('registrableDomain', () => {
  it('respeta los segundos niveles argentinos', () => {
    assert.equal(registrableDomain('tmhm.toyota-industries.com.ar'), 'toyota-industries.com.ar');
    assert.equal(registrableDomain('mail.hexacta.com'), 'hexacta.com');
    assert.equal(registrableDomain('coopabe.coop.ar'), 'coopabe.coop.ar');
  });
});

describe('guardas', () => {
  it('el módulo es puro y nunca guarda correos', () => {
    const code = readFileSync(join(process.cwd(), 'src/server/source-catalog/connectors/rns-argentina/ar-sipro-domain.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /process\.env|fetch\(|createClient|supabase-js/);
  });
});
