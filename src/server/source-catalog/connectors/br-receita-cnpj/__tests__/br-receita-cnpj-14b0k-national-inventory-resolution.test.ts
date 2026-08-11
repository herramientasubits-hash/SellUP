/**
 * BR Receita CNPJ — NATIONAL INVENTORY RESOLUTION — tests (BR-SOURCE-14B.0K § 19 tests 1–30).
 *
 * Two claims are under test, and neither may be allowed to imply the other:
 *
 *   1. The expected 2026-07 inventory is now KNOWN, from the publisher, with exact part identities — so
 *      the 14B.0J gate can finally decide instead of returning `indeterminate` for want of evidence.
 *   2. Knowing it authorizes NOTHING. Attempt #2 stays unauthorized, attempt #3 stays impossible, the
 *      consumed count stays 1, and no row was opened to reach either conclusion.
 *
 * ── The verdict under test is `incomplete`, and that is the finding ──────────────
 * The publisher publishes ten Empresas parts and ten Estabelecimentos parts for 2026-07. The staged local
 * input holds part `0` of each. The tests assert the SHAPE of that answer — which identities are missing,
 * not merely that a count fell short — because "acquire Empresas 1–9" is actionable and "one of ten" is
 * not.
 *
 * ── Nothing here reads real data ────────────────────────────────────────────────
 * Every local inventory in this file is a metadata FIXTURE: names, flags and sizes as plain records. The
 * one module that can touch a filesystem is the adapter, and it is exercised only by static scans that
 * read its source as TEXT. No dataset, no manifest, no Supabase, no runtime, no Agent 1, no Agent 2A, no
 * provider, no network, no git, no repository write.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import {
  BRAZIL_RECEITA_PUBLISHER_DERIVED_PROVENANCE,
  BRAZIL_RECEITA_PUBLISHER_HOST,
  BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07,
  BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07_CANONICAL_SHA256,
  BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07_RETRIEVED_AT,
  BRAZIL_RECEITA_PUBLISHER_INVENTORY_SOURCE,
  BRAZIL_RECEITA_PUBLISHER_INVENTORY_TRANSFORM,
  BRAZIL_RECEITA_PUBLISHER_RETRIEVAL_METHOD,
  BRAZIL_RECEITA_PUBLISHER_SOURCE,
  canonicalBrazilReceitaPublisherInventoryText,
  deriveBrazilReceitaExpectedPartKeys,
  deriveBrazilReceitaNationalExpectedInventory,
  parseBrazilReceitaPublisherInventory,
  parseBrazilReceitaPublisherInventory2026_07,
  type BrazilReceitaPublisherInventoryDocument,
  type BrazilReceitaPublisherInventoryEntry,
} from '../br-receita-cnpj-14b0k-publisher-inventory';
import {
  brazilReceitaNationalResolutionNextAction,
  classifyBrazilReceitaLocalInventory,
  resolveBrazilReceitaNationalInventory,
  BRAZIL_RECEITA_LOCAL_INPUT_EXPECTED_DECLARATION,
  type BrazilReceitaLocalInventoryEntry,
} from '../br-receita-cnpj-14b0k-national-inventory-resolution';
import { BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY } from '../br-receita-cnpj-manifest';
import {
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
  BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
} from '../br-receita-cnpj-real-benchmark-attempt-ledger';

const PERIOD = '2026-07';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function publisherDocument(
  entries: readonly BrazilReceitaPublisherInventoryEntry[],
  overrides: Partial<BrazilReceitaPublisherInventoryDocument> = {},
): BrazilReceitaPublisherInventoryDocument {
  return {
    publisher: BRAZIL_RECEITA_PUBLISHER_SOURCE,
    publisherHost: BRAZIL_RECEITA_PUBLISHER_HOST,
    sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
    period: PERIOD,
    retrievedAt: BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07_RETRIEVED_AT,
    retrievalMethod: BRAZIL_RECEITA_PUBLISHER_RETRIEVAL_METHOD,
    inventorySource: BRAZIL_RECEITA_PUBLISHER_INVENTORY_SOURCE,
    inventoryTransform: BRAZIL_RECEITA_PUBLISHER_INVENTORY_TRANSFORM,
    entries,
    ...overrides,
  };
}

function published(name: string, sizeBytes = 1024): BrazilReceitaPublisherInventoryEntry {
  return { name, publishedSizeBytes: sizeBytes, lastModified: 'Sun, 12 Jul 2026 18:20:08 GMT' };
}

/** A minimal but well-shaped listing: both join families in two parts, one lookup. */
function twoPartPublisherDocument(): BrazilReceitaPublisherInventoryDocument {
  return publisherDocument([
    published('Empresas0.zip'),
    published('Empresas1.zip'),
    published('Estabelecimentos0.zip'),
    published('Estabelecimentos1.zip'),
    published('Cnaes.zip'),
  ]);
}

