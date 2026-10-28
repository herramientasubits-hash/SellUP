/**
 * «Por qué fue encontrado» de una competidora — el motivo del juez se ve
 * (auditoría 21-10: sólo decía «Competidor de X», sin razón ni enlace).
 */

import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CandidateFoundReasonSection } from '../candidate-detail-insight-sections';
import { CompetitorSmallCompaniesSection } from '../competitor-search/competitor-small-companies-section';

function render(relationship: Record<string, unknown>): string {
  return renderToStaticMarkup(
    <CandidateFoundReasonSection
      searchTrace={undefined}
      sourceTitle={undefined}
      sourceSnippet={undefined}
      relationship={relationship}
    />,
  );
}

describe('CandidateFoundReasonSection — competidoras', () => {
  it('muestra el motivo del juez aunque no haya página de evidencia', () => {
    const html = render({
      kind: 'competitor_of',
      reference_company_name: 'Indalum',
      evidence_url: null,
      evidence: 'Extruye y vende perfiles de aluminio para construcción',
    });
    assert.match(html, /Competidor de/);
    assert.match(html, /Por qué compite/);
    assert.match(html, /Extruye y vende perfiles de aluminio para construcción/);
    assert.doesNotMatch(html, /Página que lo prueba/);
  });

  it('sin motivo no pinta la fila vacía', () => {
    const html = render({ kind: 'competitor_of', reference_company_name: 'Indalum', evidence: '   ' });
    assert.doesNotMatch(html, /Por qué compite/);
  });

  it('un proveedor no muestra «Por qué compite»', () => {
    const html = render({ kind: 'supplier_of', reference_company_name: 'Ecopetrol', evidence: 'Le vende tuberías' });
    assert.doesNotMatch(html, /Por qué compite/);
  });
});

describe('CompetitorSmallCompaniesSection — «Competidoras pequeñas»', () => {
  const competitorBatch = {
    search_mode: 'competitors',
    competitor_search: { reference: { name: 'Indalum', domain: 'indalum.com.mx', description: null, account_id: null } },
  };
  const small = {
    id: 'c1',
    name: 'Alumex',
    domain: 'alumex.cl',
    website: 'https://alumex.cl',
    country_code: 'CL',
    status: 'discarded',
    metadata: {
      relationship: { kind: 'competitor_of', reference_company_name: 'Indalum' },
      claude_rescue: { decision: 'discard', discard_reason: 'claude_size_below_min' },
    },
  };

  it('en un lote de competidores con pequeñas, se ve con su cuenta y su aviso', () => {
    const html = renderToStaticMarkup(<CompetitorSmallCompaniesSection batchMetadata={competitorBatch} candidates={[small]} />);
    assert.match(html, /Competidoras pequeñas/);
    assert.match(html, /\(1\)/);
    assert.match(html, /no van a revisión ni a\s+HubSpot/);
  });

  it('sin pequeñas, o fuera de un lote de competidores, no pinta nada', () => {
    assert.equal(renderToStaticMarkup(<CompetitorSmallCompaniesSection batchMetadata={competitorBatch} candidates={[]} />), '');
    assert.equal(renderToStaticMarkup(<CompetitorSmallCompaniesSection batchMetadata={{}} candidates={[small]} />), '');
  });
});

describe('Avisos del lote de competidores (Fase C/D)', () => {
  it('«Sin sitio web» se ve con sus propuestas; sin ellas no pinta', async () => {
    const { CompetitorWithoutWebsiteSection } = await import('../competitor-search/competitor-without-website-section');
    const html = renderToStaticMarkup(
      <CompetitorWithoutWebsiteSection batchMetadata={{ competitor_without_website: [{ name: 'LabVet Norte', evidence: 'Vacunas', sourceUrl: null }] }} />,
    );
    assert.match(html, /Sin sitio web/);
    assert.match(html, /\(1\)/);
    assert.equal(renderToStaticMarkup(<CompetitorWithoutWebsiteSection batchMetadata={{}} />), '');
  });

  it('el aviso del juez aparece sólo si no revisó todo', async () => {
    const { CompetitorJudgeNotice } = await import('../competitor-search/competitor-judge-notice');
    const html = renderToStaticMarkup(
      <CompetitorJudgeNotice batchMetadata={{ competitor_free_sources: { competitor_judge_by_source: { free_layer: { unanswered: 1 } } } }} />,
    );
    assert.match(html, /Rumbo no pudo revisar parte de las fuentes gratuitas/);
    assert.equal(renderToStaticMarkup(<CompetitorJudgeNotice batchMetadata={{}} />), '');
  });
});
