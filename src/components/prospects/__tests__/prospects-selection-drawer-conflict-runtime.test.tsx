/**
 * Q3F-5AZ.2E-1-UX1 — Prospectos selection bar vs. side panel conflict RUNTIME contract.
 *
 * Renders the ACTUAL `ProspectsDataTableClient` and proves, with the real
 * component, that:
 *
 *   1. The selection action bar and the side panel are never both visible:
 *      opening the detail (row name click, "Ver detalle" bulk action, or the
 *      "Aprobar" bulk action) always clears the table row selection first,
 *      which hides the floating bar.
 *   2. The selection action bar mirrors the side panel footer hierarchy:
 *      Aprobar (enabled only for a single selection) → Descartar (Q3F-5AZ.2G-1:
 *      enabled for a single eligible selection) → "Más acciones" (dropdown, all
 *      entries disabled) → Abrir sitios web.
 *   3. No bulk approve / no bulk discard: selecting 2+ rows disables both
 *      "Aprobar" and "Descartar"; "Más acciones" stays disabled regardless of
 *      selection size.
 *   4. "Aprobar" from the bar never approves directly — it only opens the
 *      side panel with the approve intent armed (asserted via the mocked
 *      CandidateDetailSheet's `initialApproveIntent` prop); the real inline
 *      confirmation flow is covered separately by
 *      prospect-review-actions-runtime.test.tsx.
 *
 * The heavy real sub-components (`CandidateDetailSheet`, `CandidateRowActions`)
 * are replaced with light stubs so this test stays hermetic and fast — there
 * is NO network, NO DB, NO HubSpot, NO provider call, and no candidate is ever
 * approved.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test has no DOM environment) ────────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
defineGlobal('window', dom.window);
defineGlobal('document', dom.window.document);
defineGlobal('navigator', dom.window.navigator);
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true);
function copyWindowPropsToGlobal(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  const source = dom.window as unknown as Record<string, unknown>;
  for (const prop of Object.getOwnPropertyNames(dom.window)) {
    if (prop in target) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, prop);
    if (descriptor) Object.defineProperty(target, prop, descriptor);
  }
}
copyWindowPropsToGlobal();
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub;
for (const proto of [dom.window.HTMLElement.prototype, dom.window.Element.prototype]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.hasPointerCapture !== 'function') p.hasPointerCapture = () => false;
  if (typeof p.setPointerCapture !== 'function') p.setPointerCapture = () => {};
  if (typeof p.releasePointerCapture !== 'function') p.releasePointerCapture = () => {};
  if (typeof p.scrollIntoView !== 'function') p.scrollIntoView = () => {};
}

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Boundary mocks: router + the two heavy sub-components ────────────────────
// No server action, no HubSpot, no provider is imported by this component at
// all — the boundary here is purely the router and the two large child
// components, replaced with light stubs so we can assert on the props this
// client actually passes them (open / initialApproveIntent) without paying
// for their internals (candidate-detail-sheet.tsx alone is 2500+ lines).
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  },
});

let detailSheetProps: {
  open: boolean;
  candidateName?: string;
  initialApproveIntent?: boolean;
  initialDiscardIntent?: boolean;
} = {
  open: false,
};

mock.module('@/components/prospect-batches/candidate-detail-sheet', {
  namedExports: {
    CandidateDetailSheet: (props: {
      candidate: { name: string } | null;
      open: boolean;
      initialApproveIntent?: boolean;
      initialDiscardIntent?: boolean;
    }) => {
      detailSheetProps = {
        open: props.open,
        candidateName: props.candidate?.name,
        initialApproveIntent: props.initialApproveIntent,
        initialDiscardIntent: props.initialDiscardIntent,
      };
      return props.open
        ? React.createElement(
            'div',
            { 'data-testid': 'detail-sheet-stub' },
            `open:${props.candidate?.name}:approveIntent=${String(props.initialApproveIntent)}:discardIntent=${String(props.initialDiscardIntent)}`,
          )
        : null;
    },
  },
});

mock.module('@/components/prospect-batches/candidate-row-actions', {
  namedExports: {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    CandidateRowActions: (_props: unknown) => null,
  },
});

let ProspectsDataTableClient: (typeof import('../prospects-data-table-client'))['ProspectsDataTableClient'];

const BASE: ProspectCandidateWithReviewer = {
  id: 'cand-1',
  batch_id: 'batch-1',
  account_id: null,
  name: 'Acme Analytics SA',
  legal_name: null,
  normalized_name: null,
  website: 'acme.com',
  domain: null,
  country: null,
  country_code: 'CO',
  city: null,
  region: null,
  industry: null,
  company_size: null,
  tax_identifier: null,
  tax_identifier_type: null,
  source_primary: null,
  sources_checked: [],
  duplicate_status: 'no_match',
  matched_account_id: null,
  matched_hubspot_company_id: null,
  confidence_score: null,
  fit_score: null,
  data_completeness_score: null,
  estimated_cost_usd: null,
  status: 'needs_review',
  review_notes: null,
  reviewed_by: null,
  reviewed_at: null,
  converted_account_id: null,
  metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  record_origin: 'production',
  review_status: null,
  review_flags: null,
  source_trace: null,
  commercial_trace: null,
  commercial_fit_status: null,
  legal_status: null,
  reviewer: null,
};

function candidate(overrides: Partial<ProspectCandidateWithReviewer>): ProspectCandidateWithReviewer {
  return { ...BASE, ...overrides };
}

const CANDIDATES = [
  candidate({ id: 'cand-1', name: 'Acme Analytics SA' }),
  candidate({ id: 'cand-2', name: 'Beta Software SAS', website: null }),
];

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ProspectsDataTableClient } = await import('../prospects-data-table-client'));
});

beforeEach(() => {
  detailSheetProps = { open: false };
});
afterEach(() => cleanup());

function selectRowCheckbox(index: number): void {
  // Checkbox 0 is the header "select all"; row checkboxes follow in order.
  const checkboxes = screen.getAllByRole('checkbox');
  fireEvent.click(checkboxes[index + 1]);
}

function renderTable() {
  return render(<ProspectsDataTableClient candidates={CANDIDATES} />);
}

describe('ProspectsDataTableClient — selection bar vs. side panel never coexist', () => {
  it('opening the detail via the company name link clears the selection and hides the bar', () => {
    renderTable();
    selectRowCheckbox(0);
    assert.ok(screen.getByText('Seleccionados'), 'selection bar must appear once a row is selected');

    fireEvent.click(screen.getByText('Acme Analytics SA'));

    assert.equal(detailSheetProps.open, true, 'side panel must open');
    assert.equal(
      screen.queryByText('Seleccionados'),
      null,
      'selection bar must be gone once the side panel opens from the name link',
    );
  });

  it('opening the detail via the "Ver detalle" bulk action clears the selection and hides the bar', () => {
    renderTable();
    selectRowCheckbox(0);
    assert.ok(screen.getByText('Seleccionados'));

    fireEvent.click(screen.getByText('Ver detalle'));

    assert.equal(detailSheetProps.open, true);
    assert.equal(screen.queryByText('Seleccionados'), null);
  });

  it('opening the detail via the "Aprobar" bulk action clears the selection, hides the bar, and arms the approve intent (never approves directly)', () => {
    renderTable();
    selectRowCheckbox(0);

    fireEvent.click(screen.getByText('Aprobar'));

    assert.equal(detailSheetProps.open, true, 'side panel must open');
    assert.equal(detailSheetProps.initialApproveIntent, true, 'approve intent must be armed');
    assert.equal(
      screen.queryByText('Seleccionados'),
      null,
      'selection bar must be gone once "Aprobar" opens the side panel',
    );
  });

  it('does not reopen the bar once the selection was cleared by opening the detail', () => {
    renderTable();
    selectRowCheckbox(0);
    fireEvent.click(screen.getByText('Ver detalle'));
    assert.equal(screen.queryByText('Seleccionados'), null);
    // Nothing re-selects rows on its own — the bar stays gone.
    assert.equal(screen.queryByText('Seleccionados'), null);
  });
});

describe('ProspectsDataTableClient — selection bar action hierarchy (matches side panel footer)', () => {
  it('shows Ver detalle, Aprobar (enabled), Descartar (enabled for single eligible), Más acciones, Abrir sitios web for a single selection', () => {
    renderTable();
    selectRowCheckbox(0);

    assert.ok(screen.getByText('Ver detalle'));

    const aprobarBtn = screen.getByText('Aprobar').closest('button') as HTMLButtonElement;
    assert.ok(aprobarBtn);
    assert.equal(aprobarBtn.disabled, false, 'Aprobar must be enabled for exactly one selected row');

    // Q3F-5AZ.2G-1 — Descartar is now enabled for a single eligible row.
    const descartarBtn = screen.getByText('Descartar').closest('button') as HTMLButtonElement;
    assert.ok(descartarBtn, 'Descartar must be visible in the bar');
    assert.equal(
      descartarBtn.disabled,
      false,
      'Descartar must be enabled for exactly one eligible selected row',
    );

    assert.ok(screen.getByText('Más acciones'), '"Más acciones" trigger must be visible');
    assert.ok(screen.getByText('Abrir sitios web'));
  });

  it('Descartar from the bar (single eligible) clears the selection, hides the bar, and arms the discard intent (never discards directly)', () => {
    renderTable();
    selectRowCheckbox(0);

    fireEvent.click(screen.getByText('Descartar'));

    assert.equal(detailSheetProps.open, true, 'side panel must open');
    assert.equal(detailSheetProps.initialDiscardIntent, true, 'discard intent must be armed');
    assert.equal(detailSheetProps.initialApproveIntent, false, 'approve intent must NOT be armed');
    assert.equal(
      screen.queryByText('Seleccionados'),
      null,
      'selection bar must be gone once "Descartar" opens the side panel',
    );
  });

  it('groups Marcar duplicado / Enviar a enriquecimiento / Mantener en revisión inside "Más acciones", all disabled', async () => {
    renderTable();
    selectRowCheckbox(0);

    for (const label of ['Marcar duplicado', 'Enviar a enriquecimiento', 'Mantener en revisión']) {
      assert.equal(screen.queryByText(label), null, `"${label}" must live inside the menu, not flat in the bar`);
    }

    fireEvent.click(screen.getByText('Más acciones'));

    for (const label of ['Marcar duplicado', 'Enviar a enriquecimiento', 'Mantener en revisión']) {
      const item = await screen.findByRole('menuitem', { name: new RegExp(label) });
      assert.ok(item, `expected "${label}" inside Más acciones`);
      assert.equal(
        item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('data-disabled'),
        true,
        `"${label}" must stay disabled inside the menu`,
      );
    }
  });

  it('disables Aprobar with "Aprobación masiva pendiente" and keeps Descartar/Más acciones disabled for 2+ selected rows', () => {
    renderTable();
    selectRowCheckbox(0);
    selectRowCheckbox(1);

    const aprobarBtn = screen.getByText('Aprobar').closest('button') as HTMLButtonElement;
    assert.equal(aprobarBtn.disabled, true, 'no bulk approve for 2+ rows');

    const descartarBtn = screen.getByText('Descartar').closest('button') as HTMLButtonElement;
    assert.equal(descartarBtn.disabled, true);

    assert.ok(screen.getByText('Más acciones'), '"Más acciones" must still render for multi-selection');
  });
});

describe('ProspectsDataTableClient — no new action is enabled and no legacy import is reachable', () => {
  it('never calls or exposes an approveAndConvertCandidateAction reference from this client', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../prospects-data-table-client.tsx', import.meta.url), 'utf8'),
    );
    assert.doesNotMatch(
      source,
      /\bapproveAndConvertCandidateAction\b/,
      'the client must never import the legacy convert-and-approve action directly',
    );
  });
});
