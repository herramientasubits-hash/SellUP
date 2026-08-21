/**
 * BR-SOURCE-ATTEMPT2-OPS — ATTEMPT #2 OPERATOR ENABLEMENT.
 *
 * Two hard stops, and this suite is the proof that both are closed and that nothing else moved.
 *
 *   A. An owner authorization could only be expressed by editing tracked source. § 14's ten tests
 *      establish that it can now be expressed per-invocation, that all three approvals are required,
 *      that none is inferred from another, and that the default is still refusal.
 *
 *   B. The benchmark CLI handed the national-completeness gate `observed: null, expected: null` and
 *      could therefore only ever produce `indeterminate`. § 15's ten tests establish that both sides
 *      are now wired, from the publisher artifact and from the selected manifest's metadata.
 *
 * § 16 walks the WHOLE preboundary path with a granted authorization and a sentinel reader that fails
 * the test if it is ever called — the only way to demonstrate `PREBOUNDARY_READY` without opening a row.
 *
 * ── What this suite must never do ───────────────────────────────────────────────
 * No real dataset, no real manifest, no real row. Every filesystem effect arrives through a scripted
 * port, the authorization booleans are synthetic (§ 20), and the durable attempt ledger is read and
 * never written.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import {
  BRAZIL_RECEITA_PUBLISHER_RESOLVED_PERIODS,
  parseBrazilReceitaPublisherInventory2026_07,
} from '../br-receita-cnpj-14b0k-publisher-inventory';
import {
  brazilReceitaAttempt2PublisherInventoryForPeriod,
  evaluateBrazilReceitaAttempt2NationalInputPreflight,
} from '../br-receita-cnpj-attempt2-national-input-preflight';
import {
  buildBrazilReceitaObservedInputInventory,
  type BrazilReceitaObservedInputInventoryFileSystem,
} from '../br-receita-cnpj-attempt2-observed-input-inventory';
import {
  BRAZIL_RECEITA_ATTEMPT_2_FORBIDDEN_GENERIC_FLAGS,
  BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS,
  BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_KEYS,
  BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT,
  BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_PERSISTED,
  brazilReceitaAttempt2OperatorAuthorizationGranted,
  findBrazilReceitaAttempt2MissingOperatorApprovals,
  resolveBrazilReceitaAttempt2OperatorAuthorization,
  summarizeBrazilReceitaAttempt2OperatorAuthorization,
} from '../br-receita-cnpj-attempt2-operator-authorization';
import { BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT } from '../br-receita-cnpj-full-join-no-write-guard';
import { BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT } from '../br-receita-cnpj-full-join-operator-metric-channel';
import { createBrazilReceitaFullJoinWorkspaceFileSystem } from '../br-receita-cnpj-full-join-engine-fs';
import type { BrazilReceitaFullJoinBridgeManifestValidator } from '../br-receita-cnpj-full-join-manifest-source-bridge';
import {
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED,
  createBrazilReceitaFullJoinBenchmarkAttemptLedger,
} from '../br-receita-cnpj-full-join-resource-benchmark';
import { BR_RECEITA_CNPJ_NATIONAL_PART_COUNT } from '../br-receita-cnpj-manifest';
import {
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
  BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
  brazilReceitaNextRealAttemptNumber,
  evaluateBrazilReceitaRealBenchmarkAttemptRequest,
} from '../br-receita-cnpj-real-benchmark-attempt-ledger';
import {
  BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS,
  brazilReceitaProposedFullScanResourceCaps,
  runBrazilReceitaRealFullScanResourceBenchmark,
  summarizeBrazilReceitaRealFullScanReadiness,
  type BrazilReceitaRealFullScanBenchmarkRequest,
  type BrazilReceitaRealFullScanDeclarations,
} from '../br-receita-cnpj-real-full-scan-benchmark';

import {
  buildBrazilReceitaRealFullScanDeclarations,
  parseBrazilReceitaRealFullScanCliArgs,
  BRAZIL_RECEITA_REAL_FULL_SCAN_CLI_REFUSALS,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-real-full-scan-resource-benchmark';

// ─── Locations ────────────────────────────────────────────────────────────────

const CONNECTOR_DIRECTORY = path.resolve(__dirname, '..');
const SCRIPTS_DIRECTORY = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'scripts', 'source-catalog');
const CLI_FILE = 'run-br-receita-cnpj-real-full-scan-resource-benchmark.ts';

const MILESTONE_SOURCE_FILES: readonly string[] = [
  'br-receita-cnpj-attempt2-operator-authorization.ts',
  'br-receita-cnpj-attempt2-observed-input-inventory.ts',
  'br-receita-cnpj-attempt2-national-input-preflight.ts',
];

function readConnectorSource(name: string): string {
  return fs.readFileSync(path.join(CONNECTOR_DIRECTORY, name), 'utf8');
}

/** Removes comments so a scan asserts what a module DOES rather than what its prose says. */
function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ─── Synthetic manifests ──────────────────────────────────────────────────────

const MANIFEST_DIRECTORY = '/synthetic/attempt2/manifest';
const MANIFEST_PATH = `${MANIFEST_DIRECTORY}/synthetic-manifest.json`;

interface ManifestEntrySpec {
  readonly fileType: string;
  readonly partOrdinal?: number;
  readonly path?: string;
  readonly encoding?: string;
  readonly delimiter?: string;
  readonly layoutMode?: string;
}

/** A family's ten national parts, ordinals 0..9, as manifest entries. */
function nationalFamilyEntries(fileType: string): readonly ManifestEntrySpec[] {
  return Array.from({ length: BR_RECEITA_CNPJ_NATIONAL_PART_COUNT }, (_unused, index) => ({
    fileType,
    partOrdinal: index,
    path: `${fileType}-part-${index}.csv`,
  }));
}

