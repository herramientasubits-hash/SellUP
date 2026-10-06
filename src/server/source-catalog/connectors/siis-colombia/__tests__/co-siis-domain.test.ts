/**
 * SOURCES-CO-CLOSE-1 — la web de las empresas del SIIS sale de SECOP II y de
 * Supersociedades, sólo si el dominio lleva el nombre de la empresa. Filas con la
 * forma real de datos.gov.co (qmzu-gj57, dd55-74ss).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildCoSiisDomainMap, coNameForDomainMatch } from '../co-siis-domain';

const siis = [
  { nit: '800204634', legalName: 'ACTSIS LTDA' },
  { nit: '890900281', legalName: 'INDUSTRIAS HACEB S.A.' },
  { nit: '860001697', legalName: 'GASEOSAS LUX S.A.S.' },
  { nit: '900628110', legalName: 'BANCO SANTANDER DE COLOMBIA S.A.' },
  { nit: '860005224', legalName: 'BAVARIA & CIA S.C.A' },
  { nit: '900000001', legalName: 'GRUPO ALFA UNO SAS' },
  { nit: '900000002', legalName: 'GRUPO ALFA DOS SAS' },
  { nit: '900000003', legalName: 'GRUPO ALFA TRES SAS' },
  { nit: '800000005', legalName: 'CLINICA DEL SOL S.A.S.' },
];

describe('nombre para comparar con un dominio', () => {
  it('sin forma societaria ni «Colombia» final', () => {
    assert.equal(coNameForDomainMatch('BANCO SANTANDER DE COLOMBIA S.A.'), 'BANCO SANTANDER');
    assert.equal(coNameForDomainMatch('EXPERIAN COLOMBIA S.A.'), 'EXPERIAN');
    assert.equal(coNameForDomainMatch('COLOMBIA'), 'COLOMBIA');
  });
});

describe('buildCoSiisDomainMap', () => {
  it('la web de SECOP que lleva el nombre manda', () => {
    const map = buildCoSiisDomainMap({
      siis,
      secop: [
        { nit: '800204634', sitio_web: 'WWW.ACTSIS.COM', correo: 'gerencia@gmail.com' },
        { nit: '8002046341', sitio_web: 'http://www.actsis.com/', correo: null as unknown as string },
      ],
      supersociedades: [{ nit: '800204634', email: 'contabilidad@actsis.com.co' }],
    });
    assert.deepEqual(map.get('800204634'), { domain: 'actsis.com', source: 'secop_web' });
  });

  it('una web que no es suya (Postobón publicada por Gaseosas Lux) no se usa', () => {
    const map = buildCoSiisDomainMap({
      siis,
      secop: [{ nit: '86000169', sitio_web: 'WWW.POSTOBON.COM' }, { nit: '860001697', sitio_web: 'WWW.POSTOBON.COM' }],
      supersociedades: [],
    });
    assert.equal(map.has('860001697'), false);
  });

  it('sin web, el correo corporativo que lleva el nombre; nunca el gratuito', () => {
    const map = buildCoSiisDomainMap({
      siis,
      secop: [{ nit: '890900281', correo: 'ventas@haceb.com' }],
      supersociedades: [
        { nit: '890900281', email: 'NOTIFICACIONES@HACEB.COM' },
        { nit: '900628110', email: 'notificacionesjudiciales@santander.com.co' },
        { nit: '800000005', email: 'clinicadelsol@hotmail.com' },
      ],
    });
    assert.deepEqual(map.get('890900281'), { domain: 'haceb.com', source: 'secop_email' });
    assert.deepEqual(map.get('900628110'), { domain: 'santander.com.co', source: 'supersociedades_email' });
    assert.equal(map.has('800000005'), false);
  });

  it('un correo del grupo con otro nombre (Bavaria → ab-inbev.com) no se usa', () => {
    const map = buildCoSiisDomainMap({ siis, secop: [], supersociedades: [{ nit: '860005224', email: 'NOTIFICACIONES@AB-INBEV.COM' }] });
    assert.equal(map.has('860005224'), false);
  });

  it('correos de dominios distintos sin web ⇒ ninguno', () => {
    const map = buildCoSiisDomainMap({
      siis,
      secop: [{ nit: '800000005', correo: 'a@clinicadelsol.com' }],
      supersociedades: [{ nit: '800000005', email: 'b@clinicadelsol.com.co' }],
    });
    assert.equal(map.has('800000005'), false);
  });

  it('un dominio en 3 NIT o más es de un grupo: se descarta en todos', () => {
    const map = buildCoSiisDomainMap({
      siis,
      secop: [
        { nit: '900000001', sitio_web: 'grupoalfa.com' },
        { nit: '900000002', sitio_web: 'grupoalfa.com' },
        { nit: '900000003', sitio_web: 'grupoalfa.com' },
      ],
      supersociedades: [],
    });
    assert.equal(map.size, 0);
  });

  it('un NIT que no está en el SIIS no se mira', () => {
    const map = buildCoSiisDomainMap({ siis, secop: [{ nit: '901111111', sitio_web: 'otra.com' }], supersociedades: [] });
    assert.equal(map.size, 0);
  });
});
