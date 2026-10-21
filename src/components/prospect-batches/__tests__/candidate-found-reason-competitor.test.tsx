/**
 * «Por qué fue encontrado» de una competidora — el motivo del juez se ve
 * (auditoría 21-10: sólo decía «Competidor de X», sin razón ni enlace).
 */

import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CandidateFoundReasonSection } from '../candidate-detail-insight-sections';

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
