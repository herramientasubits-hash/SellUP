/**
 * Static offline guard — AGENT2-ROUTING-WIRE-1.
 *
 * Originally (Hito 17B.4X.7C.5C) this file proved the automatic-routing action
 * stayed dark: the wizard called only the manual per-provider actions. That
 * decision is reversed by AGENT2-ROUTING-WIRE-1 — the wizard CTA now runs the
 * automatic Apollo→Lusha router and the user no longer picks a provider. The
 * assertions below are updated to lock the NEW contract: the wizard wires the
 * automatic action and is fully decoupled from the manual per-provider request
 * actions. This repo has no local live-Postgres/Apollo/Lusha harness, so the
 * wiring is proven as a static source-text assertion (same technique as
 * run-viewer-no-provider-calls.test.ts and the orchestrator test's scenario J).
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

describe('Wizard CTA is wired to the automatic-routing action (AGENT2-ROUTING-WIRE-1)', () => {
  it('wizard imports and calls the automatic-routing action', () => {
    assert.match(sources.wizard, /runAutomaticContactEnrichmentForRequestAction/);
    assert.match(sources.wizard, /automatic-routing-actions/);
  });

  it('wizard no longer calls the manual per-provider request actions from the CTA', () => {
    assert.doesNotMatch(sources.wizard, /runContactEnrichmentApolloForRequestAction/);
    assert.doesNotMatch(sources.wizard, /runContactEnrichmentLushaForRequestAction/);
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
