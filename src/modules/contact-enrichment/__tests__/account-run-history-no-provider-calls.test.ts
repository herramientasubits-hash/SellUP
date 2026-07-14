/**
 * Static offline guard — Account Agents tab run history never touches
 * provider execution, candidate mutation, or HubSpot sync (Hito
 * 17B.4X.7C.3E.3).
 *
 * Mirrors run-viewer-no-provider-calls.test.ts's technique: read each file
 * as text and assert on its content. If any of these files start importing
 * a provider-execution or mutation action, this test fails the build before
 * it ever reaches a browser.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  accountPage: join(ROOT, 'src/app/(sellup)/accounts/[accountId]/page.tsx'),
  accountDetailSheet: join(ROOT, 'src/components/accounts/account-detail-sheet.tsx'),
  runHistoryActions: join(ROOT, 'src/modules/contact-enrichment/account-run-history-actions.ts'),
  runHistoryCore: join(ROOT, 'src/modules/contact-enrichment/account-run-history-read-model-core.ts'),
  runHistoryComponent: join(ROOT, 'src/components/contact-enrichment/account-agents-run-history.tsx'),
  inlineDetailContent: join(ROOT, 'src/components/contact-enrichment/account-run-inline-detail-content.ts'),
};

const sources = {
  accountPage: readFileSync(FILES.accountPage, 'utf-8'),
  accountDetailSheet: readFileSync(FILES.accountDetailSheet, 'utf-8'),
  runHistoryActions: readFileSync(FILES.runHistoryActions, 'utf-8'),
  runHistoryCore: readFileSync(FILES.runHistoryCore, 'utf-8'),
  runHistoryComponent: readFileSync(FILES.runHistoryComponent, 'utf-8'),
  inlineDetailContent: readFileSync(FILES.inlineDetailContent, 'utf-8'),
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

describe('Account Agents run history — no provider/mutation identifiers', () => {
  for (const [fileKey, source] of Object.entries(sources)) {
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      it(`${fileKey} does not reference ${identifier}`, () => {
        assert.doesNotMatch(source, new RegExp(identifier));
      });
    }
  }
});

describe('Account Agents run history — no provider client imports', () => {
  it('run history actions file only imports Supabase clients and the read-model core', () => {
    assert.doesNotMatch(sources.runHistoryActions, /contact-enrichment-toolkit\/(apollo|lusha)-enrichment-runner/);
    assert.doesNotMatch(sources.runHistoryActions, /contact-enrichment-runner/);
  });

  it('account page and sheet do not import candidate-review-core or hubspot-account-resolver', () => {
    assert.doesNotMatch(sources.accountPage, /candidate-review-core/);
    assert.doesNotMatch(sources.accountPage, /hubspot-account-resolver/);
    assert.doesNotMatch(sources.accountDetailSheet, /candidate-review-core/);
    assert.doesNotMatch(sources.accountDetailSheet, /hubspot-account-resolver/);
  });
});

describe('Account Agents run history — no mutating Supabase calls', () => {
  it('actions file has no .insert(/.update(/.delete(/.upsert( calls', () => {
    assert.doesNotMatch(sources.runHistoryActions, /\.(insert|update|delete|upsert)\s*\(/);
  });

  it('read-model core file has no .insert(/.update(/.delete(/.upsert( calls', () => {
    assert.doesNotMatch(sources.runHistoryCore, /\.(insert|update|delete|upsert)\s*\(/);
  });

  it('inline detail content resolver has no .insert(/.update(/.delete(/.upsert( calls', () => {
    assert.doesNotMatch(sources.inlineDetailContent, /\.(insert|update|delete|upsert)\s*\(/);
  });
});

describe('Account Agents run history — inline expand, not navigation (Hito 17B.4X.7C.3E.4)', () => {
  it('the run history component renders no <Link> — "Ver detalle" no longer navigates', () => {
    assert.doesNotMatch(sources.runHistoryComponent, /<Link\b/);
  });

  it('the run history component does not import next/link', () => {
    assert.doesNotMatch(sources.runHistoryComponent, /from ['"]next\/link['"]/);
  });

  it('the run history component uses the shared Button component for the expand toggle', () => {
    assert.match(sources.runHistoryComponent, /from ['"]@\/components\/ui\/button['"]/);
  });

  it('the expand toggle only flips local expand state, never a provider/mutation identifier', () => {
    assert.match(sources.runHistoryComponent, /onClick=\{\(\) => setExpanded/);
  });

  it('the expand toggle exposes aria-expanded and both label states', () => {
    assert.match(sources.runHistoryComponent, /aria-expanded=\{expanded\}/);
    assert.match(sources.runHistoryComponent, /Ver detalle/);
    assert.match(sources.runHistoryComponent, /Ocultar detalle/);
  });

  it('the only new provider-usage read used by the inline detail is the existing read-only getContactEnrichmentRunProviderUsage export', () => {
    assert.match(sources.runHistoryComponent, /getContactEnrichmentRunProviderUsage/);
    assert.doesNotMatch(sources.runHistoryComponent, /run-viewer-actions['"];?\s*\/\/.*write/i);
  });

  it('the inline detail content resolver has no React import (pure, no DOM)', () => {
    assert.doesNotMatch(sources.inlineDetailContent, /from ['"]react['"]/);
  });

  it('the inline detail content resolver has no Supabase/network import', () => {
    assert.doesNotMatch(sources.inlineDetailContent, /from ['"]@supabase/i);
    assert.doesNotMatch(sources.inlineDetailContent, /fetch\(/);
  });
});

describe('Account Agents run history — UX contract strings present', () => {
  it('component declares the read-only section title', () => {
    assert.match(sources.runHistoryComponent, /Runs de enriquecimiento de contactos/);
  });

  it('component declares the read-only description', () => {
    assert.match(sources.runHistoryComponent, /Esta vista es de solo lectura/);
  });

  it('component declares the empty state copy', () => {
    assert.match(sources.runHistoryComponent, /Todavía no hay runs de enriquecimiento para esta cuenta/);
  });

  it('component links to the read-only run viewer route', () => {
    assert.match(sources.runHistoryComponent, /\/contact-enrichment\/runs\/\$\{runId\}/);
  });
});

describe('Account Agents run history — placeholder fully replaced', () => {
  it('account page no longer renders the "Agentes IA — Próxima fase" placeholder', () => {
    assert.doesNotMatch(sources.accountPage, /Agentes IA — Próxima fase/);
  });

  it('account detail sheet no longer renders the "Agentes IA — Próxima fase" placeholder', () => {
    assert.doesNotMatch(sources.accountDetailSheet, /Agentes IA — Próxima fase/);
  });

  it('account page wires AccountAgentsRunHistory into the "agentes" tab', () => {
    assert.match(sources.accountPage, /<AccountAgentsRunHistory\s+runs=\{contactEnrichmentRuns\}\s*\/>/);
  });

  it('account detail sheet wires AccountAgentsRunHistory into the "agentes" tab', () => {
    assert.match(sources.accountDetailSheet, /<AccountAgentsRunHistory\s+runs=\{data\.contactEnrichmentRuns\}\s*\/>/);
  });
});
