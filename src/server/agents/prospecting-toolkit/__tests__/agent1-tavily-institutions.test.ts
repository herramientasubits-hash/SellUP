/**
 * AGENT1-TAVILY-INSTITUTIONS-1 — sitios de gobierno y educación en las filas web
 * (Tavily). Prod 07-10, Ecuador × Gobierno (b24a558b):
 *   · «www.supercias.gob.ec» e «ibarra.gob.» quedaron como NOMBRE (el título de la
 *     página era la dirección) ⇒ sin RUC por nombre y sin cruce de duplicados;
 *   · «Admisión» (admision.educacion.gob.ec) entró como institución: es un
 *     subportal del Ministerio de Educación.
 * Puro, sin red; la guarda de cableado lee el código sin comentarios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  institutionParentHost,
  isInstitutionHost,
  looksLikeHostName,
  repairInstitutionName,
} from '../prospecting-pipeline';

describe('sitios de gobierno y educación', () => {
  it('reconoce gob/gov/edu/mil con y sin país', () => {
    for (const host of ['supercias.gob.ec', 'www.ibarra.gob.ec', 'mintic.gov.co', 'uees.edu.ec', 'nasa.gov', 'mit.edu']) {
      assert.equal(isInstitutionHost(host), true, host);
    }
    for (const host of ['kruger.com.ec', 'gobierno.com', 'edu-cloud.com', '', null]) {
      assert.equal(isInstitutionHost(host), false, String(host));
    }
  });

  it('un subportal pertenece a su institución', () => {
    assert.equal(institutionParentHost('admision.educacion.gob.ec'), 'educacion.gob.ec');
    assert.equal(institutionParentHost('www.admision.educacion.gob.ec'), 'educacion.gob.ec');
    assert.equal(institutionParentHost('admisiones.uees.edu.ec'), 'uees.edu.ec');
    assert.equal(institutionParentHost('portal.agency.gov'), 'agency.gov');
  });

  it('la institución misma, o un sitio que no es de gobierno, no cambia', () => {
    assert.equal(institutionParentHost('educacion.gob.ec'), null);
    assert.equal(institutionParentHost('www.supercias.gob.ec'), null);
    assert.equal(institutionParentHost('tienda.kruger.com.ec'), null);
    assert.equal(institutionParentHost(null), null);
  });
});

describe('nombre que en realidad es una dirección', () => {
  it('detecta direcciones', () => {
    for (const name of ['www.supercias.gob.ec', 'ibarra.gob.', 'https://quito.gob.ec/', 'kruger.com']) {
      assert.equal(looksLikeHostName(name), true, name);
    }
  });

  it('no confunde nombres reales', () => {
    for (const name of ['Superintendencia de Compañías', 'Municipio de Loja', 'S.A.', 'Corp. Favorita', 'UEES', '']) {
      assert.equal(looksLikeHostName(name), false, name);
    }
  });
});

describe('reparar el nombre de una institución', () => {
  it('dirección como nombre + título de la portada ⇒ el nombre del título', () => {
    assert.equal(
      repairInstitutionName({
        name: 'www.supercias.gob.ec',
        host: 'supercias.gob.ec',
        pageTitle: 'Superintendencia de Compañías, Valores y Seguros | Inicio',
        subportalCollapsed: false,
      }),
      'Superintendencia de Compañías, Valores y Seguros',
    );
  });

  it('dirección como nombre y portada sin título útil ⇒ nombre desde el dominio, nunca la dirección', () => {
    const repaired = repairInstitutionName({ name: 'ibarra.gob.', host: 'ibarra.gob.ec', pageTitle: 'ibarra.gob.ec', subportalCollapsed: false });
    assert.ok(repaired);
    assert.equal(looksLikeHostName(repaired), false);
  });

  it('subportal ⇒ el nombre de la institución dueña', () => {
    assert.equal(
      repairInstitutionName({
        name: 'Admisión',
        host: 'educacion.gob.ec',
        pageTitle: 'Ministerio de Educación – Ecuador',
        subportalCollapsed: true,
      }),
      'Ministerio de Educación',
    );
  });

  it('un nombre real en un sitio de gobierno se queda; nada cambia fuera de gobierno/educación', () => {
    assert.equal(
      repairInstitutionName({ name: 'Municipio de Loja', host: 'loja.gob.ec', pageTitle: 'Inicio', subportalCollapsed: false }),
      null,
    );
    assert.equal(
      repairInstitutionName({ name: 'www.kruger.com.ec', host: 'kruger.com.ec', pageTitle: 'Kruger Corp', subportalCollapsed: false }),
      null,
    );
  });
});

describe('cableado', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const code = strip(readFileSync(join(process.cwd(), 'src/server/agents/prospecting-toolkit/prospecting-pipeline.ts'), 'utf8'));

  it('los dos constructores de candidatos web usan el subportal y reparan el nombre tras verificar la portada', () => {
    assert.equal((code.match(/institutionParentHost\(/g) ?? []).length >= 2, true);
    assert.equal((code.match(/repairInstitutionName\(\{/g) ?? []).length, 2);
    assert.match(code, /if \(!isApolloResult && !nameQualityFiltered\) \{\s*const repairedName = repairInstitutionName/);
  });

  it('Apollo no se toca (su nombre y sitio son los declarados)', () => {
    assert.match(code, /const institutionHost = isApolloResult \|\| declaredWebsite === null \? null :/);
  });
});