/** The 10 + 10 national manifest BR-SOURCE-14B.0M requires. Every entry declares the official shape. */
function nationalManifestEntries(): readonly ManifestEntrySpec[] {
  return [...nationalFamilyEntries('empresas'), ...nationalFamilyEntries('estabelecimentos')];
}

function manifestDocument(
  entries: readonly ManifestEntrySpec[] = nationalManifestEntries(),
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    mode: 'local_manifest_validation',
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    layoutMode: 'official_headerless',
    inputScope: 'full_national',
    files: entries.map((entry) => ({
      encoding: 'latin1',
      delimiter: ';',
      layoutMode: 'official_headerless',
      ...entry,
    })),
    ...overrides,
  });
}

/**
 * A metadata-only filesystem double.
 *
 * It has THREE operations and no fourth, which is the point: there is no `read`, so a test cannot
 * accidentally prove the inventory row-free by forgetting to script one.
 */
function scriptedInventoryFileSystem(
  script: {
    document?: string;
    throwOnRead?: boolean;
    symlinks?: readonly string[];
    nonRegular?: readonly string[];
    absent?: readonly string[];
  } = {},
): { fileSystem: BrazilReceitaObservedInputInventoryFileSystem; touched: string[] } {
  const touched: string[] = [];
  return {
    touched,
    fileSystem: {
      readManifestDocument(manifestPath) {
        touched.push(manifestPath);
        if (script.throwOnRead === true) throw new Error('unreadable');
        return script.document ?? manifestDocument();
      },
      isSymbolicLink(targetPath) {
        touched.push(targetPath);
        if ((script.absent ?? []).some((name) => targetPath.endsWith(name))) {
          throw new Error('ENOENT');
        }
        return (script.symlinks ?? []).some((name) => targetPath.endsWith(name));
      },
      isRegularFile(targetPath) {
        touched.push(targetPath);
        if ((script.absent ?? []).some((name) => targetPath.endsWith(name))) {
          throw new Error('ENOENT');
        }
        return !(script.nonRegular ?? []).some((name) => targetPath.endsWith(name));
      },
    },
  };
}

function inventoryFor(
  script: Parameters<typeof scriptedInventoryFileSystem>[0] = {},
): ReturnType<typeof buildBrazilReceitaObservedInputInventory> {
  return buildBrazilReceitaObservedInputInventory({
    manifestPath: MANIFEST_PATH,
    fileSystem: scriptedInventoryFileSystem(script).fileSystem,
  });
}

function verdictFor(
  script: Parameters<typeof scriptedInventoryFileSystem>[0] = {},
  period = '2026-07',
): ReturnType<typeof evaluateBrazilReceitaAttempt2NationalInputPreflight> {
  return evaluateBrazilReceitaAttempt2NationalInputPreflight({
    period,
    observedInventory: inventoryFor(script),
  });
}

function findingCodes(
  preflight: ReturnType<typeof evaluateBrazilReceitaAttempt2NationalInputPreflight>,
): readonly string[] {
  return preflight.completeness.findings.map((finding) => finding.code);
}

// ─── CLI argument fixtures ────────────────────────────────────────────────────

const BASE_CLI_ARGS: readonly string[] = [
  '--real-full-scan-resource-benchmark',
  '--manifest',
  MANIFEST_PATH,
  '--workspace-parent',
  '/synthetic/scratch',
  '--private-metric-directory',
  '/synthetic/private',
  '--dataset-period',
  '2026-07',
  '--private-metric-acknowledgement',
  BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
  '--real-attempt-number',
  // Pinned to `2` rather than derived from `brazilReceitaNextRealAttemptNumber()`. This milestone is about
  // the invocation an operator would actually retype — the one that ran on 2026-08-12 — and after
  // BR-SOURCE-ATTEMPT2-CLOSURE the derived value is `3`, which exercises the limit refusal instead of the
  // already-consumed refusal. Both are asserted in this file; this constant should carry the case the
  // milestone is named for. `3` and above are covered by the limit tests, `1` by test 7.
  '2',
];

function parseArgs(extra: readonly string[] = []): ReturnType<typeof parseBrazilReceitaRealFullScanCliArgs> {
  return parseBrazilReceitaRealFullScanCliArgs([...BASE_CLI_ARGS, ...extra]);
}

const ALL_THREE_FLAGS: readonly string[] = [
  BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS.ownerAuthorization,
  BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS.temporaryStoragePolicyApproved,
  BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS.capInputPolicyApproved,
];

// ─── § 14 — authorization ─────────────────────────────────────────────────────

