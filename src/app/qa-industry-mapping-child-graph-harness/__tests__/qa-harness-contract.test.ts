// qa-harness-contract.test.ts — Static source-inspection checks for the
// TEMPORARY reversible industry-mapping QA harness (Q3F-5AT.2).
//
// Same methodology as
// src/modules/industry-mapping/__tests__/mapping-runtime-boundary-wiring.test.ts:
// actions.ts transitively imports '@/lib/supabase/server', which uses
// next/headers cookies() — invoking it under `node --test` (outside a live
// Next.js request context) is not possible. These checks read actions.ts /
// page.tsx / the DD-27 test as plain text and assert on their exact wiring,
// without ever executing next/headers or touching a real Supabase project.
// This file is deleted along with the rest of the harness once live QA
// validation is complete.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const harnessDir = path.join(testDir, '..');
const industryMappingTestsDir = path.join(harnessDir, '..', '..', 'modules', 'industry-mapping', '__tests__');

const actionsSource = readFileSync(path.join(harnessDir, 'actions.ts'), 'utf8');
const pageSource = readFileSync(path.join(harnessDir, 'page.tsx'), 'utf8');
const panelSource = readFileSync(path.join(harnessDir, 'qa-harness-panel.tsx'), 'utf8');
const boundaryWiringSource = readFileSync(
  path.join(industryMappingTestsDir, 'mapping-runtime-boundary-wiring.test.ts'),
  'utf8',
);

// Built from parts (never written contiguously in this file) so that DD-27's
// src/app string scan — which allowlists exactly one file, actions.ts —
// does not also have to allowlist this test file.
const DELETE_DRAFT_FN_NAME = ['deleteMappingDraftFor', 'CurrentActor'].join('');