function localFile(name: string, sizeBytes = 2048): BrazilReceitaLocalInventoryEntry {
  return { name, isRegularFile: true, isSymbolicLink: false, sizeBytes };
}

/** A local input matching `twoPartPublisherDocument` exactly. */
function completeLocalInput(): BrazilReceitaLocalInventoryEntry[] {
  return [
    localFile('empresas0.csv'),
    localFile('empresas1.csv'),
    localFile('estabelecimentos0.csv'),
    localFile('estabelecimentos1.csv'),
    localFile('cnaes.csv'),
  ];
}

/** The real staged 2026-07 input: part 0 of each join family, plus three lookups. */
function stagedSubsetLocalInput(): BrazilReceitaLocalInventoryEntry[] {
  return [
    localFile('cnaes.csv'),
    localFile('empresas0.csv'),
    localFile('estabelecimentos0.csv'),
    localFile('municipios.csv'),
    localFile('naturezas.csv'),
  ];
}

function resolve(
  overrides: Partial<Parameters<typeof resolveBrazilReceitaNationalInventory>[0]> = {},
) {
  return resolveBrazilReceitaNationalInventory({
    period: PERIOD,
    publisherDocument: twoPartPublisherDocument(),
    inputEntries: completeLocalInput(),
    inputDeclaration: BRAZIL_RECEITA_LOCAL_INPUT_EXPECTED_DECLARATION,
    ...overrides,
  });
}

const CONNECTOR_DIRECTORY = path.resolve(__dirname, '..');
const SCRIPTS_DIRECTORY = path.resolve(__dirname, '../../../../../../scripts/source-catalog');

