/**
 * AUDIT-A1-WS7 (16-10) — entidades de gobierno:
 *
 *   · Un subdominio de gobierno sólo se funde con su «padre» cuando la primera
 *     etiqueta es un subportal conocido (admision, tramites, sede, portal, www2…).
 *     «dmv.ca.gov», «cdph.ca.gov» y «metro.cdmx.gob.mx» son entidades propias.
 *   · `.gub.uy` (Uruguay) y `.go.cr` (Costa Rica) son gobierno.
 *   · Educación (`edu`, `ac`) sigue colapsando a la institución.
 *   · Los ministerios que viven como ruta del portal nacional (gob.pe/minsa,
 *     gob.mx/sep, argentina.gob.ar/salud…) ya no se funden ni se descartan.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { institutionParentHost, isInstitutionHost } from '../prospecting-pipeline';
import { readNationalPortalEntity } from '../national-portal-entity';
import { classifySearchResult, isProspectableCompanyResult } from '../noise-filter';
import { dedupeMultiQueryResultsByIdentity } from '../web-search-tool';
import type { MultiQuerySearchResultEntry } from '../types';

describe('AUDIT-A1-WS7 — subdominios de gobierno', () => {
  it('agencias distintas bajo un portal estatal NO se funden', () => {
    assert.equal(institutionParentHost('dmv.ca.gov'), null);
    assert.equal(institutionParentHost('cdph.ca.gov'), null);
    assert.equal(institutionParentHost('metro.cdmx.gob.mx'), null);
    assert.equal(institutionParentHost('www.metro.cdmx.gob.mx'), null);
  });

  it('un subportal conocido sí pertenece a su institución', () => {
    assert.equal(institutionParentHost('admision.educacion.gob.ec'), 'educacion.gob.ec');
    assert.equal(institutionParentHost('tramites.cdmx.gob.mx'), 'cdmx.gob.mx');
    assert.equal(institutionParentHost('tramites.metro.cdmx.gob.mx'), 'metro.cdmx.gob.mx');
    assert.equal(institutionParentHost('www2.ca.gov'), 'ca.gov');
    assert.equal(institutionParentHost('sede.minhacienda.gov.co'), 'minhacienda.gov.co');
  });

  it('nunca recorta hasta el sufijo', () => {
    assert.equal(institutionParentHost('portal.gob.mx'), null);
    assert.equal(institutionParentHost('tramites.gub.uy'), null);
  });

  it('Uruguay (.gub.uy) y Costa Rica (.go.cr) son gobierno', () => {
    assert.equal(isInstitutionHost('msp.gub.uy'), true);
    assert.equal(isInstitutionHost('ccss.go.cr'), true);
    assert.equal(isInstitutionHost('ucr.ac.cr'), true);
    assert.equal(institutionParentHost('tramites.msp.gub.uy'), 'msp.gub.uy');
    assert.equal(institutionParentHost('servicios.ccss.go.cr'), 'ccss.go.cr');
  });

  it('educación sigue colapsando a la universidad', () => {
    assert.equal(institutionParentHost('medicina.unal.edu.co'), 'unal.edu.co');
    assert.equal(institutionParentHost('cs.stanford.edu'), 'stanford.edu');
    assert.equal(institutionParentHost('derecho.ucr.ac.cr'), 'ucr.ac.cr');
  });
});

describe('AUDIT-A1-WS7 — entidades como ruta del portal nacional', () => {
  it('lee la entidad del primer segmento', () => {
    assert.equal(readNationalPortalEntity('https://www.gob.pe/minsa')?.key, 'gob.pe/minsa');
    assert.equal(readNationalPortalEntity('https://www.gob.pe/institucion/minsa/noticias/1')?.key, 'gob.pe/minsa');
    assert.equal(readNationalPortalEntity('https://www.gob.mx/sep/articulos/x')?.key, 'gob.mx/sep');
    assert.equal(readNationalPortalEntity('https://www.argentina.gob.ar/salud')?.website, 'https://www.argentina.gob.ar/salud');
    assert.equal(readNationalPortalEntity('https://www.gub.uy/ministerio-salud-publica')?.slug, 'ministerio-salud-publica');
    assert.equal(readNationalPortalEntity('https://www.gob.ec/msp')?.key, 'gob.ec/msp');
  });

  it('portada, secciones genéricas y otros dominios no son entidad', () => {
    assert.equal(readNationalPortalEntity('https://www.gob.pe/'), null);
    assert.equal(readNationalPortalEntity('https://www.gob.mx/tramites/ficha/x'), null);
    assert.equal(readNationalPortalEntity('https://www.gob.mx/busqueda?q=x'), null);
    assert.equal(readNationalPortalEntity('https://minsa.gob.pe/x'), null);
    assert.equal(readNationalPortalEntity('https://www.gov.co/ministerios'), null);
    assert.equal(readNationalPortalEntity(null), null);
  });

  it('el filtro de ruido conserva el ministerio y sigue descartando la portada', () => {
    const ministry = { url: 'https://www.gob.pe/minsa', title: 'Ministerio de Salud', snippet: 'Ministerio de Salud del Perú' };
    const portal = { url: 'https://www.gob.pe/', title: 'Plataforma del Estado Peruano', snippet: 'Portal' };
    assert.notEqual(classifySearchResult(ministry).resultType, 'non_prospectable_source');
    assert.equal(classifySearchResult(portal).shouldKeep, false);
    assert.equal(classifySearchResult(portal).resultType, 'non_prospectable_source');
    assert.ok(!/Portal nacional/.test(isProspectableCompanyResult(ministry).reason));
    assert.match(isProspectableCompanyResult(portal).reason, /Portal nacional/);
  });

  it('dos ministerios del mismo portal no se deduplican entre sí', () => {
    const entry = (url: string, title: string) =>
      ({ title, url, snippet: '', source: 'tavily', rank: 1 }) as unknown as MultiQuerySearchResultEntry;
    const out = dedupeMultiQueryResultsByIdentity([
      entry('https://www.gob.pe/minsa', 'Ministerio de Salud'),
      entry('https://www.gob.pe/minedu', 'Ministerio de Educación'),
      entry('https://www.gob.pe/institucion/minsa/noticias/2', 'Noticia MINSA'),
    ]);
    assert.equal(out.length, 2);
  });
});
