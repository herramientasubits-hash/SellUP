// Q3F-5AZ.2D-1 — Consolidation safety (non-live, static scan).
//
// Proves by construction that consolidating the approve action into the
// Prospectos drawer:
//   1. Reuses the ALREADY VALIDATED approvePendingReviewCandidateAction — no new
//      parallel action, no conversion, no HubSpot, no providers.
//   2. Renames the misleading KPI copy ("Listos para aprobar" → "Sin bloqueos
//      detectados") without touching the KPI's underlying count logic.
//   3. Wires the section into the official Prospectos drawer surface.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = join(HERE, '..'); // src/components/prospects
const SRC = join(COMPONENTS, '..', '..'); // src

/** Strips `//` line comments so forbidden-token scans reflect code, not prose. */
function stripLineComments(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const SECTION_SRC = stripLineComments(
  readFileSync(join(COMPONENTS, 'review-decision-section.tsx'), 'utf8'),
);
const PANEL_RAW = readFileSync(join(COMPONENTS, 'prospects-module-panel.tsx'), 'utf8');
const SHEET_SRC = readFileSync(
  join(SRC, 'components', 'prospect-batches', 'candidate-detail-sheet.tsx'),
  'utf8',
);

describe('review-decision-section — reuses the validated action, no new action', () => {
  it('imports approvePendingReviewCandidateAction (single source of truth)', () => {
    assert.ok(SECTION_SRC.includes('approvePendingReviewCandidateAction'));
    assert.ok(SECTION_SRC.includes('@/modules/prospect-review/approve-actions'));
  });

  it("does not perform a direct DB write or define a 'use server' action", () => {
    for (const verb of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(', "'use server'"]) {
      assert.equal(SECTION_SRC.includes(verb), false, `section must not contain ${verb}`);
    }
  });
});

describe('review-decision-section — no conversion / HubSpot / providers', () => {
  const forbidden = [
    'approveAndConvert',
    'convertCandidate',
    "from('accounts')",
    'createHubSpotCompany',
    'syncToHubspot',
    'apollo',
    'tavily',
    'lusha',
    'runEnrichment',
  ];
  for (const token of forbidden) {
    it(`does not reference "${token}"`, () => {
      assert.equal(SECTION_SRC.includes(token), false, `section must not reference ${token}`);
    });
  }

  it('renders the four not-yet-available actions as disabled context only', () => {
    for (const label of [
      'Descartar',
      'Marcar duplicado',
      'Enviar a enriquecimiento',
      'Mantener en revisión',
    ]) {
      assert.ok(SECTION_SRC.includes(label), `expected disabled action label "${label}"`);
    }
  });
});

describe('KPI copy — renamed, count logic untouched', () => {
  it('renames "Listos para aprobar" to "Sin bloqueos detectados"', () => {
    assert.ok(PANEL_RAW.includes('Sin bloqueos detectados'));
    assert.ok(PANEL_RAW.includes('Candidatos sin señales bloqueantes'));
    assert.ok(!PANEL_RAW.includes('Listos para aprobar'), 'old KPI label must be gone');
  });

  it('still binds the KPI to the existing readyForApproval count (no logic rewrite)', () => {
    assert.ok(PANEL_RAW.includes('kpis.readyForApproval'));
  });

  it('keeps "Pendientes de revisión" KPI', () => {
    assert.ok(PANEL_RAW.includes('Pendientes de revisión'));
  });
});

describe('drawer wiring — official Prospectos surface', () => {
  it('renders ReviewDecisionSection inside the candidate detail sheet', () => {
    assert.ok(SHEET_SRC.includes('ReviewDecisionSection'));
    assert.ok(SHEET_SRC.includes('@/components/prospects/review-decision-section'));
  });
});
