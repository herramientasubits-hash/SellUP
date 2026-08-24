/**
 * BR-SOURCE-FAST-TRACK-6 FINAL BOUNDARY CORRECTION — the GATE-5 / legacy engine-report boundary.
 *
 * The legacy `BrazilReceitaFullJoinEnginePublicReport` predates GATE-5 and carries three keys GATE-5
 * refuses. This suite pins the boundary — and after the FINAL FAIL-CLOSED EMITTER REMOVAL it also
 * proves the bypass that existed is **gone**, by scanning the source rather than by reading a flag.
 *
 * That shapes every assertion here:
 *
 *   · the emitter sweep asserts the discovered set EQUALS the LIVE recorded set, which is now empty.
 *     It does not exclude the previously-offending file — it proves the expression is absent from it.
 *     The historical finding is kept separately, with its resolution, so the audit trail survives the
 *     fix. A new emitter fails this suite; so does silently deleting the historical record.
 *   · the ratchet is proved to WORK, not just to pass: the suite re-inserts the exact removed
 *     expression into a scratch copy of the CLI and asserts the detector fires on it. A guard nobody
 *     has seen fail is a guard nobody knows works.
 *   · the ASYMMETRY is proved by execution, not asserted in prose: 11A returns `ok` on the three
 *     legacy keys and the GATE-5 guard returns six findings on the same three. That is the entire
 *     reason the emitter was able to survive BEFORE its removal, and it is the thing most likely to
 *     be misremembered.
 *   · the historical shape is asserted UNCHANGED — by reading the owning module and finding all three
 *     key declarations still there. "We preserved the legacy contract" should not need a diff.
 *   · `rows_emitted -> records_persisted` is asserted REFUSED, so a future author meets the refusal
 *     before re-deriving the temptation.
 *   · no gate status moves, and the packet is asserted to DISCLOSE the blocker rather than to imply
 *     the architecture is complete.
 *
 * Pure and synthetic: no network, no Supabase, no provider, no real Receita data, no benchmark, no
 * filesystem write. The only files read are repository sources and two documents, for static guards.
 * 0 credits, 0 writes, 0 migrations.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';

import {
  BRAZIL_RECEITA_GATE5_EMITTER_REMOVAL_CHARACTER,
  BRAZIL_RECEITA_GATE5_ENGINEERING_BLOCKER_HISTORY,
  BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_CONTRACT_RECORDED,
  BRAZIL_RECEITA_GATE5_ENGINE_REPORT_PROJECTION_REQUIRED,
  BRAZIL_RECEITA_GATE5_FORBIDDEN_PROJECTION_SHORTCUT,
  BRAZIL_RECEITA_GATE5_HISTORICAL_BYPASS_RECORDED,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CURRENT_DIRECT_EMITTERS,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_HISTORICAL_DIRECT_EMITTERS,
  BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKERS,
  BRAZIL_RECEITA_GATE5_WITHHELD_OUTPUT_BEHAVIOUR,
  brazilReceitaGate5DirectEngineReportExternalEmitterExists,
  brazilReceitaGate5EngineReportCurrentBypassAbsent,
  brazilReceitaGate5FiveGatesWaitOnlyOnHumans,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_KEY_RECORDS,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CLASSIFICATION,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CONSUMERS,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_FORBIDDEN_DIRECT_SURFACES,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_IS_AN_APPROVED_EMISSION,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_PERMITTED_USE,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_SHAPE_CHANGED,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_SUBJECT,
  BRAZIL_RECEITA_GATE5_LEGACY_RENAME_PROVEN_CONTRACT_SAFE,
  BRAZIL_RECEITA_GATE5_LEGACY_REPORT_NAME_IMPLIES_APPROVAL,
  BRAZIL_RECEITA_GATE5_NEW_KEY_INVENTED_FOR_A_LEGACY_NAME,
  BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTATION_AUTHORIZED_NOW,
  BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTED,
  BRAZIL_RECEITA_GATE5_REFUSED_LEGACY_KEY_MAPPINGS,
  BRAZIL_RECEITA_GATE5_REQUIRED_PROJECTION_PIPELINE,
  brazilReceitaGate5EngineReportBoundaryResolved,
} from '../br-receita-cnpj-gate5-engine-report-boundary';
import {
  BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS,
  BRAZIL_RECEITA_GATE5_OUTPUT_SURFACES,
} from '../br-receita-cnpj-gate5-output-contract';
import {
  guardBrazilReceitaGate5Report,
  isBrazilReceitaGate5AllowedKey,
  matchBrazilReceitaGate5ForbiddenKeyGroup,
} from '../br-receita-cnpj-gate5-output-guard';
import { sanitizeBrazilReceitaFullJoinReport } from '../br-receita-cnpj-full-join-output-sanitizer';
import {
  BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS,
  BRAZIL_RECEITA_SIGNOFF_GATE5_SUBJECT_TERMS,
} from '../br-receita-cnpj-final-owner-signoff-packet';
import { BRAZIL_RECEITA_GATE5_STATUS } from '../br-receita-cnpj-gate5-recorded-output-sanitization';
import { BRAZIL_RECEITA_GATE7_STATUS } from '../br-receita-cnpj-gate7-recorded-operator-runbook';
import {
  BRAZIL_RECEITA_GATE_APPROVED_STATUSES,
  BRAZIL_RECEITA_GATE_CURRENT_STATE,
  brazilReceitaGateGlobalVerdict,
} from '../br-receita-cnpj-gate-status-current-state';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
/**
 * Comments AND quoted string literals removed, so a module that DESCRIBES an emission site in prose
 * data is not mistaken for one.
 *
 * 🔴 Template literals are deliberately KEPT. That is where real interpolation lives — the actual
 * emitter is `process.stdout.write(\`\${JSON.stringify(...)}\`)` — so stripping backticks too would
 * hide the very defect this suite exists to find. Only `'...'` and `"..."` go, which is exactly where
 * the boundary record's `mechanism` string sits.
 */
