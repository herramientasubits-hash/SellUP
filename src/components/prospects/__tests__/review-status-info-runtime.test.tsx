/**
 * Q3F-5AZ.2D-1-UX1 — "Estado de revisión" informational block RUNTIME contract.
 *
 * Renders the ACTUAL `ReviewStatusInfo` component (real render, not a static
 * scan). Proves it is purely informational: no buttons anywhere, for any
 * candidate state — the operative Aprobar action lives in
 * `prospect-review-actions.tsx` (drawer footer) instead.
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

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ReviewDecisionCandidate } from '../prospect-review-decision-utils';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ReviewStatusInfo: (typeof import('../review-status-info'))['ReviewStatusInfo'];

const BASE: ReviewDecisionCandidate = {
  id: 'cand-1',
  name: 'Acme Analytics SA',
  status: 'needs_review',
  recordOrigin: 'production',
  duplicateStatus: 'no_match',
  matchedHubspotCompanyId: null,
  reviewedAt: null,
};

function candidate(overrides: Partial<ReviewDecisionCandidate>): ReviewDecisionCandidate {
  return { ...BASE, ...overrides };
}

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ ReviewStatusInfo } = await import('../review-status-info'));
});

beforeEach(() => cleanup());
afterEach(() => cleanup());

describe('ReviewStatusInfo — purely informational', () => {
  it('renders the "Estado de revisión" header', () => {
    render(<ReviewStatusInfo candidate={candidate({})} />);
    assert.ok(screen.getByText('Estado de revisión'));
  });

  it('never renders any button, for any candidate state', () => {
    for (const status of ['needs_review', 'generated', 'normalized', 'approved', 'discarded', 'duplicate', 'converted_to_account']) {
      cleanup();
      render(<ReviewStatusInfo candidate={candidate({ status })} />);
      assert.equal(screen.queryAllByRole('button').length, 0, `no buttons for status ${status}`);
    }
  });

  it('shows the "Aprobado" pill with reviewedAt date for status approved', () => {
    render(
      <ReviewStatusInfo candidate={candidate({ status: 'approved', reviewedAt: '2026-07-22T10:00:00Z' })} />,
    );
    assert.ok(screen.getByText('Aprobado'));
    assert.ok(screen.getByText(/Aún no ha sido convertido en cuenta/i));
    assert.ok(screen.getByText(/Aprobado el/i));
  });

  it('shows read-only terminal copy for discarded / duplicate / converted', () => {
    for (const [status, label] of [
      ['discarded', 'Descartado'],
      ['duplicate', 'Marcado como duplicado'],
      ['converted_to_account', 'Convertido en cuenta'],
    ] as const) {
      cleanup();
      render(<ReviewStatusInfo candidate={candidate({ status })} />);
      assert.ok(screen.getByText(label), `expected "${label}" for status ${status}`);
    }
  });

  it('shows the block reason for a needs_review row that is not clean production', () => {
    render(<ReviewStatusInfo candidate={candidate({ recordOrigin: 'sandbox' })} />);
    assert.ok(screen.getByText(/producción limpia/i));
  });

  it('shows a strong warning for a possible_duplicate candidate', () => {
    render(<ReviewStatusInfo candidate={candidate({ duplicateStatus: 'possible_duplicate' })} />);
    assert.ok(screen.getByText(/posible coincidencia\. Revisa antes de aprobar/i));
  });

  it('shows a strong warning for a HubSpot-matched candidate', () => {
    render(<ReviewStatusInfo candidate={candidate({ matchedHubspotCompanyId: 'hs-123' })} />);
    assert.ok(screen.getByText(/Coincidencia con una empresa en HubSpot/i));
  });
});