describe('BR-SOURCE-ATTEMPT2-OPS § 14 — process-scoped authorization', () => {
  // Test 1.
  it('1 — treats a default invocation as unauthorized', () => {
    const resolved = resolveBrazilReceitaAttempt2OperatorAuthorization([]);
    assert.equal(resolved.ok, true);
    assert.deepEqual(resolved.authorization, BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT);
    assert.equal(brazilReceitaAttempt2OperatorAuthorizationGranted(resolved.authorization), false);
    assert.deepEqual(findBrazilReceitaAttempt2MissingOperatorApprovals(resolved.authorization), [
      ...BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_KEYS,
    ]);

    // And the parsed CLI options agree: no flags, no approvals.
    const parsed = parseArgs();
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(
      parsed.options.operatorAuthorization,
      BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT,
    );
  });

  // Tests 2, 3, 4 — each approval alone is refused.
  it('2, 3, 4 — refuses each single approval on its own', () => {
    for (const key of BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_KEYS) {
      const flag = BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS[key];
      const resolved = resolveBrazilReceitaAttempt2OperatorAuthorization([flag]);
      assert.equal(resolved.ok, true);
      assert.equal(resolved.authorization[key], true, `${flag} must grant ${key}`);
      assert.equal(
        brazilReceitaAttempt2OperatorAuthorizationGranted(resolved.authorization),
        false,
        `${key} alone must not authorize`,
      );
      // The other two are still absent, and NOT inferred from the one that was granted.
      const missing = findBrazilReceitaAttempt2MissingOperatorApprovals(resolved.authorization);
      assert.equal(missing.length, 2);
      assert.ok(!missing.includes(key));
    }
  });

  // Test 5.
  it('5 — refuses owner + temporary storage when the cap-input approval is missing', () => {
    const resolved = resolveBrazilReceitaAttempt2OperatorAuthorization([
      BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS.ownerAuthorization,
      BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS.temporaryStoragePolicyApproved,
    ]);
    assert.equal(resolved.ok, true);
    assert.equal(brazilReceitaAttempt2OperatorAuthorizationGranted(resolved.authorization), false);
    assert.deepEqual(findBrazilReceitaAttempt2MissingOperatorApprovals(resolved.authorization), [
      'capInputPolicyApproved',
    ]);

    // The declarations the CLI builds carry the gap rather than smoothing it over, and the entry point
    // refuses at the DECLARATION stage naming exactly the missing one.
    const parsed = parseArgs([
      BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS.ownerAuthorization,
      BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS.temporaryStoragePolicyApproved,
    ]);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const declarations = buildBrazilReceitaRealFullScanDeclarations(parsed.options);
    assert.equal(declarations.benchmarkAuthorization, true);
    assert.equal(declarations.temporaryStoragePolicyApproved, true);
    assert.equal(declarations.capInputPolicyApproved, false);
  });

  // Test 6.
  it('6 — cannot get past the attempt wall with all three approvals, now that #2 is spent', async () => {
    // BR-SOURCE-ATTEMPT2-CLOSURE § 6, stated as the test it invalidated. This asserted that all three
    // approvals carried a run PAST `authorization` and down to the manifest bridge. They did, once —
    // that run was attempt #2, on 2026-08-12. With the durable count at 2 the same three approvals cannot
    // reach the authorization stage at all, because the attempt wall is stage 3 and authorization is
    // stage 11. Approvals grant permission; they do not restore history.
    const parsed = parseArgs(ALL_THREE_FLAGS);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const declarations = buildBrazilReceitaRealFullScanDeclarations(parsed.options, nationalInventory());
    assert.equal(declarations.temporaryStoragePolicyApproved, true);
    assert.equal(declarations.capInputPolicyApproved, true);
    assert.equal(declarations.benchmarkAuthorization, true);
    // The CLI still builds `2` from the operator's `--real-attempt-number 2`. It is the LEDGER that now
    // refuses it, which is the difference between a flag being unavailable and a fact being recorded.
    assert.equal(declarations.requestedRealAttemptNumber, 2);

    const { outcome, readerCalls } = await runPreboundary({ declarations });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.failedStage, 'real_attempt_eligibility');
    assert.equal(outcome.abortCode, 'real_attempt_number_already_consumed');
    assert.equal(outcome.attemptRejectionCode, 'real_attempt_number_already_consumed');
    // Not an approval problem: nothing was missing. The approvals were complete and irrelevant.
    assert.deepEqual([...outcome.missingOperatorApprovals], []);
    assert.notEqual(outcome.abortCode, 'manifest_resolution_failed');
    assert.equal(outcome.realDataBoundaryCrossed, false);
    assert.equal(outcome.attemptsConsumedAfterRefusal, 2);
    assert.equal(readerCalls.length, 0);
  });

  // Test 7.
  it('7 — cannot reuse attempt #1, whatever the operator approves', async () => {
    // The ledger refuses `1` outright, and the three approvals do not change that: authorization is
    // about permission and the attempt number is about history.
    const eligibility = evaluateBrazilReceitaRealBenchmarkAttemptRequest(1);
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.rejectionCode, 'real_attempt_number_already_consumed');

    const parsed = parseBrazilReceitaRealFullScanCliArgs([
      ...BASE_CLI_ARGS.slice(0, BASE_CLI_ARGS.length - 1),
      '1',
      ...ALL_THREE_FLAGS,
    ]);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const { outcome, readerCalls } = await runPreboundary({
      declarations: buildBrazilReceitaRealFullScanDeclarations(parsed.options, nationalInventory()),
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.failedStage, 'real_attempt_eligibility');
    assert.equal(outcome.abortCode, 'real_attempt_number_already_consumed');
    assert.equal(outcome.attemptsConsumedAfterRefusal, BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED);
    assert.equal(readerCalls.length, 0);
  });

  // Test 8.
  it('8 — rejects attempt #3 always, with or without approvals', async () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED, false);
    for (const requested of [3, 4, 99]) {
      assert.equal(
        evaluateBrazilReceitaRealBenchmarkAttemptRequest(requested).rejectionCode,
        'real_benchmark_attempt_limit_reached',
      );
    }
    const parsed = parseBrazilReceitaRealFullScanCliArgs([
      ...BASE_CLI_ARGS.slice(0, BASE_CLI_ARGS.length - 1),
      '3',
      ...ALL_THREE_FLAGS,
    ]);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const { outcome, readerCalls } = await runPreboundary({
      declarations: buildBrazilReceitaRealFullScanDeclarations(parsed.options, nationalInventory()),
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'real_benchmark_attempt_limit_reached');
    assert.equal(readerCalls.length, 0);
    // Nothing above can raise the structural ceiling either.
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS, 2);
  });

  // Test 9.
  it('9 — loses the authorization when the process ends', () => {
    // There is nowhere for a grant to be written: no filesystem, no env, no module-level mutable state.
    assert.equal(BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_PERSISTED, false);
    const source = codeWithoutComments(
      readConnectorSource('br-receita-cnpj-attempt2-operator-authorization.ts'),
    );
    for (const pattern of [
      /process\.env/,
      /node:fs/,
      /writeFile/,
      /localStorage/,
      /globalThis\s*\./,
      /\blet\b/,
    ]) {
      assert.ok(!pattern.test(source), `the grant must not be able to persist via ${String(pattern)}`);
    }

    // A "restarted process" is a fresh resolution over a fresh argv, and it starts from the default.
    const granted = resolveBrazilReceitaAttempt2OperatorAuthorization(ALL_THREE_FLAGS);
    assert.equal(brazilReceitaAttempt2OperatorAuthorizationGranted(granted.authorization), true);
    const restarted = resolveBrazilReceitaAttempt2OperatorAuthorization([]);
    assert.equal(brazilReceitaAttempt2OperatorAuthorizationGranted(restarted.authorization), false);
  });

  // Test 10.
  it('10 — needs no tracked source edit, and does not make one', () => {
    const standing = summarizeBrazilReceitaAttempt2OperatorAuthorization();
    assert.equal(standing.processScopedAuthorizationReady, true);
    assert.equal(standing.trackedSourceAuthorizationFlipRequired, false);
    assert.equal(standing.allThreeRequired, true);

    // The tracked constant did NOT move, and its source still declares `false` verbatim.
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED, false);
    const constantSource = readConnectorSource('br-receita-cnpj-full-join-resource-benchmark.ts');
    assert.ok(constantSource.includes('BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED = false'));

    // And no module in this milestone assigns it, anywhere.
    for (const name of MILESTONE_SOURCE_FILES) {
      const source = codeWithoutComments(readConnectorSource(name));
      assert.ok(!/BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED\s*=/.test(source));
    }
  });

  it('names its flags specifically, and refuses generic overrides', () => {
    // § 3: every flag maps to exactly one policy declaration, and none of them is a blanket override.
    for (const flag of Object.values(BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS)) {
      assert.ok(!BRAZIL_RECEITA_ATTEMPT_2_FORBIDDEN_GENERIC_FLAGS.includes(flag));
      assert.ok(flag.startsWith('--') && flag.length > 10);
    }
    for (const generic of BRAZIL_RECEITA_ATTEMPT_2_FORBIDDEN_GENERIC_FLAGS) {
      const resolved = resolveBrazilReceitaAttempt2OperatorAuthorization([...ALL_THREE_FLAGS, generic]);
      assert.equal(resolved.ok, false);
      if (resolved.ok) return;
      assert.equal(resolved.refusal, 'generic_override_flag_not_supported');
      // A refusal never yields a partial grant, even when the three real flags were also present.
      assert.deepEqual(resolved.authorization, BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT);

      const parsed = parseArgs([generic]);
      assert.equal(parsed.ok, false);
      if (!parsed.ok) assert.equal(parsed.refusal, 'generic_override_flag_not_supported');
    }
    const cliRefusals = BRAZIL_RECEITA_REAL_FULL_SCAN_CLI_REFUSALS as readonly string[];
    assert.ok(cliRefusals.includes('generic_override_flag_not_supported'));
    assert.ok(cliRefusals.includes('operator_approval_declarations_missing'));
  });

  it('reports the mechanism in --readiness without claiming an authorization', () => {
    const readiness = summarizeBrazilReceitaRealFullScanReadiness();
    assert.equal(readiness.operatorAuthorization.processScopedAuthorizationReady, true);
    assert.deepEqual(
      readiness.operatorAuthorization.defaults,
      BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT,
    );
    // Ready, and not authorized. Both, in the same report.
    assert.equal(readiness.secondRealBenchmarkAuthorized, false);
    assert.equal(readiness.realFullScanBenchmarkAuthorized, false);
    assert.equal(readiness.gate2ReadyForOwnerReview, false);
  });
});