function executableCodeOnly(source: string): string {
  return codeWithoutComments(source)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}
/** Markdown prose, normalized: blockquote markers dropped, then whitespace collapsed. */
function markdownProse(source: string): string {
  return source
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s+/g, ' ');
}
function repoFile(relativePath: string): string {
  return fs.readFileSync(new URL(`../../../../../../${relativePath}`, import.meta.url), 'utf8');
}
function connectorDir(): URL {
  return new URL('../', import.meta.url);
}
function scriptsDir(): URL {
  return new URL('../../../../../../scripts/source-catalog/', import.meta.url);
}

/** The three legacy keys, as a report-shaped fixture. Booleans and a zero — no identifier anywhere. */
const LEGACY_KEYS_FIXTURE = {
  rows_emitted: 0,
  raw_rows_printed: false,
  zero_output_rows_enforced: true,
} as const;

const LEGACY_KEY_NAMES = ['rows_emitted', 'raw_rows_printed', 'zero_output_rows_enforced'] as const;

// ─── 1 · The classification ───────────────────────────────────────────────────

describe('BOUNDARY · the legacy engine report is a SHAPE, not an approved GATE-5 emission', () => {
  it('carries the explicit classification', () => {
    assert.equal(
      BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CLASSIFICATION,
      'LEGACY_ENGINE_SANITIZED_REPORT_SHAPE',
    );
    assert.equal(BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_IS_AN_APPROVED_EMISSION, false);
  });

  it('does NOT treat the historical name `PublicReport` as proof of GATE-5 approval', () => {
    // 🔴 The misreading this constant exists to block: `Public` is the counterpart to the PRIVATE
    // operator artifact, and it predates GATE-5 entirely.
    assert.equal(BRAZIL_RECEITA_GATE5_LEGACY_REPORT_NAME_IMPLIES_APPROVAL, false);
    assert.match(BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_SUBJECT.type, /PublicReport$/);
    assert.equal(BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_SUBJECT.predatesGate5, true);
  });

  it('permits it as internal / pre-projection input, and names that positively', () => {
    assert.equal(
      BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_PERMITTED_USE,
      'internal_or_pre_projection_input_only',
    );
  });

  it('forbids direct serialization onto ALL TWELVE GATE-5 surfaces, with no exception', () => {
    // Derived against the contract's own surface list, so a thirteenth surface cannot be forgotten
    // here and a shorter list here cannot silently invent an exemption.
    assert.deepEqual(
      [...BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_FORBIDDEN_DIRECT_SURFACES].sort(),
      [...BRAZIL_RECEITA_GATE5_OUTPUT_SURFACES].sort(),
    );
    assert.equal(BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_FORBIDDEN_DIRECT_SURFACES.length, 12);
  });
});

// ─── 2 · Why nothing was renamed ──────────────────────────────────────────────

describe('BOUNDARY · the historical shape is preserved, and the evidence says why', () => {
  it('enumerates real consumers, every one of which a rename would break', () => {
    assert.ok(BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CONSUMERS.length >= 4);
    for (const consumer of BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CONSUMERS) {
      assert.equal(consumer.renameWouldBreak, true, `${consumer.consumer}`);
      assert.ok(consumer.kind.length > 0);
    }
  });

  it('every recorded consumer REALLY references the legacy type or builder', () => {
    // 🔴 A record claiming a consumer exists is not evidence. Each one is looked up on disk.
    const connector = connectorDir();
    for (const consumer of BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CONSUMERS) {
      // Test consumers live at `__tests__/<name>.test.ts`; production ones at `<name>.ts`.
      const relative = consumer.consumer.startsWith('__tests__/')
        ? `${consumer.consumer}.test.ts`
        : `${consumer.consumer}.ts`;
      const source = fs.readFileSync(new URL(relative, connector), 'utf8');
      assert.match(
        source,
        /BrazilReceitaFullJoinEnginePublicReport|buildBrazilReceitaFullJoinEnginePublicReport|publicReport/,
        `${consumer.consumer} does not actually consume the legacy report`,
      );
    }
  });

  it('the shape is UNCHANGED: all three key declarations still stand in the owning module', () => {
    const owning = codeWithoutComments(
      repoFile(
        'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-engine-report.ts',
      ),
    );
    assert.match(owning, /readonly zero_output_rows_enforced: true;/);
    assert.match(owning, /readonly rows_emitted: 0;/);
    assert.match(owning, /readonly raw_rows_printed: false;/);
    assert.equal(BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_SHAPE_CHANGED, false);
    assert.equal(BRAZIL_RECEITA_GATE5_LEGACY_RENAME_PROVEN_CONTRACT_SAFE, false);
  });

  it('`raw_rows_printed` is still a SAFETY FACT other code checks, which is why it stays', () => {
    // The decisive consumer: the dry-run runner's own safety block asserts it false, and a suite
    // reads it. Renaming it would rewrite a claim, not tidy a name.
    const runnerSuite = repoFile(
      'src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-full-join-dry-run-runner.test.ts',
    );
    assert.match(runnerSuite, /report\.safety\.raw_rows_printed/);
  });

  it('the boundary module touches neither contract it describes', () => {
    const boundary = codeWithoutComments(
      repoFile(
        'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate5-engine-report-boundary.ts',
      ),
    );
    // It imports NOTHING — not the legacy report, not 11A, not the GATE-5 lists.
    assert.ok(
      !/^\s*import\s/m.test(boundary),
      'the boundary record must not import a contract it only describes',
    );
  });
});

// ─── 3 · The three keys, and the ASYMMETRY that explains everything ───────────

