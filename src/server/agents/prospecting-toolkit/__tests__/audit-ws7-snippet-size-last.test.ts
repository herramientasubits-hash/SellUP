/**
 * AUDIT-A1-WS7 (16-10) — el tamaño leído con regex del snippet de búsqueda es la
 * ÚLTIMA fuente y nunca descarta sola.
 *
 *   · «beneficiamos a 10.000 personas» (ONG) ya no es tamaño: `personas`,
 *     `people` y `equipo` no son palabras de empleo.
 *   · «despidió a 50 empleados» ⇒ 11-50 del snippet NO gana a HubSpot (3000) ni
 *     al registro oficial; sin otra fuente, queda para revisión (no se omite).
 *   · Por encima del umbral el snippet puede aprobar como estimado (con persona
 *     que revisa), pero el rescate no lo trata como «otro proveedor ya lo aprobó».
 *   · La «evidencia» de Claude busca empresas pierde sus cifras de empleados.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseEmployeeSizeFromText, stripEmployeeCountClaims } from '../employee-size-text-parser';
import { buildCandidateRichProfileV1 } from '../candidate-rich-profile';
import { resolveEmployeeSizeForIcpGate } from '../employee-size-resolver';
import { evaluateIcpSizeGate, resolveIcpSizeGateWriterAction } from '../icp-size-gate';
import { icpGatePassed } from '../claude-classifier/rescue/reassign-stored';
import { storedSmallSizeDiscard } from '../claude-classifier/rescue/rescue-decision';

function snippetProfileSize(title: string, snippet: string) {
  return buildCandidateRichProfileV1({
    name: 'Empresa',
    website: 'https://empresa.com',
    domain: 'empresa.com',
    sourceUrl: 'https://news.example/nota',
    sourceTitle: title,
    sourceSnippet: snippet,
    clockFn: () => '2026-10-16T00:00:00.000Z',
  }).size;
}

function decide(input: Parameters<typeof resolveEmployeeSizeForIcpGate>[0]) {
  const resolved = resolveEmployeeSizeForIcpGate({ threshold: 200, referenceYear: 2026, ...input });
  const gate = evaluateIcpSizeGate(resolved.icpInput);
  return { resolved, gate, action: resolveIcpSizeGateWriterAction(gate).action };
}

describe('AUDIT-A1-WS7 — palabras de empleo', () => {
  it('«personas», «people» y «equipo» ya no son tamaño', () => {
    assert.equal(parseEmployeeSizeFromText('Beneficiamos a 10.000 personas en Colombia'), null);
    assert.equal(parseEmployeeSizeFromText('We serve 5,000 people every day'), null);
    assert.equal(parseEmployeeSizeFromText('Un equipo de 30 equipo comercial 30 equipo'), null);
  });

  it('«empleados», «colaboradores», «employees» siguen contando', () => {
    assert.equal(parseEmployeeSizeFromText('más de 1.000 empleados'), '1001-5000');
    assert.equal(parseEmployeeSizeFromText('500 colaboradores'), '201-500');
    assert.equal(parseEmployeeSizeFromText('201-500 employees'), '201-500');
  });

  it('el perfil de una ONG con «10.000 personas» queda sin tamaño', () => {
    const size = snippetProfileSize('Fundación X', 'Beneficiamos a 10.000 personas al año');
    assert.equal(size.status, 'unknown');
    assert.equal(size.estimated_range, null);
  });
});

describe('AUDIT-A1-WS7 — el snippet es la última fuente', () => {
  const smallSnippet = snippetProfileSize('Empresa despide', 'La empresa despidió a 50 empleados');

  it('el perfil lo marca como source_snippet', () => {
    assert.equal(smallSnippet.source, 'source_snippet');
    assert.equal(smallSnippet.estimated_range, '11-50');
  });

  it('HubSpot (3000) gana al snippet 11-50 y la fila pasa', () => {
    const { resolved, action } = decide({ richProfileSize: smallSnippet, matchedHubspotEmployees: 3000 });
    assert.equal(resolved.selectedSource, 'hubspot_number_of_employees');
    assert.equal(action, 'pass');
  });

  it('el registro oficial gana al snippet', () => {
    const { resolved, action } = decide({
      richProfileSize: smallSnippet,
      officialRegistryWorkforce: { workers: 3000, year: 2025, source: 'pe_sunat' },
    });
    assert.equal(resolved.selectedSource, 'official_registry_workers');
    assert.equal(action, 'pass');
  });

  it('company_size del proveedor gana al snippet', () => {
    const { resolved } = decide({ richProfileSize: smallSnippet, candidateCompanySize: '1001-5000' });
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });

  it('un snippet solo bajo el umbral NO omite: queda para revisión', () => {
    const { resolved, action } = decide({ richProfileSize: smallSnippet });
    assert.equal(resolved.selectedSource, 'unknown');
    assert.equal(action, 'needs_review');
    assert.ok(resolved.attemptedSources.some((a) => a.source === 'source_snippet' && a.usable === false));
  });

  // AUDIT-HARDENING-1 (decisión de la dueña 16-10) — antes un snippet solo, por
  // encima del umbral, aprobaba como «estimado». Una regex sobre texto libre no
  // aprueba ni descarta: el tamaño queda desconocido y la fila va a revisión
  // (donde Claude lo completa con una cita verificable).
  it('un snippet solo por encima del umbral NO aprueba: el tamaño queda desconocido y va a revisión', () => {
    const big = snippetProfileSize('Grupo', 'con más de 5.000 empleados en la región');
    const { resolved, action } = decide({ richProfileSize: big });
    assert.equal(resolved.selectedSource, 'unknown');
    assert.equal(resolved.confidence, 'unknown');
    assert.equal(action, 'needs_review');
    // El rango leído se conserva para quien revisa.
    const attempt = resolved.attemptedSources.find((a) => a.source === 'source_snippet');
    assert.equal(attempt?.usable, false);
    assert.ok(attempt?.value);
  });

  it('un rango enriquecido (no snippet) conserva la prioridad máxima', () => {
    const { resolved } = decide({
      richProfileSize: { estimated_range: '51-200', status: 'estimated', source: 'website' },
      matchedHubspotEmployees: 3000,
    });
    assert.equal(resolved.selectedSource, 'rich_profile_size');
  });
});

describe('AUDIT-A1-WS7 — rescate: un pase por snippet no protege de Claude', () => {
  const snippetPass = {
    icp_size_gate: { decision: 'pass', size_status: 'estimated_above_threshold' },
    rich_profile: { size: { employee_size_resolution: { selected_source: 'source_snippet' } } },
  };
  const hubspotPass = {
    icp_size_gate: { decision: 'pass', size_status: 'confirmed_above_threshold' },
    rich_profile: { size: { employee_size_resolution: { selected_source: 'hubspot_number_of_employees' } } },
  };

  it('icpGatePassed ignora el pase por snippet', () => {
    assert.equal(icpGatePassed(snippetPass), false);
    assert.equal(icpGatePassed(hubspotPass), true);
    assert.equal(icpGatePassed({ icp_size_gate: { decision: 'pass' } }), true);
  });

  it('storedSmallSizeDiscard puede descartar si el pase era sólo del snippet', () => {
    const claude = {
      claude_classification: {
        employee_range: {
          min: 11, max: 50, verification: 'quote_verified', confidence: 0.9,
          quote: 'De 11 a 50 empleados', source_url: 'https://empresa.com/nosotros',
        },
      },
    };
    assert.equal(storedSmallSizeDiscard({ ...snippetPass, ...claude }, 200)?.kind, 'discard');
    assert.equal(storedSmallSizeDiscard({ ...hubspotPass, ...claude }, 200), null);
  });
});

describe('AUDIT-A1-WS7 — evidencia escrita por Claude', () => {
  it('stripEmployeeCountClaims quita las cifras de empleados y conserva el resto', () => {
    const out = stripEmployeeCountClaims('Empresa de software con más de 500 empleados, sede en Lima.');
    assert.equal(parseEmployeeSizeFromText(out), null);
    assert.match(out ?? '', /Empresa de software/);
    assert.match(out ?? '', /sede en Lima/);
  });

  it('null queda null', () => {
    assert.equal(stripEmployeeCountClaims(null), null);
  });
});