// ─── § 15 — inventory wiring ──────────────────────────────────────────────────

/** The observed scan for a complete 10 + 10 national manifest, every part present and regular. */
function nationalInventory(
  script: Parameters<typeof scriptedInventoryFileSystem>[0] = {},
): ReturnType<typeof buildBrazilReceitaObservedInputInventory> {
  return inventoryFor(script);
}

describe('BR-SOURCE-ATTEMPT2-OPS § 15 — the national-input gate is wired', () => {
  // Test 11.
  it('11 — no longer passes observed = null on the benchmark path', () => {
    const scan = nationalInventory();
    assert.equal(scan.ok, true);
    assert.notEqual(scan.observed, null);

    const preflight = evaluateBrazilReceitaAttempt2NationalInputPreflight({
      period: '2026-07',
      observedInventory: scan,
    });
    assert.equal(preflight.observedInventoryDeclared, true);
    assert.ok(!findingCodes(preflight).includes('observed_inventory_absent'));

    // And the CLI's declaration builder carries that result rather than an uninspected one.
    const parsed = parseArgs(ALL_THREE_FLAGS);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const declarations = buildBrazilReceitaRealFullScanDeclarations(parsed.options, scan);
    const carried = declarations.nationalInputCompleteness as { verdict: string; inputScope: string };
    assert.equal(carried.verdict, 'complete');
    assert.equal(carried.inputScope, 'full_national');
  });

  // Test 12.
  it('12 — no longer passes expected = null, and takes it from the publisher artifact', () => {
    const preflight = verdictFor();
    assert.equal(preflight.expectedInventoryDeclared, true);
    assert.equal(preflight.expectedInventoryStatus, 'verified');
    assert.equal(preflight.expectedInventorySource, 'publisher_derived_part_identity_inventory_2026_07');
    assert.ok(!findingCodes(preflight).includes('expected_inventory_absent'));

    // The expectation keeps exact part IDENTITIES, not a count (§ 6).
    for (const family of ['empresas', 'estabelecimentos']) {
      assert.deepEqual(
        [...preflight.expectedPartKeysByFamily[family]],
        ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
      );
    }

    // And it is derived from 14B.0K's canonical artifact rather than re-transcribed here.
    const parsedPublisher = parseBrazilReceitaPublisherInventory2026_07();
    assert.equal(parsedPublisher.status, 'verified');
    assert.deepEqual(
      brazilReceitaAttempt2PublisherInventoryForPeriod('2026-07'),
      brazilReceitaAttempt2PublisherInventoryForPeriod(BRAZIL_RECEITA_PUBLISHER_RESOLVED_PERIODS[0]),
    );
    const source = codeWithoutComments(
      readConnectorSource('br-receita-cnpj-attempt2-national-input-preflight.ts'),
    );
    assert.ok(!/expectedPartCount\s*:/.test(source), 'the expectation must not be re-declared here');
  });

  // Test 13.
  it('13 — reports complete for a 10 + 10 metadata fixture', () => {
    const scan = nationalInventory();
    assert.deepEqual(
      { ...scan.requiredFamilyDescriptorCounts },
      { empresas: BR_RECEITA_CNPJ_NATIONAL_PART_COUNT, estabelecimentos: BR_RECEITA_CNPJ_NATIONAL_PART_COUNT },
    );
    assert.deepEqual([...scan.partFindings], []);
    assert.equal(scan.declaredInputScope, 'full_national');

    const preflight = verdictFor();
    assert.deepEqual([...findingCodes(preflight)], []);
    assert.equal(preflight.completeness.verdict, 'complete');
    assert.equal(preflight.completeness.inputScope, 'full_national');
    assert.equal(preflight.satisfiesAttempt2, true);
  });

  // Tests 14, 15.
  it('14, 15 — reports incomplete when a required family is short a part', () => {
    for (const family of ['empresas', 'estabelecimentos']) {
      const entries = nationalManifestEntries().filter(
        (entry) => !(entry.fileType === family && entry.partOrdinal === 7),
      );
      const preflight = verdictFor({ document: manifestDocument(entries) });
      assert.equal(preflight.completeness.verdict, 'incomplete');
      assert.equal(preflight.satisfiesAttempt2, false);
      assert.ok(
        preflight.completeness.findings.some(
          (finding) => finding.code === 'family_part_count_short' && finding.family === family,
        ),
        `${family} must report a shortfall`,
      );
      assert.equal(preflight.observedDescriptorCountsByFamily[family], 9);
    }

    // A part that is PRESENT in the manifest but absent, symlinked or not a regular file on disk is
    // not an observed part either — the same shortfall, reached through metadata rather than omission.
    for (const [script, code] of [
      [{ absent: ['empresas-part-3.csv'] }, 'declared_part_absent'],
      [{ symlinks: ['empresas-part-3.csv'] }, 'declared_part_symlink'],
      [{ nonRegular: ['empresas-part-3.csv'] }, 'declared_part_not_regular_file'],
    ] as const) {
      const scan = nationalInventory(script);
      assert.equal(scan.requiredFamilyDescriptorCounts.empresas, 9);
      assert.ok(scan.partFindings.some((finding) => finding.code === code));
      const preflight = verdictFor(script);
      assert.equal(preflight.completeness.verdict, 'incomplete');
      assert.equal(preflight.satisfiesAttempt2, false);
    }
  });

  // Test 16.
  it('16 — reports incomplete for a duplicated ordinal, even at the right total count', () => {
    // Ten Empresas entries, but part 0 twice and part 9 never. A count-only gate would call this
    // complete; identity keeps it honest.
    const entries = nationalManifestEntries().map((entry) =>
      entry.fileType === 'empresas' && entry.partOrdinal === 9
        ? { ...entry, partOrdinal: 0, path: 'empresas-part-0-again.csv' }
        : entry,
    );
    const scan = nationalInventory({ document: manifestDocument(entries) });
    assert.equal(scan.requiredFamilyDescriptorCounts.empresas, BR_RECEITA_CNPJ_NATIONAL_PART_COUNT);

    const preflight = verdictFor({ document: manifestDocument(entries) });
    assert.ok(findingCodes(preflight).includes('duplicate_part_declared'));
    assert.equal(preflight.completeness.verdict, 'incomplete');
    assert.equal(preflight.satisfiesAttempt2, false);
  });

  // Test 17.
  it('17 — rejects a manifest for the wrong period, and a period with no publisher listing', () => {
    // The manifest declares 2026-06 while the run declares 2026-07: a definite mismatch.
    const mismatch = verdictFor({
      document: manifestDocument(nationalManifestEntries(), { sourcePeriod: '2026-06' }),
    });
    assert.ok(findingCodes(mismatch).includes('period_mismatch'));
    assert.equal(mismatch.completeness.verdict, 'incomplete');
    assert.equal(mismatch.satisfiesAttempt2, false);

    // And a run declaring a period the publisher listing does not cover has NO expectation — never one
    // borrowed from July.
    assert.equal(brazilReceitaAttempt2PublisherInventoryForPeriod('2026-08'), null);
    const unlisted = verdictFor({}, '2026-08');
    assert.equal(unlisted.expectedInventoryDeclared, false);
    assert.equal(unlisted.expectedInventoryStatus, 'unavailable');
    assert.ok(findingCodes(unlisted).includes('expected_inventory_absent'));
    assert.equal(unlisted.satisfiesAttempt2, false);
  });

  // Test 18.
  it('18 — rejects a person-linked family reaching the input, and an unexpected family', () => {
    const withSocios = verdictFor({
      document: manifestDocument([
        ...nationalManifestEntries(),
        { fileType: 'socios', partOrdinal: 0, path: 'socios-part-0.csv' },
      ]),
    });
    assert.ok(findingCodes(withSocios).includes('forbidden_person_linked_family'));
    assert.equal(withSocios.completeness.verdict, 'incomplete');
    assert.equal(withSocios.satisfiesAttempt2, false);

    // A family outside the contract is a substitution, not a bonus.
    const substituted = verdictFor({
      document: manifestDocument([
        ...nationalManifestEntries(),
        { fileType: 'unexpected_family', partOrdinal: 0, path: 'unexpected.csv' },
      ]),
    });
    assert.ok(findingCodes(substituted).includes('unexpected_family_substitution'));
    assert.equal(substituted.satisfiesAttempt2, false);
  });

  // Test 19.
  it('19 — invokes no row reader while building the inventory', () => {
    const scan = nationalInventory();
    assert.equal(scan.rowsRead, 0);
    assert.equal(scan.sourceReaderCalls, 0);
    assert.equal(scan.dataFilesOpened, 0);

    // Structural, not observational: the module has no I/O import and the port has no read operation.
    const source = codeWithoutComments(
      readConnectorSource('br-receita-cnpj-attempt2-observed-input-inventory.ts'),
    );
    for (const pattern of [
      /node:fs/,
      /readFileSync/,
      /createReadStream/,
      /child_process/,
      /openSync/,
      /process\.env/,
    ]) {
      assert.ok(!pattern.test(source), `the inventory must not reference ${String(pattern)}`);
    }
    // The port's whole vocabulary, and there is no fourth operation to add a read to.
    const { fileSystem } = scriptedInventoryFileSystem();
    assert.deepEqual(Object.keys(fileSystem).sort(), [
      'isRegularFile',
      'isSymbolicLink',
      'readManifestDocument',
    ]);
  });

  // Test 20.
  it('20 — aborts an incomplete input before the boundary, without spending the attempt', async () => {
    const entries = nationalManifestEntries().filter(
      (entry) => !(entry.fileType === 'estabelecimentos' && entry.partOrdinal === 4),
    );
    const parsed = parseArgs(ALL_THREE_FLAGS);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const declarations = buildBrazilReceitaRealFullScanDeclarations(
      parsed.options,
      nationalInventory({ document: manifestDocument(entries) }),
    );
    const { outcome, readerCalls, bridgeTouched } = await runPreboundary({ declarations });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    // The input gate is stage 4, behind the attempt wall, so a short manifest is now refused one stage
    // earlier. The invariant this test exists for is unchanged and is asserted below: a refusal before the
    // boundary spends nothing, whichever stage raised it. The gate's own verdict logic is a pure function
    // and is covered directly in `br-receita-cnpj-14b0j-second-benchmark-control.test.ts`.
    assert.equal(outcome.failedStage, 'real_attempt_eligibility');
    assert.equal(outcome.abortCode, 'real_attempt_number_already_consumed');
    assert.equal(outcome.realDataBoundaryCrossed, false);
    assert.equal(outcome.attemptsConsumedAfterRefusal, BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED);
    assert.equal(outcome.attemptsConsumedAfterRefusal, 2);
    assert.equal(readerCalls.length, 0);
    assert.deepEqual(bridgeTouched, []);
    // And the short manifest really is short — the declaration the CLI built still reports it as
    // incomplete, so the refusal above is not masking a gate that stopped noticing.
    assert.notEqual(
      (declarations.nationalInputCompleteness as { verdict: string }).verdict,
      'complete',
    );
  });

  it('reports the manifest as unreadable rather than as an empty inventory', () => {
    // "Nothing was inspected" and "the inventory is short" are different facts. A refused scan yields
    // `observed: null`, which the gate answers with `indeterminate` — never `incomplete`.
    for (const [script, refusal] of [
      [{ throwOnRead: true }, 'manifest_unreadable'],
      [{ document: 'not json at all' }, 'manifest_not_json'],
      [{ document: JSON.stringify({ sourceKey: 'x' }) }, 'manifest_files_unusable'],
    ] as const) {
      const scan = inventoryFor(script);
      assert.equal(scan.ok, false);
      assert.equal(scan.observed, null);
      assert.deepEqual([...scan.refusals], [refusal]);
      const preflight = evaluateBrazilReceitaAttempt2NationalInputPreflight({
        period: '2026-07',
        observedInventory: scan,
      });
      assert.equal(preflight.completeness.verdict, 'indeterminate');
      assert.equal(preflight.satisfiesAttempt2, false);
    }

    // A relative manifest path never reaches the filesystem at all.
    const relative = buildBrazilReceitaObservedInputInventory({
      manifestPath: 'relative/manifest.json',
      fileSystem: scriptedInventoryFileSystem().fileSystem,
    });
    assert.deepEqual([...relative.refusals], ['manifest_path_not_absolute']);
  });
});