describe('BOUNDARY · the three legacy keys are internal safety facts, refused by GATE-5', () => {
  it('classifies all three as LEGACY_ENGINE_INTERNAL_SAFETY_FACT', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_KEY_RECORDS.length, 3);
    const keys = BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_KEY_RECORDS.map((r) => r.key).sort();
    assert.deepEqual(keys, [...LEGACY_KEY_NAMES].sort());
    for (const record of BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_KEY_RECORDS) {
      assert.equal(record.disposition, 'LEGACY_ENGINE_INTERNAL_SAFETY_FACT');
      assert.equal(record.mayRemainInLegacyObject, true);
      assert.equal(record.maySurviveToGate5Surface, false);
      assert.equal(record.gate5Allowlisted, false);
      assert.equal(record.tripsDenylistGroup, 7);
    }
  });

  it('the recorded denylist group and allowlist status are TRUE of the real contract', () => {
    // Derived by running the guard, never trusted from the record.
    for (const record of BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_KEY_RECORDS) {
      assert.equal(
        matchBrazilReceitaGate5ForbiddenKeyGroup(record.key),
        record.tripsDenylistGroup,
        `${record.key} does not trip the group the record claims`,
      );
      assert.equal(isBrazilReceitaGate5AllowedKey(record.key), false, `${record.key}`);
      assert.equal(BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.includes(record.key), false);
    }
  });

  it('🔴 THE ASYMMETRY, proved by execution: 11A passes the three keys and GATE-5 refuses them', () => {
    // This is why the emitter was able to survive BEFORE its fail-closed removal, and it is the
    // single fact most likely to be misremembered as "the sanitizer would have caught it".
    const sanitizer11A = sanitizeBrazilReceitaFullJoinReport(LEGACY_KEYS_FIXTURE);
    assert.equal(sanitizer11A.ok, true, '11A is a denylist over dataset-looking CONTENT — 0 and false look like nothing');
    assert.deepEqual([...sanitizer11A.findings], []);

    const gate5 = guardBrazilReceitaGate5Report(LEGACY_KEYS_FIXTURE);
    assert.equal(gate5.ok, false, 'only the § 6 allowlist refuses a key by ABSENCE');
    for (const key of LEGACY_KEY_NAMES) {
      assert.ok(
        gate5.findings.some((f) => f.rule === 'KEY-ALLOWLIST' && f.path === key),
        `${key} must be refused by the allowlist`,
      );
      assert.ok(
        gate5.findings.some((f) => f.rule === 'KEY-DENYLIST' && f.path === key && f.group === 7),
        `${key} must be refused by group 7 as well`,
      );
    }
    assert.equal(gate5.findings.length, 6, 'three keys × two nets');
  });

  it('🔴 REFUSES rows_emitted -> records_persisted, because emitted ≠ persisted', () => {
    const refusal = BRAZIL_RECEITA_GATE5_REFUSED_LEGACY_KEY_MAPPINGS.find(
      (entry) => entry.from === 'rows_emitted',
    );
    assert.ok(refusal, 'the tempting mapping must be recorded as refused, not merely omitted');
    assert.equal(refusal.to, 'records_persisted');
    assert.equal(refusal.refused, true);
    assert.equal(refusal.provenByAnExistingContract, false);
    assert.match(refusal.reason, /different semantics/);
  });

  it('translates NO legacy key to an approved GATE-5 key, and invents none', () => {
    for (const record of BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_KEY_RECORDS) {
      assert.equal(
        record.translatesToApprovedGate5Key,
        null,
        `${record.key} must be omitted from external output, never mapped without proof`,
      );
    }
    assert.equal(BRAZIL_RECEITA_GATE5_NEW_KEY_INVENTED_FOR_A_LEGACY_NAME, false);
    // And no legacy name leaked into the frozen allowlist as a new member.
    for (const key of LEGACY_KEY_NAMES) {
      assert.equal(BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.includes(key), false);
    }
  });
});

// ─── 4 · The required projection ──────────────────────────────────────────────

describe('BOUNDARY · a future emitter MUST project, and the shortcut is named', () => {
  it('requires the projection, in order', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_ENGINE_REPORT_PROJECTION_REQUIRED, true);
    assert.deepEqual([...BRAZIL_RECEITA_GATE5_REQUIRED_PROJECTION_PIPELINE], [
      'engine_observations',
      'legacy_engine_report_or_internal_safety_facts',
      'gate5_projection',
      'gate5_closed_allowlist',
      'gate5_denylist_and_value_guards',
      'external_output',
    ]);
  });

  it('names the forbidden shortcut as its own constant', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATE5_FORBIDDEN_PROJECTION_SHORTCUT], [
      'legacy_engine_report',
      'external_output',
    ]);
    // The shortcut must be a strict, shorter path than the required pipeline — otherwise the two
    // records describe the same thing and the prohibition means nothing.
    assert.ok(
      BRAZIL_RECEITA_GATE5_FORBIDDEN_PROJECTION_SHORTCUT.length <
        BRAZIL_RECEITA_GATE5_REQUIRED_PROJECTION_PIPELINE.length,
    );
  });

  it('does NOT implement the projection, and does not claim authorization to', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTED, false);
    assert.equal(BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTATION_AUTHORIZED_NOW, false);
  });
});

// ─── 5 · 🔴 The emitter accounting, and the ratchet that proves itself ────────

/**
 * The exact expression the FINAL FAIL-CLOSED EMITTER REMOVAL deleted, assembled from fragments so
 * that this literal is NOT itself a detectable emission site in this file.
 */
const REMOVED_EMISSION_EXPRESSION = [
  'process.stdout',
  '.write(`${JSON',
  '.stringify(outcome.publicReport, null, 2)}\\n`);',
].join('');

/** The emission-site detector, shared by the sweep and by the self-test that proves it fires. */
const EMISSION_SITE =
  /(?:JSON\.stringify|process\.std(?:out|err)\.write|console\.(?:log|info|warn|error|debug)|writeFileSync|appendFileSync|createWriteStream)[\s\S]{0,160}?\b(?:publicReport|engine_report|releasedEngineReport)\b/;

