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
};

const sources = {
  accountPage: readFileSync(FILES.accountPage, 'utf-8'),
  accountDetailSheet: readFileSync(FILES.accountDetailSheet, 'utf-8'),
  runHistoryActions: readFileSync(FILES.runHistoryActions, 'utf-8'),
  runHistoryCore: readFileSync(FILES.runHistoryCore, 'utf-8'),
  runHistoryComponent: readFileSync(FILES.runHistoryComponent, 'utf-8'),
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
});

describe('Account Agents run history — no clickable provider/approval controls', () => {
  it('the run history component renders no <button> or onClick handler', () => {
    assert.doesNotMatch(sources.runHistoryComponent, /<button/i);
    assert.doesNotMatch(sources.runHistoryComponent, /onClick/);
  });

  it('the run history component does not import the Button component', () => {
    assert.doesNotMatch(sources.runHistoryComponent, /from ['"]@\/components\/ui\/button['"]/);
  });

  it('the run history component has exactly one Link (the "Ver detalle" link) — no provider/approve buttons hiding as links', () => {
    const linkMatches = sources.runHistoryComponent.match(/<Link\b/g) ?? [];
    assert.equal(linkMatches.length, 1);
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
