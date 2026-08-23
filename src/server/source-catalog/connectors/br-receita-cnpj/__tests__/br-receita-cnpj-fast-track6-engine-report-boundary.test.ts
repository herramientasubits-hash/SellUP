/**
 * BR-SOURCE-FAST-TRACK-6 FINAL BOUNDARY CORRECTION — the GATE-5 / legacy engine-report boundary.
 *
 * The legacy `BrazilReceitaFullJoinEnginePublicReport` predates GATE-5 and carries three keys GATE-5
 * refuses. This suite pins the boundary, and it is built around one uncomfortable fact: **a direct
 * emitter exists today.**
 *
 * That shapes every assertion here:
 *
 *   · the emitter sweep asserts the discovered set EQUALS the recorded set — a RATCHET. It does not
 *     assert zero, because zero is false, and a false assertion of zero is worse than none. It does
 *     not exclude the offending file either, because excluding it is hiding the defect behind an
 *     allowlist. A new emitter fails this suite; so does silently deleting the record.
 *   · the ASYMMETRY is proved by execution, not asserted in prose: 11A returns `ok` on the three
 *     legacy keys and the GATE-5 guard returns six findings on the same three. That is the entire
 *     reason the emitter survives today, and it is the thing most likely to be misremembered.
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
  BRAZIL_RECEITA_GATE5_DIRECT_ENGINE_REPORT_EXTERNAL_EMITTER,
  BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_CONTRACT_RECORDED,
  BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_ENGINEERING_CLEAR,
  BRAZIL_RECEITA_GATE5_ENGINE_REPORT_PROJECTION_REQUIRED,
  BRAZIL_RECEITA_GATE5_FIVE_GATES_WAIT_ONLY_ON_HUMANS,
  BRAZIL_RECEITA_GATE5_FORBIDDEN_PROJECTION_SHORTCUT,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_KEY_RECORDS,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CLASSIFICATION,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CONSUMERS,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_FORBIDDEN_DIRECT_SURFACES,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_IS_AN_APPROVED_EMISSION,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_KNOWN_DIRECT_EMITTERS,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_PERMITTED_USE,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_SHAPE_CHANGED,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_SUBJECT,
  BRAZIL_RECEITA_GATE5_LEGACY_RENAME_PROVEN_CONTRACT_SAFE,
  BRAZIL_RECEITA_GATE5_LEGACY_REPORT_NAME_IMPLIES_APPROVAL,
  BRAZIL_RECEITA_GATE5_NEW_KEY_INVENTED_FOR_A_LEGACY_NAME,
  BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTATION_AUTHORIZED_NOW,
  BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTED,
  BRAZIL_RECEITA_GATE5_REFUSED_LEGACY_KEY_MAPPINGS,
  BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKER,
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
    // This is why the emitter survives today, and it is the single fact most likely to be
    // misremembered as "the sanitizer would have caught it".
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

// ─── 5 · 🔴 The negative-emission sweep, as a RATCHET ─────────────────────────

describe('BOUNDARY · the direct-emitter sweep reports the truth, and ratchets', () => {
  it('records the emitter that EXISTS rather than asserting a false zero', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_DIRECT_ENGINE_REPORT_EXTERNAL_EMITTER, true);
    assert.equal(BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_KNOWN_DIRECT_EMITTERS.length, 1);
    const emitter = BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_KNOWN_DIRECT_EMITTERS[0];
    assert.equal(emitter.surface, 'cli_stdout');
    assert.equal(emitter.passesSanitizer11A, true);
    assert.equal(emitter.passesGate5Allowlist, false);
    assert.equal(emitter.resolvedByThisRound, false);
    assert.equal(emitter.isALiveRuntimePath, false);
    assert.ok(emitter.chain.length >= 4, 'the chain must be traceable end to end');
    assert.ok(emitter.reachabilityGates.length >= 3, 'the walls in front of it must be named');
  });

  it('the recorded emitter REALLY serializes the outer report to stdout', () => {
    // 🔴 Read the two files in the chain. A recorded defect nobody verified is a rumour.
    const script = codeWithoutComments(
      repoFile('scripts/source-catalog/run-br-receita-cnpj-real-full-scan-resource-benchmark.ts'),
    );
    assert.match(
      script,
      /process\.stdout\.write\(`\$\{JSON\.stringify\(outcome\.publicReport/,
      'the recorded emitter no longer matches the source — update the record, do not delete it',
    );
    const benchmark = codeWithoutComments(
      repoFile(
        'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-real-full-scan-benchmark.ts',
      ),
    );
    // And the outer report really embeds the legacy object WHOLE.
    assert.match(benchmark, /engine_report: sanitization\.releasedEngineReport,/);
    assert.match(benchmark, /releasedEngineReport: verdict\.ok \? engineReport : null,/);
  });

  it('🔴 RATCHET: no module serializes the legacy report beyond the ONE recorded emitter', () => {
    // The sweep looks for a serialization of anything named `publicReport` / `engine_report` next to
    // an emission mechanism, across the connector AND the operator scripts. The discovered set must
    // EQUAL the recorded set: a new emitter fails, and so does quietly dropping the record.
    const emissionSite =
      /(?:JSON\.stringify|process\.std(?:out|err)\.write|console\.(?:log|info|warn|error|debug)|writeFileSync|appendFileSync|createWriteStream)[\s\S]{0,160}?\b(?:publicReport|engine_report|releasedEngineReport)\b/;

    const discovered: string[] = [];
    for (const [dir, prefix] of [
      [connectorDir(), 'src/server/source-catalog/connectors/br-receita-cnpj/'],
      [scriptsDir(), 'scripts/source-catalog/'],
    ] as const) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.ts')) continue;
        const code = executableCodeOnly(fs.readFileSync(new URL(name, dir), 'utf8'));
        if (emissionSite.test(code)) discovered.push(`${prefix}${name}`);
      }
    }

    const recorded = BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_KNOWN_DIRECT_EMITTERS.map(
      (entry) => entry.emittingModule,
    );
    assert.deepEqual(
      discovered.sort(),
      [...recorded].sort(),
      'a legacy-report emission site is not in the recorded set — report it, never exclude the file',
    );
  });

  it('nothing writes the legacy report to a FILE, and nothing logs it', () => {
    // A narrower, independent sweep: the file/logger surfaces specifically, which are the ones a
    // reader assumes are covered because stdout is the one everybody talks about.
    const fileOrLogger =
      /(?:writeFileSync|appendFileSync|createWriteStream|console\.(?:log|info|warn|error|debug))[\s\S]{0,160}?\b(?:releasedEngineReport|engine_report)\b/;
    const offenders: string[] = [];
    for (const [dir, prefix] of [
      [connectorDir(), 'connector/'],
      [scriptsDir(), 'scripts/'],
    ] as const) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.ts')) continue;
        const code = executableCodeOnly(fs.readFileSync(new URL(name, dir), 'utf8'));
        if (fileOrLogger.test(code)) offenders.push(`${prefix}${name}`);
      }
    }
    assert.deepEqual(offenders, [], 'the legacy report must not reach a file or a logger');
  });
});

// ─── 6 · The boundary verdict, split into its two honest halves ───────────────

describe('BOUNDARY · "documented" and "fixed" are kept apart', () => {
  it('the contract half is recorded and the engineering half is NOT clear', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_CONTRACT_RECORDED, true);
    assert.equal(BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_ENGINEERING_CLEAR, false);
  });

  it('the overall verdict is DERIVED from both halves, so it cannot be rounded up', () => {
    assert.equal(brazilReceitaGate5EngineReportBoundaryResolved(), false);
  });

  it('records the remaining engineering blocker, owned by engineering and not by an approver', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKER.owner, 'engineering');
    assert.equal(
      BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKER.dischargedByAHumanApproval,
      false,
      'no signature discharges an engineering defect',
    );
    assert.equal(BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKER.dischargedByThisRound, false);
    assert.match(BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKER.blocker, /cli_stdout/);
    assert.match(BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKER.fixShape, /allowlist|embedding/);
  });

  it('🔴 does NOT claim five gates wait only on humans, because they do not', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_FIVE_GATES_WAIT_ONLY_ON_HUMANS, false);
    // Derived consistency: the claim may only be true when the emitter is gone AND the boundary is
    // resolved, so the three constants can never disagree.
    assert.equal(
      BRAZIL_RECEITA_GATE5_FIVE_GATES_WAIT_ONLY_ON_HUMANS,
      !BRAZIL_RECEITA_GATE5_DIRECT_ENGINE_REPORT_EXTERNAL_EMITTER &&
        brazilReceitaGate5EngineReportBoundaryResolved(),
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
    assert.match(text, /engine public-report object is not itself a GATE-5-approved emission schema/);
  });

  it('the subject terms name the projection requirement, so the architecture is what is approved', () => {
    const text = BRAZIL_RECEITA_SIGNOFF_GATE5_SUBJECT_TERMS.join(' | ');
    assert.match(text, /project only the closed GATE-5 allowlist/);
  });

  it('the packet DOCUMENT discloses the blocker and drops the "nothing else" wording', () => {
    // 🔴 Markdown hard-wraps at ~100 columns, so a multi-word phrase can be split across a newline
    // and a `\s`-naive regex would report the disclosure missing when it is present. Whitespace is
    // collapsed before matching prose; the structural assertions below still read the raw text.
    const raw = repoFile('docs/source-catalog/br-receita-cnpj-final-owner-signoff-packet.md');
    // 🔴 Blockquote markers must go BEFORE whitespace is collapsed: the disclosure sits inside a `>`
    // quote and wraps mid-phrase, so collapsing alone leaves a stray `>` in the middle of the
    // sentence and a naive regex reports the disclosure missing when it is present.
    const packet = markdownProse(raw);
    assert.match(packet, /not itself a GATE-5-approved emission schema/);
    assert.match(packet, /remaining engineering blocker/i);
    // 🔴 The exact sentence that is only valid once the boundary is clear must be gone. Asserted on
    // the collapsed text so a re-wrap cannot let it back in unnoticed.
    assert.ok(
      !/waiting on a named human's answer and on nothing else/.test(packet),
      'the "nothing else" wording is only valid once the emitter is gone',
    );
    // And the withdrawal is stated, so a reader of the diff-free document learns it was withdrawn.
    assert.match(packet, /the wording is withdrawn/);
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
  it('the eight statuses are exactly what they were', () => {
    const byGate = new Map(BRAZIL_RECEITA_GATE_CURRENT_STATE.map((e) => [e.gate, e.status]));
    assert.equal(byGate.get(1), 'approved');
    assert.equal(byGate.get(2), 'needs_owner_confirmation');
    assert.equal(byGate.get(3), 'ready_for_review');
    assert.equal(byGate.get(4), 'needs_owner_decision');
    assert.equal(byGate.get(5), 'ready_for_review');
    assert.equal(byGate.get(6), 'ready_for_review');
    assert.equal(byGate.get(7), 'blocked');
    assert.equal(byGate.get(8), 'APPROVED_AS_CONTRACT');
    assert.equal(brazilReceitaGateGlobalVerdict(), 'NO-GO');
  });

  it('GATE-5 stays ready_for_review and GATE-7 stays blocked', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_STATUS, 'ready_for_review');
    assert.equal(BRAZIL_RECEITA_GATE7_STATUS, 'blocked');
    assert.equal(BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(BRAZIL_RECEITA_GATE5_STATUS), false);
    assert.equal(BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(BRAZIL_RECEITA_GATE7_STATUS), false);
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

  it('no production module imports the boundary record', () => {
    const dir = connectorDir();
    const importers = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => name !== 'br-receita-cnpj-gate5-engine-report-boundary.ts')
      .filter((name) =>
        /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"][^'"]*br-receita-cnpj-gate5-engine-report-boundary['"]/.test(
          codeWithoutComments(fs.readFileSync(new URL(name, dir), 'utf8')),
        ),
      );
    assert.deepEqual(importers, [], 'the boundary record must not be wired into an execution path');
  });

  it('this suite is a REQUIRED CI step, asserted on the run: line and not the step name', () => {
    const workflow = repoFile('.github/workflows/automatic-routing-tests.yml');
    const runLines = workflow
      .split('\n')
      .filter((line) => /^\s*run:\s/.test(line))
      .join('\n');
    assert.match(runLines, /npm run test:br-source:fast-track6-engine-report-boundary/);
  });
});