/** Every `.ts` file in the connector and in the operator scripts, as executable code only. */
function sweepSources(): ReadonlyArray<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  for (const [dir, prefix] of [
    [connectorDir(), 'src/server/source-catalog/connectors/br-receita-cnpj/'],
    [scriptsDir(), 'scripts/source-catalog/'],
  ] as const) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue;
      out.push([`${prefix}${name}`, executableCodeOnly(fs.readFileSync(new URL(name, dir), 'utf8'))]);
    }
  }
  return out;
}

const CLI_RELATIVE_PATH =
  'scripts/source-catalog/run-br-receita-cnpj-real-full-scan-resource-benchmark.ts';

describe('BOUNDARY · the historical emitter is recorded, and the live set is empty', () => {
  it('A · keeps the HISTORICAL finding, with its resolution, rather than erasing it', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_HISTORICAL_BYPASS_RECORDED, true);
    assert.equal(BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_HISTORICAL_DIRECT_EMITTERS.length, 1);
    const historical = BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_HISTORICAL_DIRECT_EMITTERS[0];
    assert.equal(historical.emittingModule, CLI_RELATIVE_PATH);
    assert.equal(historical.surface, 'cli_stdout');
    assert.equal(historical.resolution, 'removed_by_fail_closed_boundary');
    assert.ok(historical.removedExpression, 'the removed expression must be recorded for grepping');
    // The asymmetry that let it survive stays on the record.
    assert.equal(historical.passesSanitizer11A, true);
    assert.equal(historical.passesGate5Allowlist, false);
    assert.ok(historical.chain.length >= 4);
    assert.ok(historical.reachabilityGates.length >= 3);
  });

  it('B · the LIVE set is empty, and the verdict is DERIVED from it rather than typed', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CURRENT_DIRECT_EMITTERS], []);
    assert.equal(brazilReceitaGate5DirectEngineReportExternalEmitterExists(), false);
    // 🔴 Derivation, not duplication: the verdict must AGREE with the array by construction.
    assert.equal(
      brazilReceitaGate5DirectEngineReportExternalEmitterExists(),
      BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CURRENT_DIRECT_EMITTERS.length > 0,
    );
    assert.equal(brazilReceitaGate5EngineReportCurrentBypassAbsent(), true);
  });

  it('C · the previously-known benchmark emitter is SPECIFICALLY absent from the CLI', () => {
    const cli = executableCodeOnly(repoFile(CLI_RELATIVE_PATH));
    assert.ok(
      !/process\.stdout\.write\([\s\S]{0,80}?JSON\.stringify\(\s*outcome\.publicReport/.test(cli),
      'the benchmark CLI must no longer serialize outcome.publicReport',
    );
    // And nothing else in that file reaches the legacy object either.
    assert.ok(!EMISSION_SITE.test(cli), 'no emission site may remain in the benchmark CLI');
  });

  it('C · the withheld status travels as an EXIT CODE, with no substitute report', () => {
    const cli = repoFile(CLI_RELATIVE_PATH);
    assert.match(cli, /export const LEGACY_REPORT_WITHHELD_EXIT_CODE = \d+ as const;/);
    assert.match(cli, /process\.exitCode = LEGACY_REPORT_WITHHELD_EXIT_CODE;/);
    assert.equal(BRAZIL_RECEITA_GATE5_WITHHELD_OUTPUT_BEHAVIOUR.statusTravelsAs, 'process_exit_code');
    for (const forbidden of [
      'legacyReportOnStdout',
      'legacyReportOnStderr',
      'stackEmitted',
      'uncaughtErrorThrown',
      'jsonContainingTheLegacyObject',
      'fileOrLogFallback',
      'identifierPathOrSample',
      'newHumanReadableDiagnosticSurfaceInvented',
    ] as const) {
      assert.equal(BRAZIL_RECEITA_GATE5_WITHHELD_OUTPUT_BEHAVIOUR[forbidden], false, forbidden);
    }
  });

  it('B · no module anywhere in scope reaches the legacy report on any surface', () => {
    const discovered = sweepSources()
      .filter(([, code]) => EMISSION_SITE.test(code))
      .map(([name]) => name);
    assert.deepEqual(
      discovered.sort(),
      BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CURRENT_DIRECT_EMITTERS.map((e) => e.emittingModule),
      'a legacy-report emission site is not in the live recorded set — record it, never exclude the file',
    );
    assert.deepEqual(discovered, [], 'the live set is empty, so the sweep must find nothing');
  });

  it('G · no file, log or artifact write reaches the legacy report either', () => {
    const fileOrLogger =
      /(?:writeFileSync|appendFileSync|createWriteStream|console\.(?:log|info|warn|error|debug))[\s\S]{0,160}?\b(?:releasedEngineReport|engine_report|publicReport)\b/;
    const offenders = sweepSources()
      .filter(([, code]) => fileOrLogger.test(code))
      .map(([name]) => name);
    assert.deepEqual(offenders, [], 'the legacy report must not reach a file, a log or an artifact');
  });

  // ── The detector is proved to FIRE, on each surface the correction names ─────

  it('D · re-inserting the EXACT removed expression is detected', () => {
    // 🔴 The self-test that makes the ratchet trustworthy. The removed line is spliced back into an
    // in-memory copy of the real CLI source — nothing is written to disk — and the detector must fire.
    const revived = `${executableCodeOnly(repoFile(CLI_RELATIVE_PATH))}\n${REMOVED_EMISSION_EXPRESSION}\n`;
    assert.ok(EMISSION_SITE.test(revived), 'the exact removed expression must be caught on return');
    assert.ok(
      /process\.stdout\.write\([\s\S]{0,80}?JSON\.stringify\(\s*outcome\.publicReport/.test(revived),
      'the specific-absence check must also catch the exact expression',
    );
  });

  it('E · a synthetic NEW stdout emitter is detected', () => {
    const synthetic = 'process.stdout.write(JSON.stringify(engine_report));';
    assert.ok(EMISSION_SITE.test(synthetic));
  });

  it('F · a synthetic stderr emitter is detected', () => {
    const synthetic = 'process.stderr.write(JSON.stringify(releasedEngineReport));';
    assert.ok(EMISSION_SITE.test(synthetic));
  });

  it('G · a synthetic file and a synthetic log emitter are detected', () => {
    assert.ok(EMISSION_SITE.test("writeFileSync(target, JSON.stringify(engine_report));"));
    assert.ok(EMISSION_SITE.test('console.log(JSON.stringify(publicReport));'));
    assert.ok(EMISSION_SITE.test('createWriteStream(p).write(JSON.stringify(engine_report));'));
  });

  it('I · a TEMPLATE-LITERAL interpolation of a real emitter is still caught', () => {
    // 🔴 This is why `executableCodeOnly` strips only quoted strings and KEEPS backticks: the real
    // emitter interpolated inside a template literal, and stripping those would have hidden it.
    const templated = 'process.stdout.write(`${JSON.stringify(outcome.publicReport)}`);';
    assert.ok(EMISSION_SITE.test(executableCodeOnly(templated)));
    assert.ok(
      /process\.stdout\.write\([\s\S]{0,80}?JSON\.stringify\(\s*outcome\.publicReport/.test(
        executableCodeOnly(templated),
      ),
    );
  });

  it('H · a MENTION in prose, a comment or provenance data is NOT a false positive', () => {
    // The boundary record names `process.stdout.write of JSON.stringify(outcome.publicReport)` as the
    // recorded `mechanism`, and the CLI keeps the removed line in a comment for the next reader. Both
    // must stay invisible to the detector, or the guard teaches people to delete the audit trail.
    const asComment = '// process.stdout.write(`${JSON.stringify(outcome.publicReport, null, 2)}`);';
    assert.ok(!EMISSION_SITE.test(executableCodeOnly(asComment)), 'a comment is not an emitter');
    const asQuotedData = "const m = 'process.stdout.write of JSON.stringify(outcome.publicReport)';";
    assert.ok(!EMISSION_SITE.test(executableCodeOnly(asQuotedData)), 'prose data is not an emitter');
    // And the two real files that contain such mentions are clean under the sweep.
    for (const path of [
      CLI_RELATIVE_PATH,
      'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate5-engine-report-boundary.ts',
    ]) {
      assert.ok(
        !EMISSION_SITE.test(executableCodeOnly(repoFile(path))),
        `${path} names the mechanism in prose and must not be flagged`,
      );
    }
  });
});

// ─── 6 · The boundary verdict, split into its two honest halves ───────────────

describe('BOUNDARY · the verdict is derived, and a removal is not a capability', () => {
  it('both halves now hold, and the verdict is DERIVED from them', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_CONTRACT_RECORDED, true);
    assert.equal(brazilReceitaGate5EngineReportCurrentBypassAbsent(), true);
    assert.equal(brazilReceitaGate5EngineReportBoundaryResolved(), true);
    // 🔴 And the derivation is checked, not assumed: the verdict must equal the conjunction.
    assert.equal(
      brazilReceitaGate5EngineReportBoundaryResolved(),
      BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_CONTRACT_RECORDED &&
        brazilReceitaGate5EngineReportCurrentBypassAbsent(),
    );
  });

  it('🔴 "the bypass is gone" and "a projection is still required" are BOTH true', () => {
    // Not a contradiction, and the pairing is the point: the current hole is closed, and a future
    // external report still has to be projected through the closed allowlist to exist at all.
    assert.equal(brazilReceitaGate5EngineReportBoundaryResolved(), true);
    assert.equal(BRAZIL_RECEITA_GATE5_ENGINE_REPORT_PROJECTION_REQUIRED, true);
    assert.equal(BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTED, false);
    assert.equal(BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTATION_AUTHORIZED_NOW, false);
  });

  it('this change REMOVED an emission path and added no runner capability', () => {
    assert.deepEqual(BRAZIL_RECEITA_GATE5_EMITTER_REMOVAL_CHARACTER, {
      addsRunnerCapability: false,
      removesAnExternalEmissionPath: true,
      inventedAReplacementSchema: false,
      addedReplacementOutputFields: false,
      weakenedGate5: false,
      weakened11A: false,
      addedAnOutputException: false,
    });
  });

  it('the engineering blocker is recorded as DISCHARGED, and never by a signature', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_ENGINEERING_BLOCKER_HISTORY.length, 1);
    const entry = BRAZIL_RECEITA_GATE5_ENGINEERING_BLOCKER_HISTORY[0];
    assert.equal(entry.owner, 'engineering');
    assert.equal(entry.discharged, true);
    assert.equal(
      entry.dischargedByAHumanApproval,
      false,
      'an emission path is code; no signature deletes a line',
    );
    assert.match(entry.blocker, /cli_stdout/);
    assert.match(entry.dischargedBy, /no projection was implemented/);
    assert.deepEqual([...BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKERS], []);
  });

  it('🔴 five gates now wait only on humans — DERIVED from the live emitter set, not typed', () => {
    assert.equal(brazilReceitaGate5FiveGatesWaitOnlyOnHumans(), true);
    // The exact derivation the correction demanded: from the array length, never a hand-set boolean.
    assert.equal(
      brazilReceitaGate5FiveGatesWaitOnlyOnHumans(),
      BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CURRENT_DIRECT_EMITTERS.length === 0 &&
        BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKERS.length === 0,
    );
  });
});

