// mapping-runtime-boundary-wiring.test.ts — Static source-inspection checks
// for the industry-mapping server-only runtime boundary (Q3F-5AN.1).
//
// These checks read server.ts / mapping-runtime-wrappers.ts as plain text
// rather than importing them: server.ts transitively imports
// '@/lib/supabase/server', which uses next/headers cookies() — invoking it
// (not merely importing it) requires a live Next.js request context that
// does not exist under `node --test`. Reading the wiring statically proves
// which DB-client factory each wrapper calls and whether actor resolution is
// wired in, without ever executing next/headers or touching a real
// Supabase project.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(path.join(moduleDir, '..', 'server.ts'), 'utf8');
const wrappersSource = readFileSync(path.join(moduleDir, '..', 'mapping-runtime-wrappers.ts'), 'utf8');
const combinedSource = `${serverSource}\n${wrappersSource}`;

function extractExportedFunctionBody(source: string, name: string): string {
  const startMarker = `export async function ${name}(`;
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "export async function ${name}(" in source`);
  const searchFrom = start + startMarker.length;
  const nextExportOffset = source.slice(searchFrom).search(/\nexport (async )?function /);
  const end = nextExportOffset === -1 ? source.length : searchFrom + nextExportOffset;
  return source.slice(start, end);
}

const DRAFT_MUTATION_WRAPPERS = [
  'createMappingDraftForCurrentActor',
  'updateMappingDraftMetadataForCurrentActor',
  'addConceptEntryForCurrentActor',
  'updateConceptEntryRawLabelForCurrentActor',
  'removeConceptEntryForCurrentActor',
  'addMappingAssociationForCurrentActor',
  'updateMappingAssociationForCurrentActor',
  'removeMappingAssociationForCurrentActor',
];

describe('server.ts wiring — DB client/role per wrapper (RB13, P)', () => {
  for (const name of DRAFT_MUTATION_WRAPPERS) {
    it(`${name} uses createIndustryMappingDraftDbClient (service-role) and resolves the current actor`, () => {
      const body = extractExportedFunctionBody(serverSource, name);
      assert.match(body, /createIndustryMappingDraftDbClient\(\)/);
      assert.match(body, /currentAuthClient\(\)/);
      assert.doesNotMatch(body, /createIndustryMappingPublicationDbClient\(\)/);
      assert.doesNotMatch(body, /createIndustryMappingSnapshotLoadDbClient\(\)/);
    });
  }
});

describe('server.ts wiring — publication wrapper (RB14, P)', () => {
  it('publishMappingSnapshotForCurrentActor uses createIndustryMappingPublicationDbClient (service-role) and resolves the current actor', () => {
    const body = extractExportedFunctionBody(serverSource, 'publishMappingSnapshotForCurrentActor');
    assert.match(body, /createIndustryMappingPublicationDbClient\(\)/);
    assert.match(body, /currentAuthClient\(\)/);
    assert.doesNotMatch(body, /createIndustryMappingDraftDbClient\(\)/);
    assert.doesNotMatch(body, /createIndustryMappingSnapshotLoadDbClient\(\)/);
  });
});

describe('server.ts wiring — delete-draft wrapper (Q3F-5AR.0, DD-21, DD-22, DD-23)', () => {
  it('DD-23: deleteMappingDraftForCurrentActor is exported from server.ts', () => {
    assert.match(serverSource, /export async function deleteMappingDraftForCurrentActor\(/);
  });

  it('DD-21/DD-22: deleteMappingDraftForCurrentActor uses createIndustryMappingDraftDeleteDbClient (service-role) for the RPC and currentAuthClient only for actor resolution', () => {
    const body = extractExportedFunctionBody(serverSource, 'deleteMappingDraftForCurrentActor');
    assert.match(body, /createIndustryMappingDraftDeleteDbClient\(\)/);
    assert.match(body, /currentAuthClient\(\)/);
    assert.doesNotMatch(body, /createIndustryMappingDraftDbClient\(\)/);
    assert.doesNotMatch(body, /createIndustryMappingPublicationDbClient\(\)/);
    assert.doesNotMatch(body, /createIndustryMappingSnapshotLoadDbClient\(\)/);
  });
});

describe('server.ts wiring — loaders (RB15, RB16, RB17, P)', () => {
  it('loadPublishedIndustryMappingSnapshot uses createIndustryMappingSnapshotLoadDbClient (service-role) and never resolves an actor', () => {
    const body = extractExportedFunctionBody(serverSource, 'loadPublishedIndustryMappingSnapshot');
    assert.match(body, /createIndustryMappingSnapshotLoadDbClient\(\)/);
    assert.doesNotMatch(body, /currentAuthClient\(\)/);
    assert.doesNotMatch(body, /createIndustryMappingDraftDbClient\(\)/);
    assert.doesNotMatch(body, /createIndustryMappingPublicationDbClient\(\)/);
  });

  it('loadHistoricalIndustryMappingSnapshot uses createIndustryMappingSnapshotLoadDbClient (service-role) and never resolves an actor', () => {
    const body = extractExportedFunctionBody(serverSource, 'loadHistoricalIndustryMappingSnapshot');
    assert.match(body, /createIndustryMappingSnapshotLoadDbClient\(\)/);
    assert.doesNotMatch(body, /currentAuthClient\(\)/);
    assert.doesNotMatch(body, /createIndustryMappingDraftDbClient\(\)/);
    assert.doesNotMatch(body, /createIndustryMappingPublicationDbClient\(\)/);
  });
});

describe('exported input types omit actor fields (section 20/N)', () => {
  const expectedOmits: Array<[string, string]> = [
    ['CreateMappingDraftForActorInput', 'createdByActorId'],
    ['UpdateMappingDraftMetadataForActorInput', 'actorId'],
    ['AddConceptEntryForActorInput', 'actorId'],
    ['UpdateConceptEntryRawLabelForActorInput', 'actorId'],
    ['RemoveConceptEntryForActorInput', 'actorId'],
    ['AddMappingAssociationForActorInput', 'actorId'],
    ['UpdateMappingAssociationForActorInput', 'actorId'],
    ['RemoveMappingAssociationForActorInput', 'actorId'],
    ['PublishMappingSnapshotForActorInput', 'publisherActorId'],
    ['DeleteMappingDraftForActorInput', 'actorId'],
  ];

  for (const [typeName, omittedField] of expectedOmits) {
    it(`${typeName} is declared as Omit<..., '${omittedField}'>`, () => {
      const pattern = new RegExp(`export type ${typeName} = Omit<[^;]*'${omittedField}'[^;]*>;`);
      assert.match(wrappersSource, pattern);
    });
  }

  it('no exported input type declares a literal actorId/createdByActorId/publisherActorId field', () => {
    // Matches a TS object-type field declaration like `actorId: string` or
    // `actorId?: string` — as opposed to the string literal inside
    // Omit<X, 'actorId'>, which is intentionally present and expected.
    const fieldDeclarationPattern = /\b(actorId|createdByActorId|publisherActorId)\??:\s*string/;
    assert.doesNotMatch(wrappersSource, fieldDeclarationPattern);
    assert.doesNotMatch(serverSource, fieldDeclarationPattern);
  });
});

describe('no archive wrapper exported; delete-draft wrapper contract (RB19, RB20 — evolved by Q3F-5AQ.0R, DD-25, DD-33, DD-34)', () => {
  function exportedFunctionNames(source: string): string[] {
    return [...source.matchAll(/export async function (\w+)/g)].map((match) => match[1]);
  }

  const names = [...exportedFunctionNames(serverSource), ...exportedFunctionNames(wrappersSource)];

  it('RB19 (DD-25, DD-33): no archive wrapper exported — PASS, unchanged by Q3F-5AQ.0R', () => {
    assert.ok(names.length > 0, 'sanity: expected to find exported functions');
    assert.ok(
      !names.some((name) => /archive/i.test(name)),
      `unexpected archive-related export found: ${names.filter((n) => /archive/i.test(n)).join(', ')}`,
    );
  });

  // RB20 was originally frozen as "no delete-draft wrapper exported"
  // (Q3F-5AN.1). Q3F-5AQ.0R intentionally reinterpreted DELETE-DRAFT as the
  // required reversible-cleanup capability, so RB20 is evolved (not
  // silently deleted) into the following DD-34 contract: the delete-draft
  // application wrapper now DOES exist, its exported input does not expose
  // actor identity, it resolves the current actor, it uses the service_role
  // delete-draft DB client, it calls only the delete-DRAFT domain
  // service/RPC path, and it still does not expose archive.
  describe('RB20 evolved contract (DD-34): delete-draft application wrapper exists and is narrowly scoped', () => {
    it('a delete-draft wrapper IS exported (RB20_CONTRACT_EVOLVED_BY_Q3F_5AQ_0R)', () => {
      const deleteDraftNames = names.filter((name) => /delete/i.test(name) && /draft/i.test(name));
      assert.ok(
        deleteDraftNames.length > 0,
        'expected a delete-draft wrapper export after Q3F-5AQ.0R (RB20 evolved)',
      );
    });

    it('deleteMappingDraftForActor is exported from mapping-runtime-wrappers.ts', () => {
      assert.match(wrappersSource, /export async function deleteMappingDraftForActor\(/);
    });

    it('deleteMappingDraftForCurrentActor is exported from server.ts', () => {
      assert.match(serverSource, /export async function deleteMappingDraftForCurrentActor\(/);
    });

    it("its exported input type is declared as Omit<DeleteMappingDraftInput, 'actorId'> (no actor field exposed)", () => {
      assert.match(
        wrappersSource,
        /export type DeleteMappingDraftForActorInput = Omit<[^;]*'actorId'[^;]*>;/,
      );
    });

    it('deleteMappingDraftForActor resolves the trusted current actor', () => {
      const body = extractExportedFunctionBody(wrappersSource, 'deleteMappingDraftForActor');
      assert.match(body, /resolveTrustedIndustryMappingActor\(/);
    });

    it('deleteMappingDraftForCurrentActor uses the service_role delete-draft DB client', () => {
      const body = extractExportedFunctionBody(serverSource, 'deleteMappingDraftForCurrentActor');
      assert.match(body, /createIndustryMappingDraftDeleteDbClient\(\)/);
    });

    it('the delete-draft wrapper path calls only the delete-DRAFT domain service (deleteMappingDraft), never archive/publish', () => {
      const body = extractExportedFunctionBody(wrappersSource, 'deleteMappingDraftForActor');
      assert.match(body, /\bdeleteMappingDraft\(/);
      assert.doesNotMatch(body, /archive/i);
      assert.doesNotMatch(body, /publishMappingSnapshot/);
    });

    it('still no archive wrapper is exported alongside the new delete-draft wrapper', () => {
      assert.ok(!names.some((name) => /archive/i.test(name)));
    });
  });
});

describe('no transport introduced by the delete-draft boundary (DD-26)', () => {
  it("neither server.ts nor mapping-runtime-wrappers.ts contains a 'use server' directive statement", () => {
    // Matches only an actual directive statement (a line consisting solely
    // of 'use server';), not the string appearing inside a doc comment
    // (both files' headers already say "no 'use server'" in prose).
    assert.doesNotMatch(combinedSource, /^\s*['"]use server['"];?\s*$/m);
  });

  it('neither file imports a Next.js route-handler/server-action transport surface', () => {
    assert.doesNotMatch(combinedSource, /next\/server/);
    assert.doesNotMatch(combinedSource, /NextRequest|NextResponse/);
  });
});

describe('production transport caller count remains 0 (DD-27)', () => {
  // TEMPORARY (Q3F-5AT.2): the reversible live-QA harness at
  // src/app/qa-industry-mapping-child-graph-harness/actions.ts is the ONE
  // permitted src/app caller of deleteMappingDraftForCurrentActor, gated by
  // an env kill switch + exact single-operator-email allowlist (see that
  // file). This allowlist entry — and the harness directory itself — must
  // be removed together once live QA validation is complete; every other
  // src/app caller must continue to fail this check.
  const TEMPORARY_DELETE_DRAFT_CALLER_ALLOWLIST = [
    path.join('qa-industry-mapping-child-graph-harness', 'actions.ts'),
  ];

  it('no file under src/app references deleteMappingDraftForCurrentActor (except the temporary QA harness allowlist)', () => {
    const appDir = path.join(moduleDir, '..', '..', '..', 'app');
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const relativePath = path.relative(appDir, fullPath);
        if (TEMPORARY_DELETE_DRAFT_CALLER_ALLOWLIST.includes(relativePath)) continue;
        const content = readFileSync(fullPath, 'utf8');
        if (content.includes('deleteMappingDraftForCurrentActor')) {
          offenders.push(fullPath);
        }
      }
    }

    walk(appDir);
    assert.deepEqual(offenders, [], `unexpected production transport caller(s): ${offenders.join(', ')}`);
  });

  it('no file under industry-mapping (outside this module’s own boundary/test files) references deleteMappingDraftForCurrentActor', () => {
    const industryMappingDir = path.join(moduleDir, '..');
    const allowedFiles = new Set(['server.ts']);
    const offenders: string[] = [];

    for (const entry of readdirSync(industryMappingDir, { withFileTypes: true })) {
      if (entry.isDirectory()) continue;
      if (!/\.ts$/.test(entry.name)) continue;
      if (allowedFiles.has(entry.name)) continue;
      const fullPath = path.join(industryMappingDir, entry.name);
      const content = readFileSync(fullPath, 'utf8');
      if (content.includes('deleteMappingDraftForCurrentActor')) {
        offenders.push(fullPath);
      }
    }

    assert.deepEqual(offenders, [], `unexpected production transport caller(s): ${offenders.join(', ')}`);
  });
});

describe('actor-surface hardening — no unsafe spread pattern (section 11)', () => {
  it('neither file spreads a raw `input` object into a domain call payload', () => {
    // The banned pattern from the brief: `{ actorId, ...input }` (or any
    // spread of `input` at all inside an object literal) — this file always
    // copies named fields explicitly instead.
    assert.doesNotMatch(combinedSource, /\.\.\.input\b/);
  });
});
