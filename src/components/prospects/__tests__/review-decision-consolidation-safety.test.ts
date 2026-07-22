// Q3F-5AZ.2D-1-UX1 — Action-surface relocation safety (non-live, static scan).
//
// Proves by construction that moving "Aprobar" out of the Validación tab
// content and into the drawer's own action zone (footer):
//   1. Still reuses the ALREADY VALIDATED approvePendingReviewCandidateAction —
//      no new parallel action, no conversion, no HubSpot, no providers.
//   2. Removed the big block-of-5-buttons from the Validación tab content —
//      the tab now only renders informational copy.
//   3. Wires the split components (ReviewStatusInfo + ProspectReviewActions)
//      into the official Prospectos drawer, with the actions in the footer
//      (outside the Tabs, so available regardless of active tab).

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

const UTILS_SRC = stripLineComments(
  readFileSync(join(COMPONENTS, 'prospect-review-decision-utils.ts'), 'utf8'),
);
const STATUS_INFO_SRC = stripLineComments(
  readFileSync(join(COMPONENTS, 'review-status-info.tsx'), 'utf8'),
);
const ACTIONS_SRC = stripLineComments(
  readFileSync(join(COMPONENTS, 'prospect-review-actions.tsx'), 'utf8'),
);
const PANEL_RAW = readFileSync(join(COMPONENTS, 'prospects-module-panel.tsx'), 'utf8');
const TABLE_SRC = stripLineComments(
  readFileSync(join(COMPONENTS, 'prospects-data-table-client.tsx'), 'utf8'),
);
const SHEET_SRC = readFileSync(
  join(SRC, 'components', 'prospect-batches', 'candidate-detail-sheet.tsx'),
  'utf8',
);

describe('prospect-review-actions — reuses the validated action, no new action', () => {
  it('imports approvePendingReviewCandidateAction (single source of truth)', () => {
    assert.ok(ACTIONS_SRC.includes('approvePendingReviewCandidateAction'));
    assert.ok(ACTIONS_SRC.includes('@/modules/prospect-review/approve-actions'));
  });

  it("does not perform a direct DB write or define a 'use server' action", () => {
    for (const verb of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(', "'use server'"]) {
      assert.equal(ACTIONS_SRC.includes(verb), false, `action zone must not contain ${verb}`);
    }
  });
});

describe('no conversion / HubSpot / providers across the relocated surfaces', () => {
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
  for (const [label, src] of [
    ['prospect-review-decision-utils.ts', UTILS_SRC],
    ['review-status-info.tsx', STATUS_INFO_SRC],
    ['prospect-review-actions.tsx', ACTIONS_SRC],
  ] as const) {
    for (const token of forbidden) {
      it(`${label} does not reference "${token}"`, () => {
        assert.equal(src.includes(token), false, `${label} must not reference ${token}`);
      });
    }
  }

  it('the new context-menu / bulk-action-bar Aprobar wiring does not call approveAndConvertCandidateAction directly', () => {
    assert.equal(TABLE_SRC.includes('approveAndConvertCandidateAction'), false);
  });
});

describe('action zone renders the four not-yet-available actions as disabled context', () => {
  it('renders the disabled labels', () => {
    for (const label of [
      'Descartar',
      'Marcar duplicado',
      'Enviar a enriquecimiento',
      'Mantener en revisión',
    ]) {
      assert.ok(ACTIONS_SRC.includes(label), `expected disabled action label "${label}"`);
    }
  });

  it('the informational block (review-status-info.tsx) does NOT render those action labels', () => {
    for (const label of ['Descartar', 'Marcar duplicado', 'Enviar a enriquecimiento', 'Mantener en revisión']) {
      assert.equal(STATUS_INFO_SRC.includes(label), false, `status info must not render "${label}"`);
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

describe('drawer wiring — action zone relocated to the footer, tab content is informational-only', () => {
  it('no longer renders the removed ReviewDecisionSection (big block of buttons)', () => {
    assert.equal(SHEET_SRC.includes('ReviewDecisionSection'), false);
  });

  it('renders ReviewStatusInfo (informational) inside the candidate detail sheet', () => {
    assert.ok(SHEET_SRC.includes('ReviewStatusInfo'));
    assert.ok(SHEET_SRC.includes('@/components/prospects/review-status-info'));
  });

  it('renders ProspectReviewActions (the action zone) via the DrawerShell footer prop', () => {
    assert.ok(SHEET_SRC.includes('ProspectReviewActions'));
    assert.ok(SHEET_SRC.includes('@/components/prospects/prospect-review-actions'));
    assert.ok(SHEET_SRC.includes('footer={'));
  });

  it('the Validación tab content no longer renders the ProspectReviewActions button row inline', () => {
    const start = SHEET_SRC.indexOf('value="validacion"');
    assert.ok(start > -1, 'expected a TabsContent value="validacion" block');
    // The Validación TabsContent is the last TabsContent before </Tabs>; slice
    // between it and the closing </Tabs> to scope the check to tab content.
    const closeTabs = SHEET_SRC.indexOf('</Tabs>', start);
    assert.ok(closeTabs > start, 'expected a closing </Tabs> after the Validación tab');
    const validacionBlock = SHEET_SRC.slice(start, closeTabs);
    assert.equal(
      validacionBlock.includes('<ProspectReviewActions'),
      false,
      'ProspectReviewActions must render in the footer action zone, not inline inside the Validación tab',
    );
    assert.ok(validacionBlock.includes('<ReviewStatusInfo'), 'expected ReviewStatusInfo inside the Validación tab');
  });

  it('supports opening with the approve intent armed (row menu / selection bar)', () => {
    assert.ok(SHEET_SRC.includes('initialApproveIntent'));
    assert.ok(SHEET_SRC.includes('onApproveIntentConsumed'));
  });
});

describe('row menu / context menu — Aprobar opens the drawer, never approves directly', () => {
  it('the context menu Aprobar entry opens the detail drawer with approveIntent, not a direct approve call', () => {
    assert.ok(TABLE_SRC.includes("id: 'approve'"));
    assert.ok(TABLE_SRC.includes('approveIntent: true'));
    assert.equal(TABLE_SRC.includes('approvePendingReviewCandidateAction'), false);
  });
});

describe('selection action bar — single-selection Aprobar, bulk approve out of scope', () => {
  it('disables Aprobar unless exactly one row is selected', () => {
    assert.ok(TABLE_SRC.includes('rows.length !== 1'));
  });

  it('shows the "Aprobación masiva pendiente" copy for 2+ selected rows', () => {
    assert.ok(TABLE_SRC.includes('Aprobación masiva pendiente'));
  });
});