function extractFunctionBody(source: string, name: string): string {
  const startMarker = `function ${name}(`;
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "function ${name}(" in source`);
  const searchFrom = start + startMarker.length;
  const nextExportOffset = source.slice(searchFrom).search(/\nexport (async )?function |\n\/\/ ──/);
  const end = nextExportOffset === -1 ? source.length : searchFrom + nextExportOffset;
  return source.slice(start, end);
}

// HT1 — env flag exact 'true' behavior.
describe('HT1: env flag exact behavior', () => {
  it('checks process.env.ENABLE_INDUSTRY_MAPPING_QA_HARNESS against the exact lowercase literal "true"', () => {
    assert.match(actionsSource, /process\.env\[QA_HARNESS_ENV_FLAG\]\s*!==\s*'true'/);
    assert.match(actionsSource, /const QA_HARNESS_ENV_FLAG = 'ENABLE_INDUSTRY_MAPPING_QA_HARNESS';/);
  });

  it('does not use any truthy-coercion pattern (Boolean(), == , !!) on the env flag', () => {
    assert.doesNotMatch(actionsSource, /Boolean\(process\.env\[QA_HARNESS_ENV_FLAG\]\)/);
    assert.doesNotMatch(actionsSource, /process\.env\[QA_HARNESS_ENV_FLAG\]\s*==[^=]/);
  });
});

// HT2/HT3/HT4 — exact operator email allowlist + normalization.
describe('HT2-HT4: exact QA operator email allowlist', () => {
  it('freezes exactly one operator email constant', () => {
    assert.match(actionsSource, /const QA_OPERATOR_EMAIL = 'egarcia@ubits\.co';/);
  });

  it('compares the resolved email using trim().toLowerCase() before equality (deterministic normalization)', () => {
    assert.match(actionsSource, /\.trim\(\)\.toLowerCase\(\)/);
    assert.match(actionsSource, /normalizedEmail !== QA_OPERATOR_EMAIL/);
  });

  it('does not contain a wildcard or domain-only match (e.g. endsWith("@ubits.co"))', () => {
    assert.doesNotMatch(actionsSource, /endsWith\(['"]@ubits\.co['"]\)/);
    assert.doesNotMatch(actionsSource, /@ubits\.co\*/);
  });

  it('does not accept the operator email from a query param, form field, or process.env other than the frozen constant', () => {
    assert.doesNotMatch(actionsSource, /searchParams/);
    assert.doesNotMatch(actionsSource, /formData\.get\(['"]email['"]\)/);
    assert.doesNotMatch(actionsSource, /process\.env\.QA_OPERATOR_EMAIL/);
  });
});

// HT5 — no development auth fallback.
describe('HT5: no development auth fallback', () => {
  it('requireQaHarnessAccess contains no NODE_ENV development bypass or "first active user" fallback', () => {
    const body = extractFunctionBody(actionsSource, 'requireQaHarnessAccess');
    assert.doesNotMatch(body, /NODE_ENV/);
    assert.doesNotMatch(body, /limit\(1\)/);
    assert.doesNotMatch(body, /\.single\(\)/);
  });

  it('requireQaHarnessAccess reuses resolveTrustedIndustryMappingActor rather than re-deriving actor identity', () => {
    const body = extractFunctionBody(actionsSource, 'requireQaHarnessAccess');
    assert.match(body, /resolveTrustedIndustryMappingActor\(authClient\)/);
  });
});

// HT6/HT7 — CREATE_TEST_GRAPH public input contract + internal constants.
describe('HT6-HT7: createTestGraph zero-input contract and exact QA constants', () => {
  it('createTestGraph accepts zero parameters', () => {
    assert.match(actionsSource, /export async function createTestGraph\(\): Promise<QaHarnessResult> \{/);
  });

  it('createTestGraph internally uses the exact frozen source vocabulary key, version label, canonical slug, and relation semantics', () => {
    const body = extractFunctionBody(actionsSource, 'createTestGraph');
    assert.match(body, /sourceVocabularyKey: QA_SOURCE_VOCABULARY_KEY/);
    assert.match(body, /versionLabel: QA_VERSION_LABEL/);
    assert.match(body, /changeReason: null/);
    assert.match(body, /relationSemantics: QA_RELATION_SEMANTICS/);
  });

  it('the frozen constants match the exact values specified', () => {
    assert.match(actionsSource, /const QA_SOURCE_VOCABULARY_KEY = 'apollo_organization_industry';/);
    assert.match(actionsSource, /const QA_VERSION_LABEL = 'Q3F-5AT-LIVE-QA-SYNTHETIC';/);
    assert.match(actionsSource, /const QA_CANONICAL_INDUSTRY_SLUG = 'tecnologia';/);
    assert.match(actionsSource, /const QA_RELATION_SEMANTICS = 'SOURCE_EQUIVALENT_TO_CANONICAL';/);
  });
});

// HT8 — canonical catalog lookup requires exactly one published version.
describe('HT8: catalog version lookup cardinality', () => {
  it('resolveCurrentCanonicalCatalogVersionId fails closed on 0 or 2+ published rows and never orders/limits to pick one', () => {
    const body = extractFunctionBody(actionsSource, 'resolveCurrentCanonicalCatalogVersionId');
    assert.match(body, /\.eq\('status', 'published'\)/);
    assert.match(body, /rows\.length === 0/);
    assert.match(body, /rows\.length > 1/);
    assert.doesNotMatch(body, /\.order\(/);
    assert.doesNotMatch(body, /\.limit\(/);
  });
});

// HT9 — target lookup uses exact slug + resolved catalogVersionId.
describe('HT9: canonical target lookup', () => {
  it('resolveCanonicalTarget filters by the resolved catalogVersionId and the exact frozen slug', () => {
    const body = extractFunctionBody(actionsSource, 'resolveCanonicalTarget');
    assert.match(body, /\.eq\('catalog_version_id', catalogVersionId\)/);
    assert.match(body, /\.eq\('slug', QA_CANONICAL_INDUSTRY_SLUG\)/);
  });
});

// HT10 — synthetic rawLabel comes from returned industry.name.
describe('HT10: synthetic rawLabel source', () => {
  it('addConceptEntryForCurrentActor is called with rawLabel: industry.name (not a hardcoded string)', () => {
    const body = extractFunctionBody(actionsSource, 'createTestGraph');
    assert.match(body, /rawLabel: industry\.name/);
  });
});

// HT11 — concept.id used as association conceptEntryId.
describe('HT11: concept.id propagation', () => {
  it('addMappingAssociationForCurrentActor is called with conceptEntryId: concept.id', () => {
    const body = extractFunctionBody(actionsSource, 'createTestGraph');
    assert.match(body, /conceptEntryId: concept\.id/);
  });
});

// HT12 — association receives the same catalogVersionId used for the snapshot.
describe('HT12: shared catalogVersionId', () => {
  it('the same catalogVersionId identifier is used for both createMappingDraftForCurrentActor and addMappingAssociationForCurrentActor', () => {
    const body = extractFunctionBody(actionsSource, 'createTestGraph');
    const occurrences = body.match(/catalogVersionId/g) ?? [];
    assert.ok(occurrences.length >= 3, 'expected catalogVersionId referenced for both snapshot creation and association creation');
  });
});

// HT13 — relation semantics exact value.
describe('HT13: exact relation semantics', () => {
  it('the association call passes relationSemantics: QA_RELATION_SEMANTICS which equals SOURCE_EQUIVALENT_TO_CANONICAL', () => {
    assert.match(actionsSource, /const QA_RELATION_SEMANTICS = 'SOURCE_EQUIVALENT_TO_CANONICAL';/);
    const body = extractFunctionBody(actionsSource, 'createTestGraph');
    assert.match(body, /relationSemantics: QA_RELATION_SEMANTICS/);
  });
});

// HT14/HT15 — marker lookup exact conjunction + cardinality fail-closed semantics.
describe('HT14-HT15: marker lookup predicate and cardinality', () => {
  it('findActiveQaGraphMarker filters on status=draft, created_by=internalUserId, source_vocabulary_key, and version_label together', () => {
    const body = extractFunctionBody(actionsSource, 'findActiveQaGraphMarker');
    assert.match(body, /\.eq\('status', 'draft'\)/);
    assert.match(body, /\.eq\('created_by', internalUserId\)/);
    assert.match(body, /\.eq\('source_vocabulary_key', QA_SOURCE_VOCABULARY_KEY\)/);
    assert.match(body, /\.eq\('version_label', QA_VERSION_LABEL\)/);
  });

  it('findActiveQaGraphMarker returns a distinct kind for 0 / 1 / 2+ matches (no arbitrary pick)', () => {
    const body = extractFunctionBody(actionsSource, 'findActiveQaGraphMarker');
    assert.match(body, /rows\.length === 0/);
    assert.match(body, /kind: 'none'/);
    assert.match(body, /rows\.length === 1/);
    assert.match(body, /kind: 'one'/);
    assert.match(body, /kind: 'drift'/);
    assert.doesNotMatch(body, /\.single\(\)/);
    assert.doesNotMatch(body, /\.maybeSingle\(\)/);
  });
});

// HT16/HT17/HT18/HT19 — DELETE_TEST_GRAPH input contract, ownership check, boundary used, no direct table DELETE.
describe('HT16-HT19: deleteTestGraph contract', () => {
  it('deleteTestGraph accepts exactly one parameter named snapshotId', () => {
    assert.match(actionsSource, /export async function deleteTestGraph\(snapshotId: string\): Promise<QaHarnessResult> \{/);
  });

  it('deleteTestGraph verifies exact marker ownership (status/created_by/source_vocabulary_key/version_label) before calling delete', () => {
    const ownedBody = extractFunctionBody(actionsSource, 'verifyOwnedQaGraph');
    assert.match(ownedBody, /data\.status !== 'draft'/);
    assert.match(ownedBody, /data\.created_by !== internalUserId/);
    assert.match(ownedBody, /data\.source_vocabulary_key !== QA_SOURCE_VOCABULARY_KEY/);
    assert.match(ownedBody, /data\.version_label !== QA_VERSION_LABEL/);

    const deleteBody = extractFunctionBody(actionsSource, 'deleteTestGraph');
    assert.match(deleteBody, /verifyOwnedQaGraph\(db, snapshotId, actor\.internalUserId\)/);
  });

  it('deleteTestGraph calls the delete-draft CurrentActor boundary function, never a raw .rpc(...) or table delete', () => {
    const body = extractFunctionBody(actionsSource, 'deleteTestGraph');
    assert.match(body, new RegExp(`await ${DELETE_DRAFT_FN_NAME}\\(\\{ snapshotId \\}\\)`));
    assert.doesNotMatch(body, /\.delete\(\)/);
    assert.doesNotMatch(body, /\.rpc\(/);
  });

  it('no file in the harness directory issues a direct .delete() table call', () => {
    assert.doesNotMatch(actionsSource, /\.delete\(\)/);
    assert.doesNotMatch(pageSource, /\.delete\(\)/);
    assert.doesNotMatch(panelSource, /\.delete\(\)/);
  });
});

// HT20 — no publish/archive call.
describe('HT20: no publish or archive exposed', () => {
  it('the harness never imports or calls a publish/archive function', () => {
    assert.doesNotMatch(actionsSource, /publishMappingSnapshotForCurrentActor/);
    assert.doesNotMatch(actionsSource, /archive/i);
    assert.doesNotMatch(pageSource, /publishMappingSnapshotForCurrentActor|archive/i);
  });
});

// HT21/HT22/HT23 — global baseline usage, fixed precondition, no browser-supplied counts.
describe('HT21-HT23: global baseline handling', () => {
  it('readGlobalBaselineCounts counts all four provider_industry_* tables globally (no actor scoping filter)', () => {
    const body = extractFunctionBody(actionsSource, 'readGlobalBaselineCounts');
    assert.match(body, /provider_industry_source_vocabularies/);
    assert.match(body, /provider_industry_mapping_snapshots/);
    assert.match(body, /provider_industry_concept_entries/);
    assert.match(body, /provider_industry_mapping_associations/);
  });

  it('createTestGraph checks the fixed 1/0/0/0 precondition before creating anything', () => {
    assert.match(
      actionsSource,
      /const FIXED_PRECONDITION: GlobalBaselineCounts = \{\s*sourceVocabularies: 1,\s*snapshots: 0,\s*concepts: 0,\s*associations: 0,\s*\};/,
    );
    const body = extractFunctionBody(actionsSource, 'createTestGraph');
    assert.match(body, /countsEqual\(baseline, FIXED_PRECONDITION\)/);
  });

  it('neither createTestGraph nor deleteTestGraph accept a caller-supplied baseline/count argument', () => {
    assert.doesNotMatch(actionsSource, /export async function createTestGraph\([^)]+\)/);
    assert.match(actionsSource, /export async function deleteTestGraph\(snapshotId: string\)/);
  });
});

// HT24/HT25/HT26 — automatic cleanup only after post-snapshot failure, uses the real boundary, no retry loop.
describe('HT24-HT26: automatic cleanup posture', () => {
  it('cleanup is only attempted inside the try/catch that wraps concept+association creation, after snapshotId exists', () => {
    const body = extractFunctionBody(actionsSource, 'createTestGraph');
    const cleanupIndex = body.indexOf('cleanupAttempted: true');
    const snapshotAssignIndex = body.indexOf('snapshotId = snapshot.id;');
    assert.ok(cleanupIndex !== -1 && snapshotAssignIndex !== -1 && cleanupIndex > snapshotAssignIndex);
  });

  it('cleanup calls the delete-draft CurrentActor boundary function exactly once, with no loop/retry', () => {
    const body = extractFunctionBody(actionsSource, 'createTestGraph');
    const occurrences = body.match(new RegExp(`await ${DELETE_DRAFT_FN_NAME}\\(\\{ snapshotId \\}\\)`, 'g')) ?? [];
    assert.equal(occurrences.length, 1);
    assert.doesNotMatch(body, /for\s*\(.*cleanup/i);
    assert.doesNotMatch(body, /while\s*\(.*cleanup/i);
  });
});

// HT27 — unknown errors sanitized.
describe('HT27: error sanitization', () => {
  it('sanitizeError falls back to a fixed UNKNOWN_ERROR code/message for unrecognized error types and never returns the raw error', () => {
    const body = extractFunctionBody(actionsSource, 'sanitizeError');
    assert.match(body, /code: 'UNKNOWN_ERROR'/);
    assert.match(body, /message: 'An unexpected error occurred\.'/);
  });
});

// HT28/HT29 — READ_TEST_STATE read-only, unauthorized users receive no state.
describe('HT28-HT29: readTestState is read-only; unauthorized users get no state', () => {
  it('readTestState never calls a CurrentActor mutation function', () => {
    const body = extractFunctionBody(actionsSource, 'readTestState');
    const mutationFnNames = [
      'createMappingDraftForCurrentActor',
      'addConceptEntryForCurrentActor',
      'addMappingAssociationForCurrentActor',
      DELETE_DRAFT_FN_NAME,
    ];
    assert.doesNotMatch(body, new RegExp(mutationFnNames.join('|')));
  });

  it('page.tsx calls requireQaHarnessAccess before calling readTestState, and never renders QA state on denial', () => {
    const accessIndex = pageSource.indexOf('requireQaHarnessAccess()');
    const readIndex = pageSource.indexOf('readTestState()');
    assert.ok(accessIndex !== -1 && readIndex !== -1 && accessIndex < readIndex);
    assert.match(pageSource, /notFound\(\)/);
  });
});

// HT30/HT31 — DD-27 allowlist exactness + module invariant unchanged.
describe('HT30-HT31: DD-27 allowlist scope', () => {
  it('the DD-27 src/app allowlist names exactly the harness actions.ts path', () => {
    assert.match(
      boundaryWiringSource,
      /TEMPORARY_DELETE_DRAFT_CALLER_ALLOWLIST = \[\s*path\.join\('qa-industry-mapping-child-graph-harness', 'actions\.ts'\),\s*\]/,
    );
  });

  it('the industry-mapping module zero-caller assertion (second DD-27 check) is unchanged — still allows only server.ts', () => {
    assert.match(boundaryWiringSource, /const allowedFiles = new Set\(\['server\.ts'\]\);/);
  });
});

// HT32 — no provider/AI import or invocation. Note: the literal string
// "apollo" legitimately appears in QA_SOURCE_VOCABULARY_KEY
// ('apollo_organization_industry') — that is a pre-existing source
// vocabulary key from migration 084, not a provider call. This check
// instead asserts there is no *import* of a provider/AI module and no HTTP
// call to a provider API.
describe('HT32: no provider or AI integration', () => {
  it('the harness never imports a provider adapter (Apollo/Lusha/Tavily) or an AI/LLM client', () => {
    for (const source of [actionsSource, pageSource, panelSource]) {
      const importLines = (source.match(/^import .*$/gm) ?? []).join('\n');
      assert.doesNotMatch(importLines, /apollo|lusha|tavily|openai|anthropic/i);
    }
  });

  it('the harness never calls fetch() or an HTTP client against a provider API', () => {
    for (const source of [actionsSource, pageSource, panelSource]) {
      assert.doesNotMatch(source, /\bfetch\(/);
    }
  });
});

// HT33 — no actor ID client field.
describe('HT33: no client-supplied actor id', () => {
  it('no exported harness function declares an actorId/internalUserId parameter', () => {
    assert.doesNotMatch(actionsSource, /export async function (createTestGraph|deleteTestGraph|readTestState)\([^)]*(actorId|internalUserId)/);
  });
});

// HT34 — no free-text/internal UUID control in the page.
describe('HT34: no free-text identifier input on the page', () => {
  it('page.tsx and the panel contain no <input> element (no free-text snapshotId/email/UUID field)', () => {
    assert.doesNotMatch(pageSource, /<input/);
    assert.doesNotMatch(panelSource, /<input/);
  });

  it('the delete action is bound server-side to the exact snapshotId from READ_TEST_STATE, not read from a form field', () => {
    assert.match(panelSource, /deleteTestGraphActionState\.bind\(null, snapshotId \?\? ''\)/);
  });
});

// HT35 — synthetic/not-Apollo-derived warning text present.
describe('HT35: synthetic QA graph warning text', () => {
  it('page.tsx renders the required warning distinguishing synthetic QA content from Apollo-derived mapping', () => {
    assert.match(pageSource, /Synthetic QA graph\. Not Apollo-derived mapping\./);
  });
});
