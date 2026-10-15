/**
 * Tests — AGENT1-CLAUDE-SECTOR-QUOTE-1: la cita del sector.
 *
 * Prod 14-10: 7 de 49 empresas clasificadas por Claude perdieron el sector con
 * `quote_not_found_in_official_page` aunque la página estaba descargada (5 de 7 con
 * sitio en inglés). Sin sector confirmado, `subindustry_match` no se destraba y la
 * empresa no cuenta para la meta (Automation Anywhere, 1.001 empleados).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractVisibleText, quoteAppearsInText } from '../page-text';
import { REJECTED_QUOTE_MAX_CHARS, verifySubmission } from '../evidence-verifier';
import { buildClassifierSystemPrompt } from '../prompt';
import type { ClassifierCatalogIndustry, RawClassifierSubmission } from '../types';

const TECH_ID = '22222222-2222-2222-2222-222222222222';
const CATALOG: ClassifierCatalogIndustry[] = [
  { industryId: TECH_ID, industryName: 'Tecnología', industryDescription: null, subindustries: [] },
];
const PAGE_URL = 'https://www.automationanywhere.com/';
const PAGE_HTML = `<html><head><title>Automation Anywhere</title></head><body>
<h1>Automation Anywhere</h1>
<p>The leader in Agentic Process Automation (APA), putting AI to work across organizations.</p>
<p>Intelligent automation, RPA and AI agents for the enterprise.</p>
${'<p>Customer stories from banks, insurers and governments around the world.</p>'.repeat(3)}
</body></html>`;
const PAGE_TEXT = extractVisibleText(PAGE_HTML);

function sectorSubmission(quote: string): RawClassifierSubmission {
  return {
    sector: { industry_id: TECH_ID, subindustry_id: null, quote, source_url: PAGE_URL, confidence: 0.9 },
    employee_range: null,
    is_operating_company: true,
    fits_requested_industry: null,
  } as unknown as RawClassifierSubmission;
}

const CTX = { pageUrls: [PAGE_URL], pageText: PAGE_TEXT, searchResultUrls: [] as string[] };

describe('A. comparación de la cita', () => {
  it('la puntuación no cuenta (paréntesis, comas)', () => {
    assert.ok(quoteAppearsInText('The leader in Agentic Process Automation APA putting AI to work', PAGE_TEXT));
    assert.ok(quoteAppearsInText('Intelligent automation RPA and AI agents', PAGE_TEXT));
  });

  it('una cita recortada con «…» vale si cada trozo aparece en orden', () => {
    assert.ok(quoteAppearsInText('The leader in Agentic Process Automation … AI agents for the enterprise', PAGE_TEXT));
    assert.ok(quoteAppearsInText('The leader in Agentic Process Automation... AI agents for the enterprise', PAGE_TEXT));
  });

  it('trozos fuera de orden o trozos cortos no valen', () => {
    assert.equal(quoteAppearsInText('AI agents for the enterprise … The leader in Agentic Process', PAGE_TEXT), false);
    assert.equal(quoteAppearsInText('The leader in Agentic Process … RPA', PAGE_TEXT), false);
  });

  it('una cita inventada o traducida sigue sin valer', () => {
    assert.equal(quoteAppearsInText('Líder en automatización de procesos con agentes', PAGE_TEXT), false);
    assert.equal(quoteAppearsInText('The leader in banking software for Latin America', PAGE_TEXT), false);
  });
});

describe('B. verificación del sector', () => {
  it('con la tolerancia nueva el sector queda confirmado', () => {
    const v = verifySubmission(sectorSubmission('Intelligent automation, RPA, and AI agents for the enterprise'), CATALOG, CTX, {
      id: TECH_ID,
      name: null,
    });
    assert.equal(v.sector?.industryId, TECH_ID);
    assert.equal(v.sector?.verification, 'quote_verified');
  });

  it('si se rechaza, la cita queda guardada (recortada) para el diagnóstico', () => {
    const translated = 'Líder en automatización de procesos con agentes de inteligencia artificial para empresas. '.repeat(4);
    const v = verifySubmission(sectorSubmission(translated), CATALOG, CTX, { id: TECH_ID, name: null });
    assert.equal(v.sector, null);
    assert.equal(v.rejected[0].reason, 'quote_not_found_in_official_page');
    assert.equal(v.rejected[0].quote?.length, REJECTED_QUOTE_MAX_CHARS);
  });
});

describe('C. instrucción a Claude', () => {
  it('pide la cita en el idioma original, sin traducir ni resumir', () => {
    const system = buildClassifierSystemPrompt(CATALOG);
    assert.match(system, /idioma original de la fuente/);
    assert.match(system, /no la traduzcas/);
  });
});
