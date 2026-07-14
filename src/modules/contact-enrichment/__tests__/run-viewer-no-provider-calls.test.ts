/**
 * Static offline guard — read-only run viewer never touches provider
 * execution, candidate mutation, or HubSpot sync (Hito 17B.4X.7C.3E.2).
 *
 * This repo has no local live-Postgres/Apollo/Lusha test harness, so the
 * "no provider calls" requirement is proven here as a static source-text
 * assertion over the three new files that make up the route (mirrors the
 * technique used in request-attempt-persistence-migration.test.ts for
 * migration 086: read the file as text, assert on its content). If any of
 * these files start importing a provider-execution or mutation action, this
 * test fails the build before it ever reaches a browser.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  page: join(ROOT, 'src/app/(sellup)/contact-enrichment/runs/[runId]/page.tsx'),
  actions: join(ROOT, 'src/modules/contact-enrichment/run-viewer-actions.ts'),
  viewer: join(ROOT, 'src/components/contact-enrichment/contact-enrichment-run-viewer.tsx'),
};

const sources = {
  page: readFileSync(FILES.page, 'utf-8'),
  actions: readFileSync(FILES.actions, 'utf-8'),
  viewer: readFileSync(FILES.viewer, 'utf-8'),
};

const FORBIDDEN_IDENTIFIERS = [
  'startContactEnrichmentRunAction',
  'runContactEnrichmentApolloAction',
  'runContactEnrichmentLushaAction',
  'runContactEnrichmentApolloForRequestAction',
  'runContactEnrichmentLushaForRequestAction',
  'executeContactEnrichmentApolloRun',
  'executeContactEnrichmentLushaRun',
  'approveContactCandidate',
  'discardContactCandidate',
  'runApproveCandidate',
  'runDiscardCandidate',
  'syncContactToHubSpot',
  'resolveOrCreateAccountForHubSpotCandidate',
];

describe('Read-only run viewer — no provider/mutation identifiers', () => {
  for (const [fileKey, source] of Object.entries(sources)) {
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      it(`${fileKey} does not reference ${identifier}`, () => {
        assert.doesNotMatch(source, new RegExp(identifier));
      });
    }
  }
});

describe('Read-only run viewer — no provider client imports', () => {
  it('actions file only imports from run-viewer-read-model-core and Supabase clients', () => {
    assert.doesNotMatch(sources.actions, /contact-enrichment-toolkit\/(apollo|lusha)-enrichment-runner/);
    assert.doesNotMatch(sources.actions, /contact-enrichment-runner/);
  });

  it('page does not import candidate-review-core (approve/discard) or hubspot-account-resolver', () => {
    assert.doesNotMatch(sources.page, /candidate-review-core/);
    assert.doesNotMatch(sources.page, /hubspot-account-resolver/);
  });
});

describe('Read-only run viewer — no mutating Supabase calls', () => {
  it('actions file has no .insert(/.update(/.delete(/.upsert( calls', () => {
    assert.doesNotMatch(sources.actions, /\.(insert|update|delete|upsert)\s*\(/);
  });
});

describe('Read-only run viewer — no clickable provider/approval controls', () => {
  it('viewer component renders no <button> or onClick handler', () => {
    assert.doesNotMatch(sources.viewer, /<button/i);
    assert.doesNotMatch(sources.viewer, /onClick/);
  });

  it('viewer component does not import the Button component', () => {
    assert.doesNotMatch(sources.viewer, /from ['"]@\/components\/ui\/button['"]/);
  });
});

describe('Read-only run viewer — invalid/not-found handling (B)', () => {
  it('page calls notFound() when the run is missing', () => {
    assert.match(sources.page, /if\s*\(!run\)\s*notFound\(\)/);
  });

  it('page imports notFound from next/navigation', () => {
    assert.match(sources.page, /import\s*\{\s*notFound\s*\}\s*from\s*['"]next\/navigation['"]/);
  });
});