/**
 * Source with comments removed.
 *
 * The static scans below must judge CODE, not prose: these modules document what they refuse to touch,
 * so a scan over raw text would trip on the header sentence "touches Supabase, a migration, the runtime"
 * and report the guarantee as its own violation.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function connectorSource(moduleBasename: string): string {
  return stripComments(
    fs.readFileSync(path.join(CONNECTOR_DIRECTORY, `${moduleBasename}.ts`), 'utf8'),
  );
}

const MILESTONE_MODULES = [
  'br-receita-cnpj-14b0k-publisher-inventory',
  'br-receita-cnpj-14b0k-national-inventory-resolution',
  'br-receita-cnpj-14b0k-local-inventory-fs',
] as const;

// ─── 1–9 · The authoritative publisher inventory ──────────────────────────────

describe('BR-SOURCE-14B.0K · publisher inventory (tests 1–9)', () => {
  it('1 · parses the landed 2026-07 artifact as authoritative', () => {
    const parsed = parseBrazilReceitaPublisherInventory2026_07();
    assert.equal(parsed.status, 'verified');
    assert.deepEqual(parsed.refusals, []);
    assert.equal(parsed.period, PERIOD);
    assert.equal(parsed.retrievedAt, BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07_RETRIEVED_AT);
  });

  it('2 · requires the exact period it was asked for', () => {
    const parsed = parseBrazilReceitaPublisherInventory(twoPartPublisherDocument(), PERIOD);
    assert.equal(parsed.status, 'verified');
  });

  it('3 · rejects a listing for a different period — no neighbouring month may stand in', () => {
    const parsed = parseBrazilReceitaPublisherInventory(twoPartPublisherDocument(), '2026-01');
    assert.equal(parsed.status, 'ambiguous');
    assert.ok(parsed.refusals.includes('publisher_period_mismatch'));
    assert.equal(deriveBrazilReceitaNationalExpectedInventory(parsed), null);
  });

  it('4 · rejects an empty publisher response as unavailable, never as "nothing missing"', () => {
    const parsed = parseBrazilReceitaPublisherInventory(publisherDocument([]), PERIOD);
    assert.equal(parsed.status, 'unavailable');
    assert.ok(parsed.refusals.includes('publisher_entries_empty'));
    assert.deepEqual(parsed.requiredFamilies, []);
  });

  it('5 · rejects a duplicated publisher part', () => {
    const parsed = parseBrazilReceitaPublisherInventory(
      publisherDocument([
        published('Empresas0.zip'),
        published('empresas0.zip'),
        published('Estabelecimentos0.zip'),
      ]),
      PERIOD,
    );
    assert.equal(parsed.status, 'ambiguous');
    assert.ok(parsed.refusals.includes('publisher_entry_duplicate'));
  });

  it('6 · rejects an ambiguous part shape and an ordinal gap', () => {
    const mixed = parseBrazilReceitaPublisherInventory(
      publisherDocument([
        published('Empresas.zip'),
        published('Empresas0.zip'),
        published('Estabelecimentos0.zip'),
      ]),
      PERIOD,
    );
    assert.equal(mixed.status, 'ambiguous');
    assert.ok(mixed.refusals.includes('publisher_family_part_shape_ambiguous'));

    const gapped = parseBrazilReceitaPublisherInventory(
      publisherDocument([
        published('Empresas0.zip'),
        published('Empresas2.zip'),
        published('Estabelecimentos0.zip'),
      ]),
      PERIOD,
    );
    assert.equal(gapped.status, 'ambiguous');
    assert.ok(gapped.refusals.includes('publisher_family_part_ordinal_gap'));

    const unparseable = parseBrazilReceitaPublisherInventory(
      publisherDocument([published('Empresas0.rar'), published('Estabelecimentos0.zip')]),
      PERIOD,
    );
    assert.equal(unparseable.status, 'ambiguous');
    assert.ok(unparseable.refusals.includes('publisher_entry_name_unparseable'));
  });

  it('7 · parses the Empresas inventory as exact identities 0–9', () => {
    const parsed = parseBrazilReceitaPublisherInventory2026_07();
    assert.deepEqual(deriveBrazilReceitaExpectedPartKeys(parsed, 'empresas'), [
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ]);
    const empresas = parsed.requiredFamilies.find((family) => family.family === 'empresas');
    assert.ok(empresas);
    assert.equal(empresas.parts.length, 10);
    assert.deepEqual(
      empresas.parts.map((part) => part.fileName).sort(),
      Array.from({ length: 10 }, (_, index) => `Empresas${index}.zip`),
    );
  });

  it('8 · parses the Estabelecimentos inventory as exact identities 0–9', () => {
    const parsed = parseBrazilReceitaPublisherInventory2026_07();
    assert.deepEqual(deriveBrazilReceitaExpectedPartKeys(parsed, 'estabelecimentos'), [
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ]);
    const family = parsed.requiredFamilies.find((entry) => entry.family === 'estabelecimentos');
    assert.ok(family);
    assert.equal(family.parts[0].publishedSizeBytes, 2164567397);
  });

  it('9 · parses the contract lookup families and keeps out-of-contract ones separate', () => {
    const parsed = parseBrazilReceitaPublisherInventory2026_07();
    assert.deepEqual(
      parsed.lookupFamilies.map((family) => family.family).sort(),
      ['cnaes', 'municipios', 'naturezas', 'simples'],
    );
    for (const family of parsed.lookupFamilies) {
      assert.deepEqual(
        family.parts.map((part) => part.partKey),
        ['single'],
      );
    }
    assert.deepEqual(
      parsed.outOfContractFamilies.map((family) => family.family).sort(),
      ['motivos', 'paises', 'qualificacoes'],
    );
    // Person-linked families are transcribed, classified and refused entry to the expectation (§ 4).
    assert.deepEqual(
      parsed.excludedPersonLinkedFamilies.map((family) => family.family),
      ['socios'],
    );
    const expected = deriveBrazilReceitaNationalExpectedInventory(parsed);
    assert.ok(expected);
    assert.deepEqual(
      (expected.families as readonly { family: string }[]).map((family) => family.family),
      ['empresas', 'estabelecimentos'],
    );
  });
});

// ─── 10–16 · Local comparison ─────────────────────────────────────────────────

describe('BR-SOURCE-14B.0K · local comparison (tests 10–16)', () => {
  it('10 · a local input matching the publisher exactly resolves to complete', () => {
    const resolution = resolve();
    assert.equal(resolution.authoritativeInventoryStatus, 'verified');
    assert.equal(resolution.nationalInputCompleteness, 'complete');
    assert.equal(resolution.gate.verdict, 'complete');
    assert.equal(resolution.gate.inputScope, 'full_national');
    assert.equal(
      brazilReceitaNationalResolutionNextAction(resolution),
      'OWNER AUTHORIZATION — SECOND REAL FULL-NATIONAL BENCHMARK',
    );
  });

  it('11 · a missing Empresas part resolves to incomplete and NAMES the identity', () => {
    const resolution = resolve({
      inputEntries: completeLocalInput().filter((entry) => entry.name !== 'empresas1.csv'),
    });
    assert.equal(resolution.nationalInputCompleteness, 'incomplete');
    const diff = resolution.requiredFamilyDiffs?.find((entry) => entry.family === 'empresas');
    assert.deepEqual(diff?.missing, ['1']);
    assert.deepEqual(diff?.extra, []);
    assert.equal(
      brazilReceitaNationalResolutionNextAction(resolution),
      'OWNER REVIEW — ACQUIRE ONLY MISSING 2026-07 PARTS',
    );
  });

  it('12 · a missing Estabelecimentos part resolves to incomplete', () => {
    const resolution = resolve({
      inputEntries: completeLocalInput().filter((entry) => entry.name !== 'estabelecimentos0.csv'),
    });
    assert.equal(resolution.nationalInputCompleteness, 'incomplete');
    assert.deepEqual(
      resolution.requiredFamilyDiffs?.find((entry) => entry.family === 'estabelecimentos')?.missing,
      ['0'],
    );
  });

  it('13 · a duplicated local part resolves to incomplete', () => {
    const resolution = resolve({
      inputEntries: [...completeLocalInput(), localFile('empresas1.txt')],
    });
    assert.equal(resolution.nationalInputCompleteness, 'incomplete');
    assert.deepEqual(
      resolution.duplicateParts.map((finding) => `${finding.family}:${finding.partKey}`),
      ['empresas:1'],
    );
  });

  it('14 · unrelated files are ignored, not treated as defects or substitutions', () => {
    const resolution = resolve({
      inputEntries: [
        ...completeLocalInput(),
        { name: '.DS_Store', isRegularFile: true, isSymbolicLink: false, sizeBytes: 6148 },
        localFile('manifest.json'),
        localFile('NOTES.md'),
      ],
    });
    assert.equal(resolution.nationalInputCompleteness, 'complete');
    assert.deepEqual(resolution.unexpectedFamilies, []);
    const scan = classifyBrazilReceitaLocalInventory([
      localFile('manifest.json'),
      localFile('report.log'),
    ]);
    assert.equal(scan.ignoredEntryCount, 2);
    assert.deepEqual(scan.families, []);

    // A defective part IS a defect, unlike an unrelated file.
    const zeroSize = resolve({
      inputEntries: completeLocalInput().map((entry) =>
        entry.name === 'empresas1.csv' ? { ...entry, sizeBytes: 0 } : entry,
      ),
    });
    assert.equal(zeroSize.nationalInputCompleteness, 'incomplete');
    assert.deepEqual(
      zeroSize.localPartDefects.map((finding) => finding.code),
      ['local_part_zero_size'],
    );

    const symlinked = resolve({
      inputEntries: completeLocalInput().map((entry) =>
        entry.name === 'empresas1.csv' ? { ...entry, isSymbolicLink: true } : entry,
      ),
    });
    assert.equal(symlinked.nationalInputCompleteness, 'incomplete');
    assert.deepEqual(
      symlinked.localPartDefects.map((finding) => finding.code),
      ['local_part_symlink'],
    );
  });

  it('15 · a person-linked family present ONLY on disk does not fail the dataset (§ 10)', () => {
    const resolution = resolve({
      archiveEntries: [
        localFile('Empresas0.zip'),
        localFile('Socios0.zip'),
        localFile('Socios1.zip'),
      ],
    });
    assert.equal(resolution.prohibitedFamilyPresentOnDisk, true);
    assert.equal(resolution.prohibitedFamilyIncludedInInput, false);
    assert.equal(resolution.nationalInputCompleteness, 'complete');
    // The critical security condition, stated positively.
    assert.equal(resolution.prohibitedFamilyIncludedInInput, false);
  });

  it('16 · a person-linked family IN the input is rejected, however complete the rest is', () => {
    const resolution = resolve({
      inputEntries: [...completeLocalInput(), localFile('socios0.csv')],
    });
    assert.equal(resolution.prohibitedFamilyIncludedInInput, true);
    assert.equal(resolution.prohibitedFamilyPresentOnDisk, true);
    assert.equal(resolution.nationalInputCompleteness, 'incomplete');
    assert.ok(
      resolution.gate.findings.some((finding) => finding.code === 'forbidden_person_linked_family'),
    );
  });
});

// ─── 17–20 · Provenance, derivation and the two indeterminate cases ────────────

describe('BR-SOURCE-14B.0K · provenance and indeterminacy (tests 17–20)', () => {
  it('17 · source provenance is retained and the artifact is unedited', () => {
    assert.equal(BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07.publisher, BRAZIL_RECEITA_PUBLISHER_SOURCE);
    assert.equal(BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07.publisherHost, BRAZIL_RECEITA_PUBLISHER_HOST);
    assert.equal(BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07.inventorySource, 'official');
    assert.equal(BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07.inventoryTransform, 'deterministic');
    assert.equal(BRAZIL_RECEITA_PUBLISHER_DERIVED_PROVENANCE, 'official_publisher_manifest');

    const canonical = canonicalBrazilReceitaPublisherInventoryText(
      BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07,
    );
    assert.equal(
      createHash('sha256').update(canonical).digest('hex'),
      BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07_CANONICAL_SHA256,
    );
    // Published sizes are preserved as metadata and are NOT a completeness criterion (§ 15): a local
    // part whose size differs from the published one is still counted as present.
    const resized = resolve({
      inputEntries: completeLocalInput().map((entry) => ({ ...entry, sizeBytes: 7 })),
    });
    assert.equal(resized.nationalInputCompleteness, 'complete');

    // A listing from any other host is refused however well-formed it is.
    const wrongHost = parseBrazilReceitaPublisherInventory(
      publisherDocument([published('Empresas0.zip'), published('Estabelecimentos0.zip')], {
        publisherHost: 'mirror.example.org',
      }),
      PERIOD,
    );
    assert.equal(wrongHost.status, 'ambiguous');
    assert.ok(wrongHost.refusals.includes('publisher_host_unexpected'));

    // An operator's own assertion is not evidence, so it cannot arrive through this module at all.
    const notOfficial = parseBrazilReceitaPublisherInventory(
      publisherDocument([published('Empresas0.zip'), published('Estabelecimentos0.zip')], {
        inventorySource: 'operator_assertion',
      }),
      PERIOD,
    );
    assert.equal(deriveBrazilReceitaNationalExpectedInventory(notOfficial), null);
  });

  it('18 · the gate is fed DERIVED identities, not a hardcoded count', () => {
    const source = connectorSource('br-receita-cnpj-14b0k-publisher-inventory');
    for (const forbidden of [
      'expectedEmpresasCount = 10',
      'expectedPartCount: 10',
      'range(0, 10)',
      'length: 10',
    ]) {
      assert.equal(source.includes(forbidden), false, `count-only shortcut present: ${forbidden}`);
    }
    // The expectation follows the artifact: a two-part listing yields two, not ten.
    const twoPart = parseBrazilReceitaPublisherInventory(twoPartPublisherDocument(), PERIOD);
    const expected = deriveBrazilReceitaNationalExpectedInventory(twoPart);
    assert.deepEqual(expected?.families, [
      { family: 'empresas', expectedPartCount: 2 },
      { family: 'estabelecimentos', expectedPartCount: 2 },
    ]);
    // And the identities survive, which a count could not express.
    assert.deepEqual(deriveBrazilReceitaExpectedPartKeys(twoPart, 'empresas'), ['0', '1']);
  });

  it('19 · an unobserved local input stays indeterminate — never complete, never diagnosed', () => {
    const resolution = resolve({ inputEntries: null });
    assert.equal(resolution.nationalInputCompleteness, 'indeterminate');
    assert.equal(resolution.gate.verdict, 'indeterminate');
    assert.equal(resolution.requiredFamilyDiffs, null, 'missing lists must be null, never []');
    assert.equal(resolution.lookupFamilyDiffs, null);
    assert.equal(
      brazilReceitaNationalResolutionNextAction(resolution),
      'OWNER REVIEW — AUTHORITATIVE INVENTORY UNAVAILABLE',
    );
  });

  it('20 · an unavailable publisher stays indeterminate and skips comparison entirely', () => {
    const absent = resolve({ publisherDocument: null });
    assert.equal(absent.authoritativeInventoryStatus, 'unavailable');
    assert.equal(absent.nationalInputCompleteness, 'indeterminate');
    assert.equal(absent.requiredFamilyDiffs, null);
    assert.ok(absent.publisher.refusals.includes('publisher_document_absent'));

    const ambiguous = resolve({
      publisherDocument: publisherDocument([published('Empresas0.zip'), published('Empresas2.zip')]),
    });
    assert.equal(ambiguous.authoritativeInventoryStatus, 'ambiguous');
    assert.equal(ambiguous.nationalInputCompleteness, 'indeterminate');
    assert.equal(ambiguous.requiredFamilyDiffs, null);
  });
});

// ─── 21–26 · Safety and the frozen attempt model ──────────────────────────────

describe('BR-SOURCE-14B.0K · safety and attempt model (tests 21–26)', () => {
  it('21 · no row is opened, and the pure modules have no filesystem port', () => {
    for (const moduleName of [
      'br-receita-cnpj-14b0k-publisher-inventory',
      'br-receita-cnpj-14b0k-national-inventory-resolution',
    ]) {
      const source = connectorSource(moduleName);
      for (const forbidden of ["from 'node:fs'", 'require(', 'readFileSync', 'createReadStream']) {
        assert.equal(source.includes(forbidden), false, `${moduleName} references ${forbidden}`);
      }
    }
    const resolution = resolve();
    assert.equal(resolution.rowsRead, 0);
    assert.equal(resolution.gate.rowsRead, 0);
    assert.equal(resolution.gate.filesOpened, 0);
  });

  it('22 · no source reader is invoked, and the adapter can only list and lstat', () => {
    const resolution = resolve();
    assert.equal(resolution.sourceReadCalls, 0);
    assert.equal(resolution.scanExecuted, false);
    assert.equal(resolution.joinExecuted, false);

    // Matched on the CALL, not on an `fs.` prefix: the adapter chains off `fs`, so a prefix-only scan
    // would pass against a file that had grown an `fs.readFileSync` on the next line.
    const adapter = connectorSource('br-receita-cnpj-14b0k-local-inventory-fs');
    for (const forbidden of [
      '.openSync(',
      '.readSync(',
      '.readFileSync(',
      'createReadStream',
      '.statSync(',
      '.writeFileSync(',
      '.rmSync(',
      '.unlinkSync(',
      '.renameSync(',
      '.copyFileSync(',
      '.chmodSync(',
      'child_process',
      '.globSync(',
      '.realpathSync(',
    ]) {
      assert.equal(adapter.includes(forbidden), false, `adapter references ${forbidden}`);
    }
    assert.ok(adapter.includes('.readdirSync('));
    assert.ok(adapter.includes('.lstatSync('));
  });

  it('23 · no benchmark is executed by any code path in this milestone', () => {
    const resolution = resolve();
    assert.equal(resolution.secondRealBenchmarkExecuted, false);
    for (const moduleName of MILESTONE_MODULES) {
      const source = connectorSource(moduleName);
      for (const forbidden of [
        'runBrazilReceitaRealFullScanResourceBenchmark',
        'runBrazilReceitaFullJoin',
        'recordAttempt',
      ]) {
        assert.equal(source.includes(forbidden), false, `${moduleName} references ${forbidden}`);
      }
    }
  });

  it('24 · attemptsConsumed remains 1 and the structural ceiling remains 2', () => {
    const resolution = resolve();
    assert.equal(resolution.attemptsConsumed, 1);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED, 1);
    assert.equal(resolution.structurallySupportedAttempts, 2);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS, 2);
    assert.equal(resolution.nextRealAttemptNumber, 2);
    assert.equal(resolution.attempt1InputScope, 'staged_subset');
    assert.equal(resolution.attempt2RequiredInputScope, 'full_national');
  });

  it('25 · attempt #2 stays unauthorized and unexecuted even on a complete verdict', () => {
    const complete = resolve();
    assert.equal(complete.nationalInputCompleteness, 'complete');
    assert.equal(complete.attempt2Authorized, false);
    assert.equal(complete.attempt2Executed, false);
    // The next action is an authorization REQUEST, never an execution.
    assert.ok(brazilReceitaNationalResolutionNextAction(complete).startsWith('OWNER AUTHORIZATION'));
  });

  it('26 · attempt #3 remains impossible and there is no reset path', () => {
    const resolution = resolve();
    assert.equal(resolution.attempt3Allowed, false);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED, false);
    for (const moduleName of MILESTONE_MODULES) {
      const source = connectorSource(moduleName);
      for (const forbidden of ['reset', 'ATTEMPTS_CONSUMED =', 'attemptsConsumed =']) {
        assert.equal(source.includes(forbidden), false, `${moduleName} references ${forbidden}`);
      }
    }
  });
});

// ─── 27–30 · Blast radius ─────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0K · blast radius (tests 27–30)', () => {
  const CLI_SOURCE = stripComments(
    fs.readFileSync(
      path.join(SCRIPTS_DIRECTORY, 'run-br-receita-cnpj-14b0k-national-inventory-resolution.ts'),
      'utf8',
    ),
  );

  const ALL_SOURCES = [
    ...MILESTONE_MODULES.map((moduleName) => [moduleName, connectorSource(moduleName)] as const),
    ['14b0k-cli', CLI_SOURCE] as const,
  ];

  it('27 · no Supabase, no migration, no database client', () => {
    for (const [label, source] of ALL_SOURCES) {
      for (const forbidden of ['supabase', 'createClient', 'migration', 'sql`', 'postgres']) {
        assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, `${label}: ${forbidden}`);
      }
    }
  });

  it('28 · no runtime, no network, no process spawn', () => {
    for (const [label, source] of ALL_SOURCES) {
      for (const forbidden of ['fetch(', 'node:http', 'node:https', 'child_process', 'node:net']) {
        assert.equal(source.includes(forbidden), false, `${label}: ${forbidden}`);
      }
    }
  });

  it('29 · no Agent 1 and no Agent 2A surface', () => {
    for (const [label, source] of ALL_SOURCES) {
      for (const forbidden of ['prospect_candidates', 'wizard', 'prospecting-toolkit', 'contact_enrichment']) {
        assert.equal(source.includes(forbidden), false, `${label}: ${forbidden}`);
      }
    }
  });

  it('30 · no provider, no HubSpot, no Slack, no UI', () => {
    for (const [label, source] of ALL_SOURCES) {
      for (const forbidden of ['apollo', 'lusha', 'tavily', 'hubspot', 'slack', 'react']) {
        assert.equal(source.toLowerCase().includes(forbidden), false, `${label}: ${forbidden}`);
      }
    }
  });

  it('30b · the staged 2026-07 input resolves to incomplete against the real publisher listing', () => {
    // The milestone's actual finding, asserted end to end: parts 1–9 of both join families are absent.
    const resolution = resolveBrazilReceitaNationalInventory({
      period: PERIOD,
      publisherDocument: BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07,
      inputEntries: stagedSubsetLocalInput(),
      archiveEntries: [
        localFile('Cnaes.zip'),
        localFile('Empresas0.zip'),
        localFile('Estabelecimentos0.zip'),
        localFile('Municipios.zip'),
        localFile('Naturezas.zip'),
      ],
      inputDeclaration: BRAZIL_RECEITA_LOCAL_INPUT_EXPECTED_DECLARATION,
    });
    assert.equal(resolution.authoritativeInventoryStatus, 'verified');
    assert.equal(resolution.nationalInputCompleteness, 'incomplete');
    const missing = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    assert.deepEqual(
      resolution.requiredFamilyDiffs?.find((diff) => diff.family === 'empresas')?.missing,
      missing,
    );
    assert.deepEqual(
      resolution.requiredFamilyDiffs?.find((diff) => diff.family === 'estabelecimentos')?.missing,
      missing,
    );
    assert.equal(resolution.prohibitedFamilyPresentOnDisk, false);
    assert.equal(resolution.prohibitedFamilyIncludedInInput, false);
    assert.equal(resolution.gate.inputScope, 'staged_subset');
    assert.equal(resolution.attempt2Authorized, false);
    assert.equal(
      brazilReceitaNationalResolutionNextAction(resolution),
      'OWNER REVIEW — ACQUIRE ONLY MISSING 2026-07 PARTS',
    );
  });
});
