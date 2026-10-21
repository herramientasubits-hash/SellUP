/**
 * Tests — filtro de empresa de Lusha Contact Prospecting (Agente 2A · LUSHA-PROSPECTING-DOMAIN-ONLY-1)
 *
 * Medición Prod 21-10 (60 días): 76 búsquedas de Lusha cobraron 1 crédito y no dejaron
 * candidatos; en 39 TODAS las personas devueltas eran de OTRO dominio, aunque la corrida tenía
 * dominio. El runner mandaba `names` + `domains` juntos y luego descartaba todo lo que no fuera
 * del dominio exacto, así que el nombre sólo podía traer resultados que se tiran.
 *
 * Funciones puras. Sin red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLushaProspectingCompanyInclude } from '../lusha-prospecting-company-filter';

describe('buildLushaProspectingCompanyInclude', () => {
  it('con dominio ⇒ SOLO el dominio, nunca el nombre', () => {
    assert.deepEqual(buildLushaProspectingCompanyInclude('Laboratorio Instituto Sanitas®', 'sanitas.cl'), {
      domains: ['sanitas.cl'],
    });
  });

  it('normaliza el dominio (protocolo, www, ruta, mayúsculas)', () => {
    assert.deepEqual(buildLushaProspectingCompanyInclude('ACME', 'https://WWW.Acme.co/contacto'), {
      domains: ['acme.co'],
    });
  });

  it('sin dominio ⇒ el nombre (único filtro posible)', () => {
    assert.deepEqual(buildLushaProspectingCompanyInclude('ABANK', null), { names: ['ABANK'] });
    assert.deepEqual(buildLushaProspectingCompanyInclude('ABANK', '   '), { names: ['ABANK'] });
  });

  it('sin nada ⇒ vacío (el runner ya lo trata como contexto inválido)', () => {
    assert.deepEqual(buildLushaProspectingCompanyInclude(null, null), {});
    assert.deepEqual(buildLushaProspectingCompanyInclude('  ', ''), {});
  });
});

describe('el runner usa el filtro (no vuelve a mezclar nombre y dominio)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const runner = readFileSync(join(here, '..', 'lusha-enrichment-runner.ts'), 'utf8');

  it('importa y usa buildLushaProspectingCompanyInclude', () => {
    assert.match(runner, /buildLushaProspectingCompanyInclude\(companyName, companyDomain\)/);
  });

  it('ya no arma companyInclude a mano con names + domains', () => {
    assert.equal(/companyInclude\['names'\]\s*=/.test(runner), false);
    assert.equal(/companyInclude\['domains'\]\s*=/.test(runner), false);
  });
});
