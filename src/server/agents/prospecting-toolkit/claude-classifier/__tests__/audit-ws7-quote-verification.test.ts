/**
 * AUDIT-A1-WS7 (16-10) — el verificador de citas:
 *
 *   · el texto oculto (`hidden`, `aria-hidden="true"`, `display:none`,
 *     `visibility:hidden`) ya no cuenta como texto de la página;
 *   · una cita «cosida» con «…» (el prompt prohíbe unir frases) sigue completando
 *     datos por compatibilidad, pero se marca `quoteStitched` y NUNCA descarta.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractVisibleText, quoteAppearsInText, quoteMatchKind, stripHiddenElements } from '../page-text';
import { verifySubmission } from '../evidence-verifier';
import { decideRescue, rangeProvesBelowThreshold } from '../rescue/rescue-decision';
import type { CompanyClassificationResult } from '../types';

describe('texto oculto', () => {
  it('quita hidden, aria-hidden, display:none y visibility:hidden con su contenido anidado', () => {
    const html = `
      <body>
        <p>Somos una clínica privada en Lima.</p>
        <div hidden><div>Empresa de software con 50 empleados</div></div>
        <span aria-hidden="true">Texto para lectores no</span>
        <div style="color:red; display: none"><p>Minería a gran escala</p></div>
        <section style='visibility:hidden'>Oculto</section>
        <p>Visible al final.</p>
      </body>`;
    const text = extractVisibleText(html);
    assert.match(text, /clínica privada/);
    assert.match(text, /Visible al final/);
    for (const hidden of ['software con 50', 'lectores no', 'Minería', 'Oculto']) {
      assert.ok(!text.includes(hidden), hidden);
    }
  });

  it('no confunde atributos parecidos', () => {
    const html = '<div class="is-hidden" data-hidden="x">Se ve</div><input type="hidden" value="x"><p>Sigue</p>';
    assert.match(stripHiddenElements(html), /Se ve/);
    assert.match(extractVisibleText(html), /Sigue/);
  });
});

describe('citas cosidas', () => {
  const page = 'Somos una empresa de tecnología. Más abajo. Contamos con 40 colaboradores en tres países.';

  it('exacta vs cosida', () => {
    assert.equal(quoteMatchKind('una empresa de tecnología', page), 'exact');
    assert.equal(quoteMatchKind('una empresa de tecnología … con 40 colaboradores en tres', page), 'stitched');
    assert.equal(quoteMatchKind('una empresa minera', page), null);
    // Compatibilidad: sigue «apareciendo».
    assert.equal(quoteAppearsInText('una empresa de tecnología … con 40 colaboradores en tres', page), true);
  });

  it('el verificador marca quoteStitched y la decisión no descarta con ella', () => {
    const verified = verifySubmission(
      {
        sector: null,
        employee_range: {
          min: 11,
          max: 50,
          quote: 'una empresa de tecnología … con 40 colaboradores en tres',
          source_url: 'https://empresa.pe/',
          confidence: 0.95,
        },
        fits_requested_industry: null,
        is_operating_company: true,
      } as unknown as Parameters<typeof verifySubmission>[0],
      [],
      { pageUrls: ['https://empresa.pe/'], pageText: page, searchResultUrls: [] } as unknown as Parameters<typeof verifySubmission>[2],
      { id: null, name: null },
    );
    assert.equal(verified.employeeRange?.verification, 'quote_verified');
    assert.equal(verified.employeeRange?.quoteStitched, true);
    assert.equal(rangeProvesBelowThreshold({ ...verified.employeeRange!, max: 50 }, 200), false);

    const result = {
      candidateId: 'c1',
      outcome: 'classified',
      sector: {
        industryId: 'tec', industryName: 'Tecnología', subindustryId: null, subindustryName: null,
        matchesCurrentIndustry: true, quote: 'una empresa de tecnología', sourceUrl: 'https://empresa.pe/',
        confidence: 0.9, verification: 'quote_verified',
      },
      employeeRange: verified.employeeRange,
      rejected: [],
      isOperatingCompany: true,
      pageFinalUrl: 'https://empresa.pe/',
      usage: null,
      errorCode: null,
      durationMs: 1,
    } as unknown as CompanyClassificationResult;
    assert.notEqual(decideRescue(result, { icpMinEmployees: 200 }).kind, 'discard');
  });
});
