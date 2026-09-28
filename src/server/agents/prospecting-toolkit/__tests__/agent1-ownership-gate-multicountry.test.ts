/**
 * AGENT1-OWNERSHIP-GATE-MULTICOUNTRY-1 — el gate de propiedad deja de ser
 * sólo colombiano.
 *
 * Qué fija:
 *
 *   § 1 · entidades públicas de otros países («Municipalidad de Lima»,
 *         `munlima.gob.pe`) ya no se rechazan por no conocer su cabeza
 *         institucional ni su sufijo `.gob.pe`;
 *   § 2 · las formas societarias y los gentilicios de otros países no ensucian
 *         la comparación nombre ↔ dominio;
 *   § 3 · Colombia NO cambia: instantánea de casos reales tomada con `main`
 *         (229c8d6e). La comparación completa sobre 370 candidatos reales dio
 *         0 decisiones distintas;
 *   § 4 · lo que sigue rechazándose a propósito: abreviaturas que no se pueden
 *         probar desde el nombre (`minsa`, `walmex`, `munistgo`) y dominios
 *         ajenos. El gate prefiere perder un candidato a aceptar un dominio que
 *         no es de la empresa.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
} from '../company-ownership-gate';

function verdict(name: string, domain: string) {
  const result = evaluateCompanyOwnership(name, `https://${domain}`, domain);
  return { confidence: result.confidence, blocked: isBlockedByCompanyOwnership(result) };
}

describe('§ 1 — entidades públicas fuera de Colombia', () => {
  for (const [name, domain] of [
    ['Municipalidad de Lima', 'munlima.gob.pe'],
    ['Municipalidad Metropolitana de Lima', 'munlima.gob.pe'],
    ['Gobierno de Jalisco', 'jalisco.gob.mx'],
    ['Gobierno del Estado de Jalisco', 'jalisco.gob.mx'],
    ['Ayuntamiento de Madrid', 'madrid.es'],
    ['Intendencia de Montevideo', 'montevideo.gub.uy'],
    ['Gobierno de la Ciudad de Buenos Aires', 'buenosaires.gob.ar'],
  ] as const) {
    it(`${name} / ${domain} ⇒ no se bloquea`, () => {
      assert.equal(verdict(name, domain).blocked, false);
    });
  }

  it('🔴 «Municipalidad de Lima» se bloqueaba antes: ahora pasa', () => {
    assert.equal(verdict('Municipalidad de Lima', 'munlima.gob.pe').confidence, 'medium');
  });
});

describe('§ 2 — formas societarias y gentilicios de otros países', () => {
  for (const [name, domain] of [
    ['Grupo Bimbo S.A.B. de C.V.', 'grupobimbo.com'],
    ['Bimbo México', 'bimbo.com.mx'],
    ['Cemex S.A.B. de C.V.', 'cemex.com'],
    ['Alicorp S.A.A.', 'alicorp.com.pe'],
    ['Falabella S.A.', 'falabella.cl'],
    ['Natura Cosméticos', 'natura.com.br'],
    ['Telefónica España', 'telefonica.es'],
    ['Mercadona S.A.', 'mercadona.es'],
    ['Liverpool', 'liverpool.com.mx'],
    ['Acme Inc', 'acme.com'],
  ] as const) {
    it(`${name} / ${domain} ⇒ no se bloquea`, () => {
      assert.equal(verdict(name, domain).blocked, false);
    });
  }

  it('«Banco de Chile» / bancochile.cl sube a confianza alta', () => {
    assert.equal(verdict('Banco de Chile', 'bancochile.cl').confidence, 'high');
  });
});

describe('§ 3 — Colombia no cambia (instantánea de main 229c8d6e)', () => {
  const SNAPSHOT: ReadonlyArray<readonly [string, string, string]> = [
    ['Alcaldía de Villavicencio', 'alcaldiadevillavicencio.gov.co', 'high'],
    ['Concejo Municipal de Bello', 'concejodebello.gov.co', 'medium'],
    ['Corte Constitucional de Colombia', 'corteconstitucional.gov.co', 'medium'],
    ['Grupo Éxito', 'grupoexito.com.co', 'high'],
    ['Hotel InterContinental Cartagena de Indias', 'intercartagena.com', 'medium'],
    ['Instituto de Seguros Sociales, Colombia', 'iss.gov.co', 'medium'],
    ['Municipio de Sogamoso', 'sogamoso-boyaca.gov.co', 'medium'],
    ['Gobernación de Sucre', 'sucre.gov.co', 'medium'],
    ['Sura', 'suramericana.com', 'high'],
    ['Banmedica S.A.', 'www.banmedica.cl', 'medium'],
    ['Bavaria - Colombia', 'www.bavaria.co', 'high'],
    ['Alcaldía Mayor de Bogotá', 'www.bogota.gov.co', 'medium'],
    ['Clínica Las Condes', 'www.clinicalascondes.cl', 'high'],
    ['Maestro Perú', 'www.maestro.com.pe', 'medium'],
    ['Makro Colombia', 'www.makro.com.co', 'high'],
    ['Ministerio de Salud y Protección Social de Colombia', 'www.minsalud.gov.co', 'medium'],
    ['Siigo', 'www.siigo.com', 'high'],
    ['D1 S.A.S', 'www.tiendasd1.com', 'reject'],
    ['Sodimac Colombia', 'www.homecenter.com.co', 'reject'],
    ['EPM', 'www.une.com.co', 'reject'],
  ];

  for (const [name, domain, expected] of SNAPSHOT) {
    it(`${name} / ${domain} ⇒ ${expected}`, () => {
      assert.equal(verdict(name, domain).confidence, expected);
    });
  }
});

describe('§ 4 — lo que sigue rechazándose a propósito', () => {
  for (const [name, domain] of [
    ['Ministerio de Salud del Perú', 'minsa.gob.pe'],
    ['Walmart de México', 'walmex.mx'],
    ['Municipalidad de Santiago', 'munistgo.cl'],
    ['Siemens', 'randomsite.com'],
  ] as const) {
    it(`${name} / ${domain} ⇒ bloqueado`, () => {
      assert.equal(verdict(name, domain).blocked, true);
    });
  }
});
