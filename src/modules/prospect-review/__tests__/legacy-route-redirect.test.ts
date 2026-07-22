/**
 * Q3F-5AZ.2F — Retire the internal pending-review route.
 *
 * `/prospect-batches/review` is no longer an operativa surface: human review of
 * prospects lives in Empresas → Prospectos (`/accounts?tab=prospectos`). This
 * suite guards that the legacy route:
 *   1. redirects to the official Prospectos surface (runtime contract), and
 *   2. no longer renders the old queue (`ReviewQueueClient`) or reads the
 *      pending-review data (`getPendingReviewQueue`) from the public page
 *      (static-source contract).
 *
 * The former queue components stay in the tree as internal, now-unreferenced
 * code (still exercised by the modal runtime/static suites), so this guard is
 * about the PAGE entry point, not the module deletion.
 *
 * Pure guard — no DB, no Supabase, no server actions, no HubSpot, no providers.
 * Uses the Node.js built-in test runner with module mocks.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(
  HERE,
  '..',
  '..',
  '..',
  'app',
  '(sellup)',
  'prospect-batches',
  'review',
  'page.tsx',
);
const PAGE_SRC = readFileSync(PAGE_PATH, 'utf8');

describe('Q3F-5AZ.2F — legacy /prospect-batches/review route retirement', () => {
  it('redirects to the official Prospectos surface at runtime', async () => {
    const calls: string[] = [];
    mock.module('next/navigation', {
      namedExports: {
        redirect: (url: string) => {
          calls.push(url);
          // Real Next `redirect` throws NEXT_REDIRECT to halt rendering; mirror
          // that so the page function stops exactly like production.
          throw new Error('NEXT_REDIRECT');
        },
      },
    });

    const mod = await import('../../../app/(sellup)/prospect-batches/review/page');
    assert.equal(typeof mod.default, 'function');
    assert.throws(() => (mod.default as () => unknown)(), /NEXT_REDIRECT/);

    assert.equal(calls.length, 1, 'the page must redirect exactly once');
    assert.equal(
      calls[0],
      '/accounts?tab=prospectos',
      'the legacy route must redirect to the official Prospectos surface',
    );
    // The redirect target must be the canonical constant, not a hardcoded copy.
    assert.equal(calls[0], PROSPECTOS_TAB_ROUTE);

    mock.reset();
  });

  it('no longer renders the old review queue from the public page', () => {
    assert.ok(
      PAGE_SRC.includes('redirect('),
      'page must call redirect()',
    );
    assert.ok(
      !PAGE_SRC.includes('ReviewQueueClient'),
      'the retired page must not render ReviewQueueClient',
    );
    assert.ok(
      !PAGE_SRC.includes('getPendingReviewQueue'),
      'the retired page must not read the pending-review queue',
    );
  });
});