// ─── § 16 — the full preboundary path ─────────────────────────────────────────

/** A manifest validator double that refuses. Never the official one, and it touches no disk. */
function refusingValidator(): BrazilReceitaFullJoinBridgeManifestValidator {
  return async () =>
    ({
      ok: false,
      sourceKey: 'br_receita_cnpj_dados_abertos',
      countryCode: 'BR',
      sourceYear: 2026,
      sourcePeriod: '2026-07',
      inputScope: 'full_national',
      filesSeen: 20,
      filesAccepted: 0,
      filesRejected: 20,
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

function completeCliDeclarations(
  overrides: Partial<BrazilReceitaRealFullScanDeclarations> = {},
): BrazilReceitaRealFullScanDeclarations {
  const parsed = parseArgs(ALL_THREE_FLAGS);
  if (!parsed.ok) throw new Error('fixture args must parse');
  return { ...buildBrazilReceitaRealFullScanDeclarations(parsed.options, nationalInventory()), ...overrides };
}

/**
 * Drives the entry point through the whole preflight with a SENTINEL reader.
 *
 * Every reader operation throws, so a run that reached a source row would surface as that throw rather
 * than as a clean refusal. `readerCalls` records the attempts, and every test asserts it is empty — the
 * § 16 requirement that a reader invocation fails the test.
 */
async function runPreboundary(
  overrides: Partial<BrazilReceitaRealFullScanBenchmarkRequest> = {},
): Promise<{
  outcome: Awaited<ReturnType<typeof runBrazilReceitaRealFullScanResourceBenchmark>>;
  readerCalls: string[];
  bridgeTouched: string[];
}> {
  const readerCalls: string[] = [];
  const bridgeTouched: string[] = [];
  const sentinel = (operation: string) => (): never => {
    readerCalls.push(operation);
    throw new Error(`SENTINEL: no test may ${operation} a source file`);
  };

  const proposal = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS;
  const outcome = await runBrazilReceitaRealFullScanResourceBenchmark({
    declarations: completeCliDeclarations(),
    operatorAuthorization: resolveBrazilReceitaAttempt2OperatorAuthorization(ALL_THREE_FLAGS)
      .authorization,
    workingDirectory: {
      currentWorkingDirectory: '/workspaces/sellup-worktrees/attempt2/scripts',
      homeDirectory: '/home/operator',
      repositoryRoot: '/workspaces/sellup-worktrees/attempt2',
      datasetRoot: '/srv/receita',
      repositoryPackageName: 'sellup',
    },
    attemptLedger: createBrazilReceitaFullJoinBenchmarkAttemptLedger(),
    bridgeFileSystem: {
      readManifestDocument(manifestPath) {
        bridgeTouched.push(manifestPath);
        return manifestDocument();
      },
      isSymbolicLink(targetPath) {
        bridgeTouched.push(targetPath);
        return false;
      },
      realPath(targetPath) {
        bridgeTouched.push(targetPath);
        return targetPath;
      },
      isRegularFile(targetPath) {
        bridgeTouched.push(targetPath);
        return true;
      },
    },
    validateManifest: refusingValidator(),
    readerFileSystem: {
      size: sentinel('size'),
      open: sentinel('open'),
      read: sentinel('read'),
      close() {},
    },
    workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
    privateChannelFileSystem: {
      writeFileExclusive() {},
      chmod() {},
      statMode() {
        return 0o600;
      },
      rename() {},
      exists() {
        return false;
      },
      unlink() {},
    },
    privateChannelBoundaries: {
      repositoryRoot: '/workspaces/sellup-worktrees/attempt2',
      homeDirectory: '/home/operator',
      datasetRoot: '/srv/receita',
    },
    freeDiskProbe: () => 64 * 1024 * 1024 * 1024,
    nowMs: 1_700_000_000_000,
    ...overrides,
  });

  // Sanity: the fixture caps are the proposed profile, unmodified.
  assert.equal(proposal.maxOutputRows, 0);
  return { outcome, readerCalls, bridgeTouched };
}

describe('BR-SOURCE-ATTEMPT2-OPS § 16 — the whole preboundary path', () => {
  // Test 21.
  it('21 — walks args → ledger, and stops there, because the ledger is now the terminal stage', async () => {
    // The original walk reached the manifest bridge with every stage passed. That walk was attempt #2's
    // walk and it happened. What remains provable through the entry point is the first leg — args parse,
    // declarations complete, then the ledger refuses — and that is what a durable closure should look
    // like: the path ends at the record, not at a decision anyone can still make.
    const { outcome, readerCalls } = await runPreboundary();

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.failedStage, 'real_attempt_eligibility');
    assert.equal(outcome.abortCode, 'real_attempt_number_already_consumed');
    assert.equal(outcome.abortStage, 'ABORT_BEFORE_REAL_FILE_OPEN');
    assert.equal(outcome.attemptRejectionCode, 'real_attempt_number_already_consumed');
    // The two stages BEFORE the wall still passed, which is what makes this a refusal by the ledger and
    // not paperwork: no missing declaration and no unsafe working directory.
    assert.deepEqual([...outcome.missingDeclarations], []);
    assert.deepEqual([...outcome.cwdViolations], []);
    // Stages after the wall never ran, so they report nothing.
    assert.deepEqual([...outcome.capRejections], []);
    assert.deepEqual([...outcome.privateChannelRejections], []);
    assert.deepEqual([...outcome.missingOperatorApprovals], []);

    // Nothing crossed the boundary, and nothing was spent.
    assert.equal(outcome.realDataBoundaryCrossed, false);
    assert.equal(outcome.realManifestOpened, false);
    assert.equal(outcome.realDataAccessed, false);
    assert.equal(outcome.rowsEmitted, 0);
    assert.equal(outcome.attemptsConsumedAfterRefusal, BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED);
    // The sentinel is the load-bearing assertion: a run that reached a row would have recorded it.
    assert.deepEqual(readerCalls, []);
  });

  it('refuses identically with the grant and without it — the wall is upstream of both', async () => {
    // Previously these two cases diverged: with the grant the run passed `authorization`, without it the
    // stage refused, and the difference was the proof that the grant did the opening. With the attempt
    // budget spent they CONVERGE, and the convergence is the § 6 claim — "authorization flags cannot
    // resurrect attempt #2" is exactly the statement that granting and withdrawing produce the same answer.
    const granted = await runPreboundary();
    const withdrawn = await runPreboundary({ operatorAuthorization: undefined });
    for (const { outcome, readerCalls } of [granted, withdrawn]) {
      assert.equal(outcome.ok, false);
      if (outcome.ok) continue;
      // The DECISION is identical, and identically upstream of anything a grant affects.
      assert.equal(outcome.failedStage, 'real_attempt_eligibility');
      assert.equal(outcome.abortCode, 'real_attempt_number_already_consumed');
      assert.equal(outcome.realDataBoundaryCrossed, false);
      assert.deepEqual(readerCalls, []);
    }

    // What still differs is DIAGNOSTIC context, not the outcome: every refusal carries the approval
    // shortfall it was constructed with, so a withdrawn grant is still reported as missing even though the
    // run never reached the stage that would have checked it. That is worth pinning rather than smoothing
    // over — an operator reading this refusal should not conclude their approvals were the problem.
    assert.equal(granted.outcome.ok, false);
    assert.equal(withdrawn.outcome.ok, false);
    if (!granted.outcome.ok) assert.deepEqual([...granted.outcome.missingOperatorApprovals], []);
    if (!withdrawn.outcome.ok) {
      assert.deepEqual(
        [...withdrawn.outcome.missingOperatorApprovals],
        [...BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_KEYS],
      );
      // And it is context only — the abort code is still the ledger's, never the authorization stage's.
      assert.notEqual(withdrawn.outcome.abortCode, 'benchmark_not_authorized');
      assert.notEqual(withdrawn.outcome.failedStage, 'authorization');
    }
    // The grant mechanism itself is untouched — still the three keys the milestone defined.
    assert.equal(BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_KEYS.length, 3);
  });
});

// ─── § 17, § 18, § 19 — engine, caps and safety freeze ────────────────────────

describe('BR-SOURCE-ATTEMPT2-OPS § 17–§ 19 — nothing else moved', () => {
  it('22 — changes no cap figure', () => {
    // Every § 18 figure, restated. A silent widening would show up here rather than in a six-hour run.
    assert.deepEqual(
      { ...BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS },
      {
        maxRssBytes: 536_870_912,
        maxHeapUsedBytes: 134_217_728,
        maxExternalMemoryBytes: 67_108_864,
        maxRuntimeMs: 21_600_000,
        maxPhaseRuntimeMs: 21_600_000,
        maxTemporaryStorageBytes: 4_294_967_296,
        minimumFreeDiskBeforeStart: 12_884_901_888,
        minimumFreeDiskReserve: 8_589_934_592,
        maxFilesOpened: 64,
        maxOpenPartitionFiles: 32,
        maxBytesRead: 73_014_444_032,
        maxRowsRead: 360_000_000,
        maxJoinKeysInMemory: 131_072,
        maxOutputRows: 0,
        partitionCount: 1_024,
        maxPartitionCount: 2_048,
        maxPartitionDepth: 1,
        maxReferencesPerPartition: 131_072,
        maxReferenceBytesPerPartition: 2_097_152,
        maxChunkBytes: 4_194_304,
        maxCarryBytes: 65_536,
        maxRowBytes: 65_536,
        maxColumnsPerRow: 64,
        privateMetricArtifactTtlMs: 3_600_000,
        attemptCount: 1,
        automaticRetryCount: 0,
      },
    );
    assert.equal(brazilReceitaProposedFullScanResourceCaps().maxOutputRows, 0);
  });

  it('23 — leaves the engine, reader, partitioner and sanitizer untouched by this milestone', () => {
    // The milestone's own modules import none of them. Plumbing only (§ 17).
    for (const name of MILESTONE_SOURCE_FILES) {
      const source = codeWithoutComments(readConnectorSource(name));
      for (const pattern of [
        /full-join-engine/,
        /streaming-reader/,
        /partition-workspace/,
        /partition-handle-pool/,
        /output-sanitizer/,
        /privacy-safe-classifier/,
      ]) {
        assert.ok(!pattern.test(source), `${name} must not reach into ${String(pattern)}`);
      }
    }
  });

  it('24 — keeps the safety freeze: no execution here, both attempts consumed, gates unapproved', () => {
    // "One attempt consumed" was the freeze this milestone shipped under. Attempt #2 has since run, so the
    // freeze is now tighter, not looser: two consumed, none available, and the same gates unapproved.
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED, 2);
    assert.equal(brazilReceitaNextRealAttemptNumber(), 3);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED, false);
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED, false);
    assert.equal(summarizeBrazilReceitaRealFullScanReadiness().gate2ReadyForOwnerReview, false);
    // The no-write contract is carried through unmodified.
    assert.equal(typeof BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT, 'object');
  });

  it('25 — stays inside the directories the milestone permits', () => {
    for (const name of MILESTONE_SOURCE_FILES) {
      assert.ok(fs.existsSync(path.join(CONNECTOR_DIRECTORY, name)), `${name} must exist`);
    }
    assert.ok(fs.existsSync(path.join(SCRIPTS_DIRECTORY, CLI_FILE)));

    // No Supabase, no runtime, no Agent 1, no provider, no network, no process spawn — in the new
    // modules or in the CLI.
    const forbidden: readonly [RegExp, string][] = [
      [/@supabase\//, 'Supabase'],
      [/prospect_candidates|source_company_snapshots/, 'a database table'],
      [/apollo|lusha|tavily|hubspot|slack/i, 'a provider'],
      [/child_process/, 'a process spawn'],
      [/node:https?|fetch\(|axios/, 'the network'],
    ];
    const sources = [
      ...MILESTONE_SOURCE_FILES.map((name) => [name, readConnectorSource(name)] as const),
      [CLI_FILE, fs.readFileSync(path.join(SCRIPTS_DIRECTORY, CLI_FILE), 'utf8')] as const,
    ];
    for (const [name, raw] of sources) {
      const source = codeWithoutComments(raw);
      for (const [pattern, label] of forbidden) {
        assert.ok(!pattern.test(source), `${name} must not reference ${label}`);
      }
    }
  });

  it('26 — names no real dataset, manifest or operator path', () => {
    for (const fragment of ['K3241.K03200', 'DADOS_ABERTOS_CNPJ', '/Users/', 'Downloads']) {
      for (const name of MILESTONE_SOURCE_FILES) {
        const source = codeWithoutComments(readConnectorSource(name));
        assert.ok(!source.includes(fragment), `${name} must not contain "${fragment}"`);
      }
    }
  });
});
