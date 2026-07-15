/**
 * Static offline guard — the new automatic-routing action stays dark
 * (Hito 17B.4X.7C.5C). This repo has no local live-Postgres/Apollo/Lusha
 * test harness, so "nothing else wires to it yet" is proven as a static
 * source-text assertion (same technique as run-viewer-no-provider-calls.test.ts
 * and contact-enrichment-routing-orchestrator.test.ts's scenario J).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  manualActions: join(ROOT, 'src/modules/contact-enrichment/actions.ts'),
  wizard: join(ROOT, 'src/components/contact-enrichment/contact-enrichment-chat-wizard.tsx'),
  automaticActions: join(ROOT, 'src/modules/contact-enrichment/automatic-routing-actions.ts'),
  automaticCore: join(ROOT, 'src/modules/contact-enrichment/automatic-routing-action-core.ts'),
  apolloRunner: join(ROOT, 'src/server/agents/contact-enrichment-toolkit/apollo-enrichment-runner.ts'),
  lushaRunner: join(ROOT, 'src/server/agents/contact-enrichment-toolkit/lusha-enrichment-runner.ts'),
};

const sources = {
  manualActions: readFileSync(FILES.manualActions, 'utf-8'),
  wizard: readFileSync(FILES.wizard, 'utf-8'),
  automaticActions: readFileSync(FILES.automaticActions, 'utf-8'),
  automaticCore: readFileSync(FILES.automaticCore, 'utf-8'),
  apolloRunner: readFileSync(FILES.apolloRunner, 'utf-8'),
  lushaRunner: readFileSync(FILES.lushaRunner, 'utf-8'),
};

describe('Manual per-provider actions stay untouched by automatic routing', () => {
  it('actions.ts does not reference the automatic-routing action, its core, or the orchestrator', () => {
    assert.doesNotMatch(sources.manualActions, /runAutomaticContactEnrichmentForRequestAction/);
    assert.doesNotMatch(sources.manualActions, /automatic-routing-action/);
    assert.doesNotMatch(sources.manualActions, /contact-enrichment-routing-orchestrator/);
    assert.doesNotMatch(sources.manualActions, /runAutomaticContactEnrichmentFallbackForRequest/);
  });
});

describe('UI stays on manual actions only', () => {
  it('wizard does not import or call the automatic-routing action', () => {
    assert.doesNotMatch(sources.wizard, /runAutomaticContactEnrichmentForRequestAction/);
    assert.doesNotMatch(sources.wizard, /automatic-routing-action/);
  });

  it('wizard still calls the manual per-provider actions', () => {
    assert.match(sources.wizard, /runContactEnrichmentApolloForRequestAction/);
    assert.match(sources.wizard, /runContactEnrichmentLushaForRequestAction/);
  });
});

describe('Automatic-routing action wiring is minimal and one-directional', () => {
  it('automatic-routing-actions.ts only delegates to the core + auth helper (no direct provider runner import)', () => {
    assert.doesNotMatch(sources.automaticActions, /apollo-enrichment-runner/);
    assert.doesNotMatch(sources.automaticActions, /lusha-enrichment-runner/);
    assert.match(sources.automaticActions, /requireActiveUserForEnrichment/);
    assert.match(sources.automaticActions, /automatic-routing-action-core/);
  });

  it('automatic-routing-action-core.ts only imports the orchestrator (no direct provider runner import)', () => {
    assert.doesNotMatch(sources.automaticCore, /apollo-enrichment-runner/);
    assert.doesNotMatch(sources.automaticCore, /lusha-enrichment-runner/);
    assert.match(sources.automaticCore, /contact-enrichment-routing-orchestrator/);
  });

  it('automatic-routing-actions.ts has no direct Supabase mutation calls (delegates entirely to the core)', () => {
    assert.doesNotMatch(sources.automaticActions, /\.(insert|update|delete|upsert)\s*\(/);
  });

  it('neither file reveals phone data, writes HubSpot, or approves/creates official contacts', () => {
    for (const source of [sources.automaticActions, sources.automaticCore]) {
      assert.doesNotMatch(source, /syncContactToHubSpot/);
      assert.doesNotMatch(source, /approveContactCandidate|runApproveCandidate/);
      assert.doesNotMatch(source, /phone/i);
    }
  });
});

describe('Apollo and Lusha runners remain fully independent', () => {
  it('apollo-enrichment-runner.ts does not import the Lusha runner', () => {
    assert.doesNotMatch(sources.apolloRunner, /lusha-enrichment-runner/);
  });

  it('lusha-enrichment-runner.ts does not import the Apollo runner', () => {
    assert.doesNotMatch(sources.lushaRunner, /apollo-enrichment-runner/);
  });
});
