/**
 * AGENT1-TAVILY-V2-1 § 2 — el filtro de ruido deja pasar a universidades,
 * colegios y entidades de gobierno (decisión de la dueña 2026-09-29: SÍ son
 * clientes de UBITS) y deja de dejar pasar los directorios y agregadores que se
 * colaron en los lotes Tavily de Producción.
 *
 * Casos reales: `co.kompass.com`, `fortunebusinessinsights.com`, `seair.co.in`
 * y `unesdoc.unesco.org` quedaron como candidatos vivos en lotes de junio.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifySearchResult, filterNoiseResults, isProspectableCompanyResult } from '../noise-filter';
import type { WebSearchResult } from '../types';

function result(url: string, title = 'Sitio oficial', snippet = 'Somos una organización.'): WebSearchResult {
  return { title, url, snippet, source: 'tavily', rank: 1, provider: 'tavily', confidence: 0.8, metadata: {} };
}

// `classifySearchResult` es el que corre en producción (vía `filterNoiseResults`).
function kept(url: string, title?: string): boolean {
  return classifySearchResult(result(url, title)).shouldKeep;
}

// `isProspectableCompanyResult` (sin llamadores de producción) exige además un
// dominio corporativo; aquí sólo se fija que ya no descarte por ser `.gov`/`.edu`
// y que sí descarte los mismos documentos y directorios.
function legacyRejectsAsInstitution(url: string): boolean {
  const verdict = isProspectableCompanyResult(result(url));
  return verdict.resultType === 'academic_source' || verdict.resultType === 'non_prospectable_source';
}

describe('isProspectableCompanyResult tampoco descarta instituciones por su dominio', () => {
  for (const url of ['https://www.javeriana.edu.co/', 'https://www.bogota.gov.co/', 'https://www.alcaldiadecali.gob.co/']) {
    it(`no rechaza como institución: ${url}`, () => assert.equal(legacyRejectsAsInstitution(url), false));
  }
  for (const url of ['https://repositorio.unal.edu.co/handle/1', 'https://www.datos.gov.co/x']) {
    it(`sí rechaza el documento/portal: ${url}`, () => assert.equal(legacyRejectsAsInstitution(url), true));
  }
});

describe('instituciones que SÍ son clientes pasan el filtro', () => {
  for (const url of [
    'https://www.javeriana.edu.co/',
    'https://unal.edu.co/',
    'https://www.uninorte.edu.co/web/nosotros',
    'https://www.colegiosanjose.edu.co/',
    'https://www.harvard.edu/',
    'https://www.bogota.gov.co/',
    'https://www.mintic.gov.co/portal/inicio/',
    'https://www.medellin.gov.co/es/',
    'https://www.antioquia.gov.co/',
    'https://www.alcaldiadecali.gob.co/',
  ]) {
    it(`pasa: ${url}`, () => assert.equal(kept(url), true));
  }
});

describe('documentos y portales de datos siguen fuera', () => {
  for (const url of [
    'https://repositorio.unal.edu.co/handle/unal/12345',
    'https://repository.javeriana.edu.co/handle/10554/1',
    'https://bdigital.uninorte.edu.co/x',
    'https://biblioteca.ean.edu.co/libro',
    'https://revistas.javeriana.edu.co/index.php/x',
    'https://unesdoc.unesco.org/ark:/48223/pf0000',
    'https://www.datos.gov.co/Hacienda/x',
    'https://community.secop.gov.co/Public/Tendering',
    'https://www.sciencedirect.com/science/article/x',
  ]) {
    it(`fuera: ${url}`, () => assert.equal(kept(url), false));
  }
});

describe('directorios y agregadores vistos en Producción quedan fuera', () => {
  for (const url of [
    'https://co.kompass.com/c/empresa/co123/',
    'https://www.kompass.com/z/co/',
    'https://www.fortunebusinessinsights.com/es/mercado-x',
    'https://www.seair.co.in/colombia-import-data.aspx',
    'https://www.zoominfo.com/c/empresa/123',
    'https://rocketreach.co/empresa-profile',
    'https://www.dnb.com/business-directory/company-profiles.x.html',
    'https://empresite.eleconomista.es/EMPRESA.html',
    'https://empresite.eleconomistaamerica.pe/EMPRESA.html',
    'https://www.cylex.com.co/bogota/empresa.html',
    'https://www.lusha.com/company/x',
    'https://www.apollo.io/companies/x',
    'https://www.europages.com/x',
    'https://www.statista.com/statistics/x',
    'https://www.mordorintelligence.com/es/industry-reports/x',
  ]) {
    it(`fuera: ${url}`, () => assert.equal(kept(url), false));
  }
});

describe('empresas normales no cambian', () => {
  for (const url of ['https://www.claro.com.co/', 'https://www.bancolombia.com/', 'https://www.coordinadora.com/']) {
    it(`pasa: ${url}`, () => assert.equal(kept(url), true));
  }

  it('filterNoiseResults conserva la universidad y descarta el directorio', () => {
    const out = filterNoiseResults([
      result('https://www.javeriana.edu.co/'),
      result('https://co.kompass.com/c/x/'),
    ]);
    assert.deepEqual(out.kept.map((r) => r.url), ['https://www.javeriana.edu.co/']);
  });
});

describe('AGENT1-TAVILY-V2-1 § 2 — gremios y cámaras de comercio SÍ son clientes', () => {
  for (const url of [
    'https://www.andi.com.co/',
    'https://www.fenalco.com.co/',
    'https://www.ccb.org.co/',
    'https://www.camaramedallin.org.co/',
    'https://fedesoft.org/',
    'https://colombiafintech.co/',
  ]) {
    it(`pasa: ${url}`, () => assert.equal(kept(url), true));
  }

  for (const url of [
    'https://fedesoft.org/miembros',
    'https://www.ccb.org.co/afiliados/directorio',
    'https://colombiafintech.co/asociados',
    'https://www.andicom.co/',
  ]) {
    it(`fuera (listado de afiliados o evento): ${url}`, () => assert.equal(kept(url), false));
  }
});

describe('AGENT1-TAVILY-V2-3 — repositorios de documentos en cualquier dominio', () => {
  // Prod 30-09 (lote 26f57743, CL×Energía): repositorios en `.org` y `.cl` que el
  // filtro sólo miraba bajo `.edu`/`.gov`.
  for (const url of [
    'https://repositorio.cepal.org/entities/publication/x',
    'https://repositorio.uahurtado.cl/handle/11242/1',
    'https://repository.example.org/items/1',
    'https://dspace.uce.edu.ec/handle/1',
    'https://bibliotecadigital.oducal.com/x',
  ]) {
    it(`fuera: ${url}`, () => assert.equal(kept(url), false));
  }
  // Etiquetas que también usan empresas: se siguen exigiendo en dominio institucional.
  for (const url of ['https://biblioteca.empresa.com/', 'https://revista.acme.com.co/', 'https://catalogo.tienda.cl/']) {
    it(`pasa (etiqueta ambigua fuera de .edu/.gov): ${url}`, () => assert.equal(kept(url), true));
  }
});

describe('AGENT1-TAVILY-QUERY-SPACE-1 — portales nacionales que agrupan a todo el Estado', () => {
  // Prod 30-09 (fb530d9b): «GOV.CO» se guardó como candidato.
  for (const url of [
    'https://www.gov.co/',
    'https://gov.co/entidades',
    'https://www.gob.mx/',
    'https://www.argentina.gob.ar/',
    'https://www.gob.pe/institucion',
    'https://www.gob.cl/',
    'https://www.gub.uy/',
  ]) {
    it(`fuera: ${url}`, () => assert.equal(kept(url), false));
  }
  // Sus entidades SÍ son clientes.
  for (const url of ['https://www.ins.gov.co/', 'https://www.sat.gob.mx/', 'https://www.minsa.gob.pe/']) {
    it(`pasa (entidad propia): ${url}`, () => assert.equal(kept(url), true));
  }
});

describe('AGENT1-TAVILY-FREE-CREDITS-1 — ruido visto en Prod 01-10', () => {
  for (const url of [
    'https://www.opcionempleo.cl/empleo-laboratorio.html',
    'https://cl.jobsora.com/empleo-farmaceutico',
    'https://www.dateas.com/es/consulta_entidades',
    'https://www.licitador.co/entidades',
    'https://www.elhospital.com/es/noticias/x',
  ]) {
    it(`fuera: ${url}`, () => assert.equal(kept(url), false));
  }
  // Una ONG sí es cliente: no se filtra por publicar noticias.
  it('pasa: transparenciacolombia.org.co (ONG)', () => assert.equal(kept('https://transparenciacolombia.org.co/'), true));
});
