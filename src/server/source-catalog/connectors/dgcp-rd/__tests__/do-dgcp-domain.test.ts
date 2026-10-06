/**
 * SOURCES-DO-DGCP-DOMAIN-1 — dominio corporativo desde los correos que una
 * empresa dominicana declara a la DGCP. Casos tomados del archivo real de
 * proveedores (06-10-2026); los correos de personas se sustituyen por buzones
 * sintéticos del mismo dominio.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildDgcpDomainMap,
  corporateDomainFromDgcpEmails,
  domainMatchesCompanyName,
  emailDomains,
  registrableLabel,
} from '../do-dgcp-domain';

describe('piezas', () => {
  it('saca los dominios de una cadena de correos, en orden, sin repetir y sin «www.»', () => {
    assert.deepEqual(emailDomains('ventas@Sinergit.com.do; info@sinergit.com.do, x@www.cecomsa.com'), [
      'sinergit.com.do',
      'cecomsa.com',
    ]);
    assert.deepEqual(emailDomains(null), []);
    assert.deepEqual(emailDomains('sin correo'), []);
  });

  it('la etiqueta del dueño respeta los segundos niveles de país', () => {
    assert.equal(registrableLabel('sinergit.com.do'), 'sinergit');
    assert.equal(registrableLabel('indotel.gob.do'), 'indotel');
    assert.equal(registrableLabel('equifax.com'), 'equifax');
    assert.equal(registrableLabel('ingenium.do'), 'ingenium');
    assert.equal(registrableLabel('mail.altice.com.do'), 'altice');
  });
});

describe('¿el dominio se parece a la razón social?', () => {
  const yes: Array<[string, string]> = [
    ['sinergit.com.do', 'Sinergit, SA'],
    ['multicomputos.com', 'Multicomputos, SRL'],
    ['mattarconsulting.com', 'Mattar Consulting, SRL'],
    ['altice.com.do', 'Altice Dominicana, SA'],
    ['equifax.com', 'Equifax Dominicana, S.R.L'],
    ['dca.com.do', 'DIONISIO CONSTANZO & ASOCIADOS, SRL'],
    ['golddata.net', 'Gold Data Dominicana, S.A.S'],
    ['brugal.com.do', 'Brugal & CO, SA'],
    ['soluciones-globales.net', 'Soluciones Globales JM, SA'],
  ];
  for (const [domain, name] of yes) {
    it(`sí: ${domain} ← ${name}`, () => assert.equal(domainMatchesCompanyName(domain, name), true));
  }

  const no: Array<[string, string, string]> = [
    ['claro.com.do', 'Compañía Dominicana de Teléfonos, S.A', 'una marca distinta de la razón social'],
    ['laboratoriosalfa.com', 'Farach, SA', 'el dominio de otra empresa'],
    ['expresscompaniesdr.com', 'Ganadera Lomas, SRL', 'un despacho que constituye empresas'],
    ['cotuimotorssrl.com', 'Centro de Servicios Cotui, SRL', 'una palabra que no es la primera distintiva'],
    ['proveedores.com', 'Proveedores Unidos, SRL', 'una etiqueta genérica'],
    ['ab.com', 'AB Comercial, SRL', 'una etiqueta demasiado corta'],
  ];
  for (const [domain, name, why] of no) {
    it(`no: ${domain} ← ${name} (${why})`, () => assert.equal(domainMatchesCompanyName(domain, name), false));
  }
});

describe('corporateDomainFromDgcpEmails', () => {
  it('descarta correo gratuito y de proveedores de internet', () => {
    assert.equal(
      corporateDomainFromDgcpEmails({ legalName: 'Laboratorio San Luis, SA', commercial: 'compras@claro.net.do' }),
      null,
    );
    assert.equal(
      corporateDomainFromDgcpEmails({ legalName: 'Gmail Comercial, SRL', commercial: 'ventas@gmail.com' }),
      null,
    );
  });

  it('manda el correo comercial; los otros sólo si el comercial no da nada', () => {
    assert.equal(
      corporateDomainFromDgcpEmails({
        legalName: 'Cecomsa, SRL',
        commercial: 'facturacion@cecomsa.com',
        notifications: 'avisos@cecomsa-notificaciones.com',
      }),
      'cecomsa.com',
    );
    assert.equal(
      corporateDomainFromDgcpEmails({
        legalName: 'Never Off Technology, SRL',
        commercial: 'ventas@hotmail.com',
        contact: 'contacto@neverofftechnology.com',
      }),
      'neverofftechnology.com',
    );
  });

  it('dos dominios distintos que pasan en el mismo nivel ⇒ ninguno', () => {
    assert.equal(
      corporateDomainFromDgcpEmails({
        legalName: 'Intellisys D Corp',
        commercial: 'a@intellisys.com.do; b@intellisysdcorp.com',
      }),
      null,
    );
  });

  it('el mismo dueño con dos extensiones cuenta como uno (gana el primero)', () => {
    assert.equal(
      corporateDomainFromDgcpEmails({ legalName: 'Sinergit, SA', commercial: 'a@sinergit.com.do; b@sinergit.com' }),
      'sinergit.com.do',
    );
  });
});

describe('buildDgcpDomainMap', () => {
  const row = (rnc: string, name: string, comercial: string, tipo = 'RNC'): Record<string, string> => ({
    TIPO_DOCUMENTO: tipo,
    NUMERO_DOCUMENTO: rnc,
    RAZON_SOCIAL: name,
    CORREO_COMERCIAL: comercial,
    CORREO_CONTACTO: '',
    CORREO_NOTIFICACIONES: '',
  });

  it('sólo RNC de empresa; las cédulas y los RNC mal formados quedan fuera', () => {
    const map = buildDgcpDomainMap([
      row('1-01-89584-5', 'Sinergit, SA', 'ventas@sinergit.com.do'),
      row('00112345678', 'Juan Perez', 'juan@juanperez.com', 'Cédula'),
      row('12345', 'Corta, SRL', 'a@corta.com'),
    ]);
    assert.deepEqual([...map], [['101895845', 'sinergit.com.do']]);
  });

  it('un RNC repetido con dominios distintos se queda sin dominio', () => {
    const map = buildDgcpDomainMap([
      row('101895845', 'Sinergit, SA', 'a@sinergit.com.do'),
      row('101895845', 'Sinergit, SA', 'b@sinergitgroup.com'),
      row('101895845', 'Sinergit, SA', 'c@sinergit.com.do'),
    ]);
    assert.equal(map.has('101895845'), false);
  });
});

describe('guardas estáticas', () => {
  it('el módulo es puro y nunca devuelve correos (sólo dominios)', () => {
    const code = readFileSync(
      join(process.cwd(), 'src/server/source-catalog/connectors/dgcp-rd/do-dgcp-domain.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /supabase|process\.env|\bfetch\s*\(|readFileSync|Date\.now/i);
    assert.doesNotMatch(code, /TELEFONO|CELULAR|DIRECCION|\['CONTACTO'\]/, 'nunca lee teléfonos, direcciones ni el nombre del contacto');

    const map = buildDgcpDomainMap([
      {
        TIPO_DOCUMENTO: 'RNC',
        NUMERO_DOCUMENTO: '102316163',
        RAZON_SOCIAL: 'Cecomsa, SRL',
        CORREO_COMERCIAL: 'persona.ficticia@cecomsa.com',
        CORREO_CONTACTO: 'otra.persona@cecomsa.com',
        CORREO_NOTIFICACIONES: '',
        CONTACTO: 'NOMBRE FICTICIO',
        TELEFONO_CONTACTO: '8090000000',
      },
    ]);
    assert.deepEqual([...map.values()], ['cecomsa.com']);
    for (const value of map.values()) assert.doesNotMatch(value, /@/);
  });
});
