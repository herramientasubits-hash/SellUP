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
import { readFileSync } from 'node:fs';
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

describe('no archive or delete-draft wrapper exported (RB19, RB20)', () => {
  function exportedFunctionNames(source: string): string[] {
    return [...source.matchAll(/export async function (\w+)/g)].map((match) => match[1]);
  }

  it('RB19: no archive wrapper exported', () => {
    const names = [...exportedFunctionNames(serverSource), ...exportedFunctionNames(wrappersSource)];
    assert.ok(names.length > 0, 'sanity: expected to find exported functions');
    assert.ok(
      !names.some((name) => /archive/i.test(name)),
      `unexpected archive-related export found: ${names.filter((n) => /archive/i.test(n)).join(', ')}`,
    );
  });

  it('RB20: no delete-draft wrapper exported', () => {
    const names = [...exportedFunctionNames(serverSource), ...exportedFunctionNames(wrappersSource)];
    assert.ok(
      !names.some((name) => /delete/i.test(name) && /draft/i.test(name)),
      `unexpected delete-draft-related export found: ${names.filter((n) => /delete/i.test(n) && /draft/i.test(n)).join(', ')}`,
    );
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
