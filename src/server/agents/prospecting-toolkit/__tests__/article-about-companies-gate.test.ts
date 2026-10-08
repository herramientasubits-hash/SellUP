/**
 * AGENT1-TAVILY-ARTICLE-PAGE-1 — una página interna cuyo último tramo es un título
 * largo (o una nota con número de artículo) y cuyo título no nombra al sitio es un
 * artículo SOBRE empresas, no la web de una empresa. Casos reales de SV×Tecnología
 * (Prod 08-10-2026, lote 6ff3a1b5). Sin red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isArticleAboutCompaniesPage } from '../candidate-writer-pure-gates';

describe('artículo sobre empresas (Tavily)', () => {
  it('bloquea notas de diario, publicaciones, carteleras y páginas de directorio', () => {
    const cases: Array<[string, string]> = [
      ['https://diario.elmundo.sv/economia/el-salvador-tiene-siete-empresas-dedicadas-a-la-inteligencia-artificial', 'El Salvador tiene siete empresas dedicadas a la inteligencia ...'],
      ['https://www.elsalvador.com/dinero-y-negocios/voces-de-emprendimiento/emprendimiento-fusai-inteligencia-artificial/1259642/2026', 'Pequeñas empresas salvadoreñas adoptan la IA'],
      ['https://data.inve.fce.ues.edu.sv/publicaciones/inteligencia-artificial-en-las-areas-funcionales-de-la-empresa-aplicaciones-y-desafios-en-el-salvador', 'Inteligencia artificial en las áreas funcionales de la empresa'],
      ['https://elsalvador.solutekla.com/service/formacion_en_inteligencia_artificial_ia/desarrollo_de_software_empresarial_con_ia', 'Desarrollo de Software Empresarial con IA en El Salvador'],
      ['https://uca.edu.sv/cartelera/de-postgrado-en-ciencia-de-datos-e-inteligencia-de-negocios-semipresencial', 'De Postgrado en Ciencia de Datos e Inteligencia ...'],
    ];
    for (const [url, title] of cases) assert.equal(isArticleAboutCompaniesPage(url, title), true, url);
  });

  it('deja pasar portadas y páginas internas de la propia empresa', () => {
    const cases: Array<[string | null, string | null]> = [
      ['https://stbgroup.com.sv', 'STB Group'],
      ['https://www.iasansalvador.com', 'IA San Salvador | Inteligencia Artificial para Empresas ...'],
      ['https://acme.com.sv/servicios/desarrollo-web', 'Desarrollo web'],
      ['https://acme.com/es/soluciones-de-ciberseguridad-para-empresas-financieras', 'Soluciones de ciberseguridad para empresas financieras | ACME'],
      ['https://grupo-intelector.com/nosotros', 'Nosotros'],
      [null, 'Lo que sea'],
      ['no es una url', null],
    ];
    for (const [url, title] of cases) assert.equal(isArticleAboutCompaniesPage(url, title), false, String(url));
  });
});