// ─── 7 · The human packet discloses it ────────────────────────────────────────

describe('BOUNDARY · the GATE-5 human section discloses the boundary', () => {
  it('the GATE-5 section names the legacy engine report as NOT an approved emission schema', () => {
    const gate5 = BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS.find(
      (section) => section.id === 'DECISION-GATE-5',
    );
    assert.ok(gate5);
    const text = [...gate5.restrictions, gate5.question].join(' | ');
    assert.match(text, /still exists UNCHANGED/);
    assert.match(text, /is not itself a GATE-5-approved emission schema/);
  });

  it('the subject terms name the projection requirement, so the architecture is what is approved', () => {
    const text = BRAZIL_RECEITA_SIGNOFF_GATE5_SUBJECT_TERMS.join(' | ');
    assert.match(text, /project only the closed GATE-5 allowlist/);
  });

  it('the disclosure states the bypass was REMOVED fail-closed, not merely described', () => {
    const gate5 = BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS.find(
      (section) => section.id === 'DECISION-GATE-5',
    );
    const text = [...(gate5?.restrictions ?? [])].join(' | ');
    assert.match(text, /removed fail-closed/);
    assert.match(text, /no GATE-5 projection exists/);
  });

  it('the packet DOCUMENT discloses the removal and the still-required projection', () => {
    // 🔴 Markdown hard-wraps at ~100 columns, so a multi-word phrase can be split across a newline
    // and a `\s`-naive regex would report the disclosure missing when it is present. Whitespace is
    // collapsed before matching prose; the structural assertions below still read the raw text.
    const raw = repoFile('docs/source-catalog/br-receita-cnpj-final-owner-signoff-packet.md');
    // 🔴 Blockquote markers must go BEFORE whitespace is collapsed: the disclosure sits inside a `>`
    // quote and wraps mid-phrase, so collapsing alone leaves a stray `>` in the middle of the
    // sentence and a naive regex reports the disclosure missing when it is present.
    const packet = markdownProse(raw);
    assert.match(packet, /not itself a GATE-5-approved emission schema/);
    assert.match(packet, /removed fail-closed/i);
    // The five facts § 10 requires the disclosure to carry.
    assert.match(packet, /historical shape is UNCHANGED|still exists UNCHANGED|shape is \*\*unchanged\*\*/i);
    assert.match(packet, /no approved external report of a full-join run at all/);
    assert.match(packet, /PROJECTION_REQUIRED/);
    assert.match(packet, /addsRunnerCapability: false/);
    // 🔴 The exact sentence that is only valid once the boundary is clear must be gone. Asserted on
    // the collapsed text so a re-wrap cannot let it back in unnoticed.
    assert.ok(
      !/waiting on a named human's answer and on nothing else/.test(packet),
      'the "nothing else" wording is only valid once the emitter is gone',
    );
    // 🔴 And the HISTORY of the wrong claim is still visible, so a reader of the diff-free document
    // learns the earlier draft said something false and why. The claim holds again — but the document
    // says it holds because the code changed, not because the sentence was quietly re-approved.
    assert.match(packet, /untrue at the time/);
    assert.match(packet, /it is now \*\*computed\*\*, not asserted/);
    assert.match(raw, /^### 4\.1 /m);
  });

  it('10K records the boundary in its own subsection', () => {
    const checklist = repoFile(
      'docs/source-catalog/br-receita-cnpj-full-join-approval-gates-checklist.md',
    );
    assert.match(checklist, /^### 9\.3 /m);
    assert.match(checklist, /LEGACY_ENGINE_SANITIZED_REPORT_SHAPE/);
  });
});

// ─── 8 · No gate moved ────────────────────────────────────────────────────────

describe('BOUNDARY · no gate approval is earned by this correction', () => {
  // 🔴 UPDATED BY BR-SOURCE-FAST-TRACK-7, THEN BY BR-SOURCE-FAST-TRACK-8 — two LATER, separate rounds
  // recorded human owner approvals: FAST-TRACK-7 for GATE-2, GATE-3, GATE-4, GATE-5 and GATE-6, and
  // FAST-TRACK-8 for GATE-7. That is a different fact from the one this suite tests: the FAST-TRACK-6
  // engine-report-boundary CORRECTION itself earned none of them. The statuses below reflect the
  // current, post-FAST-TRACK-8 state; the boundary fix is still not what earned any of it.
  it('the eight statuses reflect BR-SOURCE-FAST-TRACK-8; the boundary fix itself earned none of them', () => {
    const byGate = new Map(BRAZIL_RECEITA_GATE_CURRENT_STATE.map((e) => [e.gate, e.status]));
    assert.equal(byGate.get(1), 'approved');
    assert.equal(byGate.get(2), 'approved');
    assert.equal(byGate.get(3), 'approved');
    assert.equal(byGate.get(4), 'approved');
    assert.equal(byGate.get(5), 'approved');
    assert.equal(byGate.get(6), 'approved');
    assert.equal(byGate.get(7), 'approved');
    assert.equal(byGate.get(8), 'APPROVED_AS_CONTRACT');
    assert.equal(brazilReceitaGateGlobalVerdict(), 'GO');
  });

  it('GATE-5 and GATE-7 are both approved, by two SEPARATE later rounds and not by this correction', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_STATUS, 'approved');
    assert.equal(BRAZIL_RECEITA_GATE7_STATUS, 'approved');
    assert.equal(BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(BRAZIL_RECEITA_GATE5_STATUS), true);
    assert.equal(BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(BRAZIL_RECEITA_GATE7_STATUS), true);
  });

  it('the boundary module is pure, unwired, and carries no identifier', () => {
    const path =
      'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate5-engine-report-boundary.ts';
    const raw = repoFile(path);
    const code = codeWithoutComments(raw);
    // 🔴 Match a CALL, not a mention. This module's whole job is to DESCRIBE an emitter, so it
    // necessarily contains the string `process.stdout.write of JSON.stringify(...)` as the recorded
    // `mechanism` of the defect. A bare-substring purity check would flag the record for naming the
    // thing it exists to name — the same false-positive class this round already had to narrow twice.
    assert.ok(!/console\s*\.\s*(?:log|info|warn|error|debug)\s*\(/.test(code), 'no console call');
    assert.ok(
      !/process\s*\.\s*std(?:out|err)\s*\.\s*write\s*\(/.test(code),
      'no process-stream write call',
    );
    assert.ok(!/from 'node:(fs|path|net|child_process|http)/.test(code), 'no I/O import');
    assert.ok(!/process\s*\.\s*env\b/.test(code), 'no env read');
    // Belt and braces: it holds no executable statement that could emit at all — no imports either.
    assert.ok(!/^\s*import\s/m.test(code), 'the boundary record imports nothing');
    assert.deepEqual(raw.match(/(?<!\d)\d{8,}(?!\d)/g) ?? [], []);
    assert.ok(raw.split('\n').length <= 800, 'the 800-line ceiling holds');
  });

  it('only the human packet imports the boundary record — no execution path does', () => {
    // 🔴 This list was empty until the FINAL FAIL-CLOSED EMITTER REMOVAL, and it gained exactly one
    // entry for a reason § 10 demanded: the packet must DERIVE "human answers are the only remaining
    // work" from the live emitter set rather than declare it. A governance record reading another
    // governance record is not wiring; what must stay absent is the engine, the runner and the
    // scripts, and the next assertion checks those by name.
    const dir = connectorDir();
    const importsBoundary = (code: string): boolean =>
      /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"][^'"]*br-receita-cnpj-gate5-engine-report-boundary['"]/.test(
        code,
      );

    const importers = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => name !== 'br-receita-cnpj-gate5-engine-report-boundary.ts')
      .filter((name) => importsBoundary(codeWithoutComments(fs.readFileSync(new URL(name, dir), 'utf8'))));
    assert.deepEqual(importers, ['br-receita-cnpj-final-owner-signoff-packet.ts']);

    // No execution path may reach it — not the engine, not the runner, not the benchmark, not a script.
    for (const name of [
      'br-receita-cnpj-full-join-engine.ts',
      'br-receita-cnpj-full-join-engine-report.ts',
      'br-receita-cnpj-full-join-dry-run-runner.ts',
      'br-receita-cnpj-real-full-scan-benchmark.ts',
      'br-receita-cnpj-full-join-output-sanitizer.ts',
    ]) {
      assert.ok(
        !importsBoundary(codeWithoutComments(fs.readFileSync(new URL(name, dir), 'utf8'))),
        `${name} must not import the boundary record`,
      );
    }
    for (const [name] of sweepSources().filter(([n]) => n.startsWith('scripts/'))) {
      const code = codeWithoutComments(repoFile(name));
      assert.ok(!importsBoundary(code), `${name} must not import the boundary record`);
    }
  });

  it('this suite is a REQUIRED CI step, asserted on the run: line and not the step name', () => {
    const workflow = repoFile('.github/workflows/automatic-routing-tests.yml');
    const runLines = workflow
      .split('\n')
      .filter((line) => /^\s*run:\s/.test(line))
      .join('\n');
    assert.match(runLines, /npm run test:br-source:fast-track6-engine-report-boundary/);
    // The emitter-removal step, which also runs the CLI suites that must not break.
    assert.match(runLines, /npm run test:br-source:fast-track6-emitter-removal/);
  });
});

// ─── 9 · The audit text may not contradict the audit state ────────────────────

/**
 * 🔴 These guards exist because the FINAL FAIL-CLOSED EMITTER REMOVAL changed the STATE but left four
 * sentences describing the OLD state in the PRESENT tense. A human packet that records the blocker
 * DISCHARGED in § 6.1 and then, under GATE-5, tells the approver their signature "does not discharge
 * the engineering blocker above" is not a wording nit: it is a document that answers the reader's own
 * question two different ways, and the reader has no way to know which half is stale.
 *
 * Each assertion pins ONE exact contradiction that actually occurred. This is deliberately NOT a prose
 * linter — a broad "no present tense near a removed thing" rule would fire on every legitimate
 * description of the live guard and would be disabled within a round. HISTORICAL wording is not merely
 * tolerated here, it is REQUIRED: the positive assertions below fail if the past-tense framing that
 * carries the finding forward is ever quietly deleted along with the contradiction.
 */
describe('BOUNDARY · the audit TEXT matches the audit STATE (no stale present tense)', () => {
  /** The comment block immediately above a workflow step, as normalized single-space text. */
  function workflowCommentBlockAbove(runCommand: string): string {
    const lines = repoFile('.github/workflows/automatic-routing-tests.yml').split('\n');
    const runIndex = lines.findIndex((line) =>
      new RegExp(`^\\s*run:\\s.*${runCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(line),
    );
    assert.ok(runIndex > 0, `the step running ${runCommand} must exist`);
    const collected: string[] = [];
    // Walk backwards over the step's own `- name:` line, then over its contiguous comment block.
    for (let i = runIndex - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (/^\s*-\s*name:\s/.test(line)) continue;
      if (/^\s*#/.test(line)) {
        collected.unshift(line.replace(/^\s*#\s?/, ''));
        continue;
      }
      break;
    }
    assert.ok(collected.length > 0, `${runCommand} must carry a comment block`);
    return collected.join(' ').replace(/\s+/g, ' ');
  }

  // A · the packet may not tell the approver the blocker is still open.
  it('A · the owner packet does NOT carry the current-state "does not discharge the engineering blocker" phrase', () => {
    const packet = markdownProse(
      repoFile('docs/source-catalog/br-receita-cnpj-final-owner-signoff-packet.md'),
    );
    // Markdown bold markers sit inside the phrase (`does **not** discharge`), so they are stripped
    // before matching — otherwise re-emphasising the sentence would smuggle the contradiction back in.
    const unemphasised = packet.replace(/\*\*/g, '');
    assert.ok(
      !/does not discharge the engineering blocker/i.test(unemphasised),
      'the blocker is DISCHARGED in § 6.1; the GATE-5 bound may not claim otherwise',
    );
    // And § 6.1 really does record it discharged — so this guard cannot be satisfied by deleting § 6.1.
    assert.match(packet, /The engineering blocker that stood here — now DISCHARGED/);
    assert.match(unemphasised, /discharged: YES — the serialization was removed fail-closed/);
    // The replacement bound must still fence the projection, which remains unimplemented.
    assert.match(
      unemphasised,
      /it does not authorize or implement the future GATE-5 projection, and must not be read as approving the legacy object as an emission schema/,
    );
  });

  // B · the packet may not describe the removed bypass in the present tense.
  it('B · the owner packet describes the removed bypass in the PAST tense', () => {
    const packet = markdownProse(
      repoFile('docs/source-catalog/br-receita-cnpj-final-owner-signoff-packet.md'),
    );
    assert.ok(
      !/Why it survives:/i.test(packet),
      'the bypass was removed; "Why it survives:" describes a live path',
    );
    assert.ok(!/Why it survives today/i.test(packet));
    // Historical wording is REQUIRED, not merely allowed: the finding must still be carried forward.
    assert.match(packet, /Why the bypass was able to survive before removal/i);
  });

  // C · 10K § 9.3 may not describe the removed bypass in the present tense.
  it('C · 10K § 9.3 describes the removed bypass in the PAST tense', () => {
    const raw = repoFile('docs/source-catalog/br-receita-cnpj-full-join-approval-gates-checklist.md');
    // Bold markers AND inline-code backticks are stripped: § 9.3 writes the finding kinds as
    // `KEY-ALLOWLIST` / `KEY-DENYLIST`, so a backtick-naive regex reports the reasoning missing when
    // it is present — and would then "pass" only by being weakened.
    const checklist = markdownProse(raw).replace(/[*`]/g, '');
    assert.ok(
      !/Why it survives today/i.test(checklist),
      '§ 9.3 records the bypass REMOVED; "survives today" contradicts it',
    );
    assert.match(checklist, /Why it survived before removal/i);
    // The technical reasoning § 9.3 exists to carry must survive the tense fix, all of it.
    assert.match(raw, /^### 9\.3 /m);
    assert.match(checklist, /BR-SOURCE-11A is a denylist over dataset-looking content/i);
    assert.match(checklist, /Only the § 6 allowlist refuses a key by ABSENCE/);
    assert.match(checklist, /returns six findings — three KEY-ALLOWLIST, three KEY-DENYLIST group 7/);
    assert.match(checklist, /REMOVED fail-closed/i);
    assert.match(checklist, /cli_stdout/);
  });

  // D · the boundary step's CI comment may not claim a CURRENT open emitter.
  it('D · the boundary CI comment states the HISTORICAL finding, not a current open defect', () => {
    const comment = workflowCommentBlockAbove('test:br-source:fast-track6-engine-report-boundary');

    for (const stale of [
      /ESTA SUITE DOCUMENTA UN DEFECTO ABIERTO/i,
      /EXISTE UN EMISOR DIRECTO/i,
      /ingeniería limpia = false/i,
      /FIVE_GATES_WAIT_ONLY_ON_HUMANS\s*=\s*false/i,
    ]) {
      assert.ok(!stale.test(comment), `stale current-state claim in the boundary comment: ${stale}`);
    }

    // The five facts the comment must state, so the next reader cannot read the suite backwards.
    assert.match(comment, /HISTORICAL_DIRECT_EMITTER_EXISTED\s*=\s*true/);
    assert.match(comment, /HISTORICAL_FINDING_PRESERVED\s*=\s*true/);
    assert.match(comment, /CURRENT_DIRECT_EMITTER_EXISTS\s*=\s*false/);
    assert.match(comment, /CURRENT_ENGINEERING_BLOCKER\s*=\s*false/);
    assert.match(comment, /FIVE_GATES_WAIT_ONLY_ON_HUMANS\s*=\s*true/);
    // Historical evidence is preserved, and the projection is still owed.
    assert.match(comment, /resolution: removed_by_fail_closed_boundary/);
    assert.match(comment, /GATE5_ENGINE_REPORT_PROJECTION_REQUIRED=true/);
    assert.match(comment, /La proyección NO se implementa/);
    // No gate moved.
    assert.match(comment, /0 gates movidas/);
    assert.match(comment, /NO-GO/);
  });

  it('D · the removal step\'s CI comment still proves the live set is empty', () => {
    const comment = workflowCommentBlockAbove('test:br-source:fast-track6-emitter-removal');
    assert.match(comment, /YA NO EXISTE/);
    assert.match(comment, /El conjunto VIVO está vacío/i);
    assert.match(comment, /removed_by_fail_closed_boundary/);
    assert.match(comment, /addsRunnerCapability: false/);
    assert.match(comment, /removesAnExternalEmissionPath: true/);
  });

  // E · all three FAST-TRACK-6 commands still execute.
  it('E · the workflow still runs all three FAST-TRACK-6 commands on run: lines', () => {
    // 🔴 Asserted on `run:` lines only. Grepping step NAMES is the known false positive here: a
    // renamed step reads as present while the command that proves anything is gone.
    const runLines = repoFile('.github/workflows/automatic-routing-tests.yml')
      .split('\n')
      .filter((line) => /^\s*run:\s/.test(line))
      .join('\n');
    for (const command of [
      'npm run test:br-source:fast-track6-gate5-and-gate7',
      'npm run test:br-source:fast-track6-engine-report-boundary',
      'npm run test:br-source:fast-track6-emitter-removal',
    ]) {
      assert.ok(runLines.includes(command), `${command} must still run in CI`);
    }
  });
});
