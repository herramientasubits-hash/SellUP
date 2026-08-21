/**
 * BR Receita CNPJ — NATIONAL MULTI-PART INPUT — tests (BR-SOURCE-14B.0M).
 *
 * Covers the three layers the audit found blocking 10-parts-per-family input:
 *   - the manifest validator's identity check, which used to be `fileType` alone;
 *   - the manifest→descriptor bridge's identity check and descriptor ordering;
 *   - the streaming join engine, exercised end to end with 10 Empresas + 10 Estabelecimentos
 *     synthetic files, proving the whole chain (not just the engine, which already supported
 *     N descriptors per family before this milestone).
 *
 * 100% synthetic and offline. No real manifest, no real dataset, no Supabase, no network, no
 * runtime, no Agent 1.
 */

import assert from 'node:assert/strict';
import { after, afterEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  validateBrReceitaCnpjLocalManifest,
  BR_RECEITA_CNPJ_MANIFEST_MAX_FILES_LIMIT,
} from '../br-receita-cnpj-manifest-validator';
import type { BrReceitaCnpjManifest, BrReceitaCnpjManifestFile } from '../br-receita-cnpj-manifest';
import {
  resolveBrazilReceitaFullJoinManifestSources,
  type BrazilReceitaFullJoinBridgeFileSystem,
  type BrazilReceitaFullJoinBridgeManifestValidator,
} from '../br-receita-cnpj-full-join-manifest-source-bridge';
import { runBrazilReceitaFullJoinStreamingEngineOnce } from '../br-receita-cnpj-full-join-engine';
import { createBrazilReceitaFullJoinNullBenchmarkSink } from '../br-receita-cnpj-full-join-engine-contract';
import {
  brazilReceitaFullJoinSyntheticKey,
  computeBrazilReceitaFullJoinSyntheticOracle,
  brazilReceitaFullJoinFixtureRunDefaults,
  createBrazilReceitaFullJoinFixture,
  type BrazilReceitaFullJoinFixtureHandle,
  type BrazilReceitaFullJoinFixtureScenario,
} from '../br-receita-cnpj-full-join-engine-fixtures';
import {
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from '../br-receita-cnpj-full-join-engine-fs';
import { createBrazilReceitaFullJoinResourceProcessDependencies } from '../br-receita-cnpj-full-join-resource-envelope';

// ═══════════════════════════════════════════════════════════════════════════════
// A. Manifest validator — identity is (fileType, partOrdinal), not fileType alone
// ═══════════════════════════════════════════════════════════════════════════════

const CSV_HEADERS: Record<string, string> = {
  empresas: 'cnpj_basico,razao_social,natureza_juridica,capital_social,porte_empresa',
  estabelecimentos:
    'cnpj_basico,cnpj_ordem,cnpj_dv,identificador_matriz_filial,situacao_cadastral,uf,municipio',
};
const CSV_DATA_ROW: Record<string, string> = {
  empresas: 'AB,Synthetic Ltda,2062,100.00,03',
  estabelecimentos: 'AB,0001,00,1,02,SP,Sao Paulo',
};

const createdDirs: string[] = [];
after(() => {
  for (const dir of createdDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

/** Writes `count` distinct synthetic part files for `fileType`, at partOrdinal 0..count-1. */
function nationalParts(fileType: 'empresas' | 'estabelecimentos', count: number): BrReceitaCnpjManifestFile[] {
  return Array.from({ length: count }, (_, partOrdinal) => ({
    fileType,
    path: `${fileType}${partOrdinal}.csv`,
    encoding: 'utf8' as const,
    delimiter: ',' as const,
    partOrdinal,
  }));
}

function baseFullNationalManifest(): BrReceitaCnpjManifest {
  return {
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    mode: 'local_manifest_validation',
    inputScope: 'full_national',
    files: [...nationalParts('empresas', 10), ...nationalParts('estabelecimentos', 10)],
  };
}

function writeManifestFixture(manifest: BrReceitaCnpjManifest): { manifestPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brs14b0m-'));
  createdDirs.push(dir);
  const written = new Set<string>();
  for (const file of manifest.files) {
    if (written.has(file.path)) continue;
    written.add(file.path);
    const kind = file.fileType === 'empresas' ? 'empresas' : 'estabelecimentos';
    fs.writeFileSync(path.join(dir, file.path), `${CSV_HEADERS[kind]}\n${CSV_DATA_ROW[kind]}\n`);
  }
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifestPath };
}

function validateManifest(manifest: BrReceitaCnpjManifest) {
  const { manifestPath } = writeManifestFixture(manifest);
  return validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: true, strict: true });
}

describe('BR-SOURCE-14B.0M — manifest validator accepts distinct national parts', () => {
  // Test 1 + 2 + 3.
  it('accepts 10 Empresas and 10 Estabelecimentos parts, retaining all 20 exact identities', async () => {
    const result = await validateManifest(baseFullNationalManifest());
    assert.equal(result.ok, true, JSON.stringify(result.reasonCode));
    assert.equal(result.inputScope, 'full_national');
    assert.equal(result.filesSeen, 20);
    assert.equal(result.filesAccepted, 20);
    const identities = result.fileReports.map((r) => `${r.fileType}:${r.partOrdinal}`);
    const expected = [
      ...Array.from({ length: 10 }, (_, i) => `empresas:${i}`),
      ...Array.from({ length: 10 }, (_, i) => `estabelecimentos:${i}`),
    ];
    assert.deepEqual([...identities].sort(), [...expected].sort());
    assert.equal(new Set(identities).size, 20, 'all 20 identities must be distinct');
  });

  // Test 5 + 6.
  it('rejects a duplicate exact part (same fileType AND partOrdinal)', async () => {
    const manifest = baseFullNationalManifest();
    manifest.files = [
      { fileType: 'empresas', path: 'empresas0.csv', partOrdinal: 0 },
      { fileType: 'empresas', path: 'empresas0-again.csv', partOrdinal: 0 },
      { fileType: 'estabelecimentos', path: 'estabelecimentos0.csv', partOrdinal: 0 },
    ];
    manifest.inputScope = 'staged_subset';
    fs.writeFileSync(
      path.join(os.tmpdir(), 'unused-placeholder-never-read.txt'),
      '',
    );
    const result = await validateManifest(manifest);
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, 'duplicate_file_type');
  });

  it('rejects two entries that both omit partOrdinal for the same fileType (both default to 0)', async () => {
    const manifest = baseFullNationalManifest();
    manifest.files = [
      { fileType: 'empresas', path: 'empresas-a.csv' },
      { fileType: 'empresas', path: 'empresas-b.csv' },
      { fileType: 'estabelecimentos', path: 'estabelecimentos0.csv' },
    ];
    manifest.inputScope = 'staged_subset';
    const result = await validateManifest(manifest);
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, 'duplicate_file_type');
  });

  // Test 7.
  it('refuses full_national scope when a required family is missing a national part', async () => {
    const manifest = baseFullNationalManifest();
    // Drop Empresas part 7 — 9 of 10 present.
    manifest.files = manifest.files.filter(
      (f) => !(f.fileType === 'empresas' && f.partOrdinal === 7),
    );
    const result = await validateManifest(manifest);
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, 'missing_national_part');
  });

  // Test 41 (part of the multi-part contract, not the attempt ledger).
  it('rejects an out-of-range partOrdinal', async () => {
    const manifest = baseFullNationalManifest();
    manifest.inputScope = 'staged_subset';
    manifest.files = [
      { fileType: 'empresas', path: 'empresas.csv', partOrdinal: 10 },
      { fileType: 'estabelecimentos', path: 'estabelecimentos.csv' },
    ];
    const result = await validateManifest(manifest);
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, 'part_ordinal_invalid');
  });

  it('rejects an unrecognized inputScope value', async () => {
    const manifest = baseFullNationalManifest();
    // @ts-expect-error — deliberately invalid, to exercise the fail-closed rejection.
    manifest.inputScope = 'entire_planet';
    const result = await validateManifest(manifest);
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, 'input_scope_invalid');
  });

  // Test 10.
  it('leaves a single-part manifest as staged_subset by default, and it still validates', async () => {
    const manifest: BrReceitaCnpjManifest = {
      sourceKey: 'br_receita_cnpj_dados_abertos',
      countryCode: 'BR',
      sourceYear: 2026,
      sourcePeriod: '2026-07',
      mode: 'local_manifest_validation',
      files: [
        { fileType: 'empresas', path: 'empresas.csv' },
        { fileType: 'estabelecimentos', path: 'estabelecimentos.csv' },
      ],
    };
    const result = await validateManifest(manifest);
    assert.equal(result.ok, true, JSON.stringify(result.reasonCode));
    assert.equal(result.inputScope, 'staged_subset');
    assert.deepEqual(result.fileReports.map((r) => r.partOrdinal), [0, 0]);
  });

  it('stays under the existing hard file-count ceiling with a full 10+10 national manifest', () => {
    assert.ok(20 <= BR_RECEITA_CNPJ_MANIFEST_MAX_FILES_LIMIT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. Manifest → descriptor bridge — deterministic order, all 20 descriptors emitted
// ═══════════════════════════════════════════════════════════════════════════════

function scriptedBridgeFileSystem(): BrazilReceitaFullJoinBridgeFileSystem {
  return {
    readManifestDocument: () => '{}', // overwritten per-call via the validator+document, not this port
    isSymbolicLink: () => false,
    realPath: (targetPath) => targetPath,
    isRegularFile: () => true,
  };
}

function scriptedValidator(): BrazilReceitaFullJoinBridgeManifestValidator {
  return async () =>
    ({
      ok: true,
      sourceKey: 'br_receita_cnpj_dados_abertos',
      countryCode: 'BR',
      sourceYear: 2026,
      sourcePeriod: '2026-07',
      inputScope: 'full_national',
      filesSeen: 20,
      filesAccepted: 20,
      filesRejected: 0,
      fileReports: [],
      safety: {
        datasetDownload: false,
        supabaseWrite: false,
        productionImport: false,
        runtimeIntegration: false,
        agent1Integration: false,
        hubspot: false,
        slack: false,
        liveProspectGeneration: false,
      },
    }) as Awaited<ReturnType<BrazilReceitaFullJoinBridgeManifestValidator>>;
}

const BRIDGE_MANIFEST_PATH = '/synthetic/br-14b0m/manifest/synthetic-manifest.json';
const BRIDGE_MANIFEST_DIRECTORY = path.dirname(BRIDGE_MANIFEST_PATH);

function nationalManifestDocument(shuffle: boolean): string {
  const empresas = Array.from({ length: 10 }, (_, partOrdinal) => ({
    fileType: 'empresas',
    path: `empresas${partOrdinal}.csv`,
    partOrdinal,
    encoding: 'latin1',
    delimiter: ';',
    layoutMode: 'official_headerless',
  }));
  const estabelecimentos = Array.from({ length: 10 }, (_, partOrdinal) => ({
    fileType: 'estabelecimentos',
    path: `estabelecimentos${partOrdinal}.csv`,
    partOrdinal,
    encoding: 'latin1',
    delimiter: ';',
    layoutMode: 'official_headerless',
  }));
  let files = [...empresas, ...estabelecimentos];
  if (shuffle) {
    // Deliberately reversed and interleaved — order must NOT affect the resolved descriptor order.
    files = [...estabelecimentos].reverse().concat([...empresas].reverse());
  }
  return JSON.stringify({
    mode: 'local_manifest_validation',
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    layoutMode: 'official_headerless',
    inputScope: 'full_national',
    files,
  });
}

describe('BR-SOURCE-14B.0M — the manifest bridge emits all 20 descriptors, deterministically ordered', () => {
  // Test 11 + 12 + 13.
  it('emits exactly 20 descriptors, none dropped, with manifestPartOrdinal preserved', async () => {
    const outcome = await resolveBrazilReceitaFullJoinManifestSources({
      manifestPath: BRIDGE_MANIFEST_PATH,
      fileSystem: {
        ...scriptedBridgeFileSystem(),
        readManifestDocument: () => nationalManifestDocument(false),
      },
      validateManifest: scriptedValidator(),
      allowRealLocalFiles: false,
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.joinSources.length, 20);
    const empresas = outcome.joinSources.filter((s) => s.family === 'empresas');
    const estabelecimentos = outcome.joinSources.filter((s) => s.family === 'estabelecimentos');
    assert.equal(empresas.length, 10);
    assert.equal(estabelecimentos.length, 10);
    assert.deepEqual(
      [...empresas.map((s) => s.manifestPartOrdinal)].sort((a, b) => (a ?? 0) - (b ?? 0)),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    assert.deepEqual(
      [...estabelecimentos.map((s) => s.manifestPartOrdinal)].sort((a, b) => (a ?? 0) - (b ?? 0)),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    for (const source of outcome.joinSources) {
      assert.equal(path.dirname(source.filePath), BRIDGE_MANIFEST_DIRECTORY);
    }
  });

  // Test 4 (multi-part contract) + deterministic order (§ 9).
  it('sorts descriptors by (family contractual order, partOrdinal ascending), regardless of manifest document order', async () => {
    const inOrder = await resolveBrazilReceitaFullJoinManifestSources({
      manifestPath: BRIDGE_MANIFEST_PATH,
      fileSystem: {
        ...scriptedBridgeFileSystem(),
        readManifestDocument: () => nationalManifestDocument(false),
      },
      validateManifest: scriptedValidator(),
      allowRealLocalFiles: false,
    });
    const shuffled = await resolveBrazilReceitaFullJoinManifestSources({
      manifestPath: BRIDGE_MANIFEST_PATH,
      fileSystem: {
        ...scriptedBridgeFileSystem(),
        readManifestDocument: () => nationalManifestDocument(true),
      },
      validateManifest: scriptedValidator(),
      allowRealLocalFiles: false,
    });
    assert.equal(inOrder.ok, true);
    assert.equal(shuffled.ok, true);
    if (!inOrder.ok || !shuffled.ok) return;

    const shape = (outcome: typeof inOrder) =>
      outcome.joinSources.map((s) => ({
        family: s.family,
        partOrdinal: s.manifestPartOrdinal,
        sourceFileOrdinal: s.sourceFileOrdinal,
      }));
    assert.deepEqual(shape(inOrder), shape(shuffled));

    // Explicitly: empresas (all 10, ascending) before estabelecimentos (all 10, ascending).
    assert.deepEqual(
      inOrder.joinSources.map((s) => s.family),
      [...Array(10).fill('empresas'), ...Array(10).fill('estabelecimentos')],
    );
    assert.deepEqual(
      inOrder.joinSources.map((s) => s.sourceFileOrdinal),
      Array.from({ length: 20 }, (_, i) => i),
    );
  });

  it('still rejects a genuine duplicate part (same family AND partOrdinal)', async () => {
    const document = JSON.stringify({
      mode: 'local_manifest_validation',
      sourceKey: 'br_receita_cnpj_dados_abertos',
      countryCode: 'BR',
      sourceYear: 2026,
      sourcePeriod: '2026-07',
      layoutMode: 'official_headerless',
      files: [
        {
          fileType: 'empresas',
          path: 'empresas0.csv',
          partOrdinal: 0,
          encoding: 'latin1',
          delimiter: ';',
          layoutMode: 'official_headerless',
        },
        {
          fileType: 'empresas',
          path: 'empresas0-again.csv',
          partOrdinal: 0,
          encoding: 'latin1',
          delimiter: ';',
          layoutMode: 'official_headerless',
        },
        {
          fileType: 'estabelecimentos',
          path: 'estabelecimentos0.csv',
          encoding: 'latin1',
          delimiter: ';',
          layoutMode: 'official_headerless',
        },
      ],
    });
    const outcome = await resolveBrazilReceitaFullJoinManifestSources({
      manifestPath: BRIDGE_MANIFEST_PATH,
      fileSystem: { ...scriptedBridgeFileSystem(), readManifestDocument: () => document },
      validateManifest: scriptedValidator(),
      allowRealLocalFiles: false,
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.ok(outcome.findings.some((f) => f.rejection === 'family_duplicated'));
  });

  it('rejects an out-of-range partOrdinal at the bridge layer too', async () => {
    const document = JSON.stringify({
      mode: 'local_manifest_validation',
      sourceKey: 'br_receita_cnpj_dados_abertos',
      countryCode: 'BR',
      sourceYear: 2026,
      sourcePeriod: '2026-07',
      layoutMode: 'official_headerless',
      files: [
        {
          fileType: 'empresas',
          path: 'empresas.csv',
          partOrdinal: 99,
          encoding: 'latin1',
          delimiter: ';',
          layoutMode: 'official_headerless',
        },
        {
          fileType: 'estabelecimentos',
          path: 'estabelecimentos.csv',
          encoding: 'latin1',
          delimiter: ';',
          layoutMode: 'official_headerless',
        },
      ],
    });
    const outcome = await resolveBrazilReceitaFullJoinManifestSources({
      manifestPath: BRIDGE_MANIFEST_PATH,
      fileSystem: { ...scriptedBridgeFileSystem(), readManifestDocument: () => document },
      validateManifest: scriptedValidator(),
      allowRealLocalFiles: false,
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.ok(outcome.findings.some((f) => f.rejection === 'part_ordinal_invalid'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. Engine end-to-end — synthetic 10+10 parts reach the join, cross-part matches work
// ═══════════════════════════════════════════════════════════════════════════════

const MEGABYTE = 1024 * 1024;

let handles: BrazilReceitaFullJoinFixtureHandle[] = [];
afterEach(() => {
  for (const handle of handles) handle.dispose();
  handles = [];
});

function fixture(scenario: BrazilReceitaFullJoinFixtureScenario): BrazilReceitaFullJoinFixtureHandle {
  const handle = createBrazilReceitaFullJoinFixture(scenario);
  handles.push(handle);
  return handle;
}

function engineRequest(handle: BrazilReceitaFullJoinFixtureHandle, maxFilesOpened = 64) {
  return {
    sources: handle.sources,
    readerCaps: { maxChunkBytes: 4096, maxCarryBytes: 4 * 1024, maxRowBytes: 4 * 1024, maxColumnsPerRow: 64 },
    partitioningCaps: {
      // Deliberately small: 2 partitions × 2 families = at most 4 partition handles open at once,
      // so `filesOpenedPeak` (asserted below) is dominated by SOURCE handles, not partition handles
      // — which is the number this test actually cares about proving stays low.
      partitionCount: 2,
      maxPartitionCount: 32,
      maxPartitionDepth: 3,
      maxReferencesPerPartition: 10_000,
      maxReferenceBytesPerPartition: 1024 * 1024,
    },
    resourceCaps: {
      maxRssBytes: 8 * 1024 * MEGABYTE,
      maxHeapUsedBytes: 2 * 1024 * MEGABYTE,
      maxExternalMemoryBytes: 2 * 1024 * MEGABYTE,
      maxRuntimeMs: 10 * 60 * 1000,
      maxPhaseRuntimeMs: 10 * 60 * 1000,
      maxTemporaryStorageBytes: 1024 * 1024,
      // Well under 20 — proves the engine never holds anywhere near one handle per descriptor.
      maxFilesOpened,
      maxBytesRead: 10 * 1000 * 1000,
      maxRowsRead: 100 * 1000,
      maxJoinKeysInMemory: 10_000,
      maxOutputRows: 0,
    },
    duplicateKeyPolicy: 'pair_with_every_duplicate' as const,
    sink: createBrazilReceitaFullJoinNullBenchmarkSink(),
    readerFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
    workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
    workspaceParentDirectory: handle.workspaceParentDirectory,
    workspaceBoundaries: {
      repositoryRoot: '/workspaces/sellup-worktrees/br-14b0m',
      homeDirectory: '/home/operator',
      datasetRoot: handle.datasetRoot,
    },
    resourceDependencies: createBrazilReceitaFullJoinResourceProcessDependencies(),
    ...brazilReceitaFullJoinFixtureRunDefaults(),
    realDataRun: false,
    sinkMaterializesRows: false,
  };
}

function companyRows(count: number, startIndex: number) {
  return Array.from({ length: count }, (_, index) => ({
    key: brazilReceitaFullJoinSyntheticKey(startIndex + index),
  }));
}

describe('BR-SOURCE-14B.0M — synthetic 10+10 national-shaped E2E', () => {
  it('reaches every one of the 20 parts, joins across parts, and matches the independent oracle', async () => {
    // 10 Empresas parts (10 companies each, keys 1..100) + 10 Estabelecimentos parts, deliberately
    // NOT aligned 1:1 with the same ordinal — establishment keys 1..100 land in Estabelecimentos
    // parts in a DIFFERENT arrangement, so a match only happens through the join KEY, never through
    // matching ordinals (§ 19: the join is by key, not by physical part number).
    const empresasFiles = Array.from({ length: 10 }, (_, part) => ({
      family: 'empresas' as const,
      rows: companyRows(10, part * 10 + 1),
    }));
    const estabelecimentosFiles = Array.from({ length: 10 }, (_, part) => ({
      family: 'estabelecimentos' as const,
      // Offset by one part's width: Estabelecimentos part 0 carries the keys Empresas part 1 owns,
      // etc. (wrapping), so no ordinal lines up with its own company part.
      rows: companyRows(10, ((part + 1) % 10) * 10 + 1),
    }));
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [...empresasFiles, ...estabelecimentosFiles],
    };
    const handle = fixture(scenario);
    assert.equal(handle.sources.length, 20);
    assert.equal(handle.sources.filter((s) => s.family === 'empresas').length, 10);
    assert.equal(handle.sources.filter((s) => s.family === 'estabelecimentos').length, 10);

    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle, 64));

    const oracle = computeBrazilReceitaFullJoinSyntheticOracle(scenario);
    assert.equal(result.exitStatus, 'completed', JSON.stringify(result.abortCode));
    assert.equal(result.exact.matchesEmitted, oracle.expectedMatches, 'match count vs. independent oracle');
    assert.equal(result.exact.matchesEmitted, 100, 'every one of the 100 keys must match exactly once');
    assert.equal(result.exact.empresaRowsTraversed, 100, 'all 100 empresa rows, across all 10 parts');
    assert.equal(
      result.exact.estabelecimentoRowsTraversed,
      100,
      'all 100 estabelecimento rows, across all 10 parts',
    );
    assert.equal(result.exact.filesTraversedToEndOfFile, 20, 'every one of the 20 parts reached EOF');
    assert.equal(result.exact.sourceFilesDeclared, 20);
    assert.equal(result.publicReport.every_source_traversed_to_end_of_file, true);
    // NullBenchmarkSink: the benchmark never materializes a matched row.
    assert.equal(result.cleanupOutcome, 'completed');
  });

  /**
   * IMPORTANT — this test documents an HONEST finding, not the "SOURCE_HANDLES_PEAK <= 1" the
   * brief hoped for. The engine's join phase (`keyOf()`/`handleFor()` in
   * `br-receita-cnpj-full-join-engine.ts`) caches ONE open handle per distinct `sourceFileOrdinal`
   * it needs to re-read a row from, and only closes the whole cache once — AFTER the partition
   * loop ends (`for (const handle of handles.values()) { readerFileSystem.close(handle); }`,
   * reached only once `estabelecimentos_read` is fully done). That design predates this milestone
   * and needed no source-count-N descriptor to exist to be true; a national 10+10 manifest simply
   * gives it 20 ordinals to accumulate handles for instead of 2–5.
   *
   * So `SOURCE_HANDLES_PEAK` for a full national join is bounded by the number of DISTINCT source
   * ordinals whose references get re-read during the join phase — up to 20, not ≤ 1. This is safe
   * (still far under `maxFilesOpened: 64` in the real proposed caps, and under the OS descriptor
   * limit) but it is not the "sequential, one-at-a-time" source access the brief asked this
   * milestone to verify. Fixing that would mean changing the join phase's handle-caching strategy —
   * an engine behavior change outside what this milestone's audit found needed for multi-part input,
   * and risky to make under this brief's own "no engine redesign" / "reuse the productive engine"
   * constraint. Reported here rather than silently asserted away.
   */
  it('[FINDING] source handle peak scales with distinct touched ordinals, not <=1, for a 20-part join', async () => {
    const empresasFiles = Array.from({ length: 10 }, (_, part) => ({
      family: 'empresas' as const,
      rows: companyRows(10, part * 10 + 1),
    }));
    const estabelecimentosFiles = Array.from({ length: 10 }, (_, part) => ({
      family: 'estabelecimentos' as const,
      rows: companyRows(10, ((part + 1) % 10) * 10 + 1),
    }));
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [...empresasFiles, ...estabelecimentosFiles],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle, 64));
    assert.equal(result.exitStatus, 'completed', JSON.stringify(result.abortCode));
    // The measured peak includes every distinct source ordinal touched during the join PLUS the
    // partition handles open at the time — comfortably inside 64, but well above 1.
    assert.ok(
      result.exact.filesOpenedPeak > handle.sources.length / 2,
      `expected the join-phase handle cache to dominate filesOpenedPeak (got ${result.exact.filesOpenedPeak}) — ` +
        'if this ever drops near 1, the handle-caching strategy changed and this finding is stale',
    );
    assert.ok(result.exact.filesOpenedPeak <= 64, 'must still clear the real proposed maxFilesOpened cap');
  });
});
