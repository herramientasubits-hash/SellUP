/**
 * BR Receita CNPJ — RECORDED GATE-1 owner decision — tests (BR-SOURCE-GATE1-RECORD).
 *
 * Two properties are load-bearing here, and they pull in opposite directions, which is why both are
 * asserted rather than one:
 *
 *   1. GATE-1 really is approved. `gate1Approved === true` must come out of BR-SOURCE-13A when fed
 *      the recorded decision — not out of prose, and not out of 13C's synthetic fixtures.
 *   2. NOTHING ELSE is. The same evaluation must report every other gate unapproved, the whole
 *      artifact `invalid` / `NO_GO`, and `canProceedToControlledExecutionPreflight === false`. A
 *      Gate-1 approval that leaked into a second section would be caught here.
 *
 * 100% offline. No dataset, no manifest, no CSV, no ZIP, no row, no Supabase, no network, no
 * runtime, no provider, no benchmark. The only file I/O is reading this repository's OWN sources for
 * the static guards at the end.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_GATE1_APPROVAL_DATE,
  BRAZIL_RECEITA_GATE1_APPROVER_ROLE,
  BRAZIL_RECEITA_GATE1_HISTORICAL_EXECUTION_CLAUSE,
  BRAZIL_RECEITA_GATE1_LEGAL_PRIVACY_OWNER_DISPOSITION,
  BRAZIL_RECEITA_GATE1_LICENCE_METADATA_HISTORY,
  BRAZIL_RECEITA_GATE1_LICENCE_RESOLVED_BY_AGENT,
  BRAZIL_RECEITA_GATE1_REQUIRED_EVIDENCE_DISPOSITION,
  BRAZIL_RECEITA_GATE1_RESTRICTIONS,
  buildBrazilReceitaGate1RecordedOwnerDecisionArtifact,
} from '../br-receita-cnpj-gate1-recorded-owner-decision';
import {
  BRAZIL_RECEITA_OWNER_DECISION_FINDING_CODES as CODES,
  BRAZIL_RECEITA_OWNER_DECISION_FORBIDDEN_CONTENT_PATTERNS,
  BRAZIL_RECEITA_OWNER_DECISION_PLACEHOLDER_TOKEN,
  BRAZIL_RECEITA_OWNER_DECISION_REQUIRED_STRING_FIELDS,
  validateBrazilReceitaOwnerDecisionArtifact,
  type OwnerDecisionArtifact,
} from '../br-receita-cnpj-owner-decision-validator';

const CONNECTOR_DIRECTORY = path.resolve(__dirname, '..');

/** Reads one of this connector's own source files. The only I/O in this suite. */
function readConnectorSource(fileName: string): string {
  return fs.readFileSync(path.join(CONNECTOR_DIRECTORY, fileName), 'utf8');
}

/**
 * Removes block and line comments so a static guard inspects what the module DOES, not what it
 * says. Every guard below greps the stripped body: this module's whole purpose is to describe
 * restrictions in prose, so a raw-source grep would fail on its own documentation.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * A COMPLETE, approved-shaped GATE-2 section, built here rather than imported from 13C: composing a
 * real Gate-1 record with a synthetic downstream section is a test concern, and pushing it into
 * either module would blur the real/synthetic boundary both modules depend on.
 */
function buildApprovedShapedGate2Section(): NonNullable<
  OwnerDecisionArtifact['gate2']
> {
  return {
    decisionValue: 'approved',
    ownerRole: 'OWNER_ROLE_SYNTHETIC_GATE2',
    ownerReference: 'OWNER_REF_SYNTHETIC_GATE2',
    decisionDate: '2026-08-21',
    expirationOrReviewDate: '2026-09-21',
    evidencePacketReference: 'EVIDENCE_REF_SYNTHETIC_PACKET',
    legalPrivacySecurityReference: 'LEGAL_REF_SYNTHETIC_PRIVACY_SECURITY',
    operatorReviewerRequirement: 'OPERATOR_REVIEWER_REQUIREMENT_SYNTHETIC',
    incidentEscalationReference: 'INCIDENT_REF_SYNTHETIC',
    stopConditionsAccepted: true,
  };
}

describe('BR Receita CNPJ — recorded GATE-1 owner decision', () => {
  describe('the recorded decision, evaluated by BR-SOURCE-13A', () => {
    it('approves GATE-1 — the recorded human decision is what 13A reads', () => {
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        buildBrazilReceitaGate1RecordedOwnerDecisionArtifact(),
      );

      assert.equal(result.gate1Approved, true);
    });

    it('emits no blocking finding against the gate1 section itself', () => {
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        buildBrazilReceitaGate1RecordedOwnerDecisionArtifact(),
      );

      const gate1Blocking = result.findings.filter(
        (finding) =>
          finding.severity === 'blocking' &&
          (finding.field === 'gate1' || finding.field?.startsWith('gate1.')),
      );

      assert.deepEqual(gate1Blocking, []);
    });

    it('approves NOTHING else — every downstream gate stays unapproved', () => {
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        buildBrazilReceitaGate1RecordedOwnerDecisionArtifact(),
      );

      assert.equal(result.gate2Approved, false);
      assert.equal(result.gate7Approved, false);
      assert.equal(result.capInputPolicyApproved, false);
      assert.equal(result.controlledExecutionAttemptAuthorized, false);
    });

    it('keeps the whole artifact NO_GO — seven gates are still not_started', () => {
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        buildBrazilReceitaGate1RecordedOwnerDecisionArtifact(),
      );

      assert.equal(result.status, 'invalid');
      assert.equal(result.goNoGo, 'NO_GO');
      assert.equal(result.canProceedToControlledExecutionPreflight, false);
    });

    it('still carries the "validation is not authorization" disclaimer', () => {
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        buildBrazilReceitaGate1RecordedOwnerDecisionArtifact(),
      );

      assert.ok(
        result.findings.some(
          (finding) => finding.code === CODES.validationIsNotAuthorization,
        ),
      );
    });

    it('carries a gate1 section and no other section', () => {
      const artifact = buildBrazilReceitaGate1RecordedOwnerDecisionArtifact();

      assert.deepEqual(Object.keys(artifact), ['gate1']);
    });

    it('returns a fresh object per call, so a caller cannot mutate the record', () => {
      const first = buildBrazilReceitaGate1RecordedOwnerDecisionArtifact();
      const second = buildBrazilReceitaGate1RecordedOwnerDecisionArtifact();

      assert.notEqual(first, second);
      assert.notEqual(first.gate1, second.gate1);
      assert.deepEqual(first, second);
    });
  });

  describe('ordering — GATE2_CANNOT_PRECEDE_GATE1 after a real Gate-1 approval', () => {
    it('does not fire on the record alone: GATE-2 is absent, not approved-shaped', () => {
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        buildBrazilReceitaGate1RecordedOwnerDecisionArtifact(),
      );

      assert.ok(
        !result.findings.some(
          (finding) => finding.code === CODES.gate2CannotPrecedeGate1,
        ),
      );
    });

    it('Gate1 approved + Gate2 incomplete → no Gate2 GO', () => {
      const artifact: OwnerDecisionArtifact = {
        ...buildBrazilReceitaGate1RecordedOwnerDecisionArtifact(),
        gate2: {
          ...buildApprovedShapedGate2Section(),
          // One required field left on the packet placeholder: the decision says `approved`, the
          // section is incomplete, so the approval does not stand.
          evidencePacketReference:
            BRAZIL_RECEITA_OWNER_DECISION_PLACEHOLDER_TOKEN,
        },
      };

      const result = validateBrazilReceitaOwnerDecisionArtifact(artifact);

      assert.equal(result.gate1Approved, true);
      assert.equal(result.gate2Approved, false);
      assert.equal(result.goNoGo, 'NO_GO');
      // The refusal is the incomplete field, NOT a precedence violation — Gate-1 is in place.
      assert.ok(
        result.findings.some(
          (finding) =>
            finding.code === CODES.fieldPlaceholder &&
            finding.field === 'gate2.evidencePacketReference',
        ),
      );
      assert.ok(
        !result.findings.some(
          (finding) => finding.code === CODES.gate2CannotPrecedeGate1,
        ),
      );
    });

    it('Gate1 approved + Gate2 approved-shaped → GATE-2 becomes reviewable on its own merits', () => {
      const artifact: OwnerDecisionArtifact = {
        ...buildBrazilReceitaGate1RecordedOwnerDecisionArtifact(),
        gate2: buildApprovedShapedGate2Section(),
      };

      const result = validateBrazilReceitaOwnerDecisionArtifact(artifact);

      assert.equal(result.gate1Approved, true);
      assert.equal(result.gate2Approved, true);
      assert.ok(
        !result.findings.some(
          (finding) => finding.code === CODES.gate2CannotPrecedeGate1,
        ),
      );
      // Reviewable is not authorized: GATE-7, cap/input policy and the attempt are still absent.
      assert.equal(result.gate7Approved, false);
      assert.equal(result.capInputPolicyApproved, false);
      assert.equal(result.controlledExecutionAttemptAuthorized, false);
      assert.equal(result.goNoGo, 'NO_GO');
      assert.equal(result.canProceedToControlledExecutionPreflight, false);
    });

    it('GATE7_CANNOT_PRECEDE_GATE2 is still enforced under an approved Gate-1', () => {
      const artifact: OwnerDecisionArtifact = {
        ...buildBrazilReceitaGate1RecordedOwnerDecisionArtifact(),
        gate7: {
          decisionValue: 'approved',
          ownerRole: 'OWNER_ROLE_SYNTHETIC_GATE7',
          ownerReference: 'OWNER_REF_SYNTHETIC_GATE7',
          decisionDate: '2026-08-21',
          expirationOrReviewDate: '2026-09-21',
          operatorRole: 'OPERATOR_ROLE_SYNTHETIC',
          reviewerRole: 'REVIEWER_ROLE_SYNTHETIC',
          runbookReference: 'RUNBOOK_REF_SYNTHETIC',
          evidenceCaptureProcedure: 'EVIDENCE_CAPTURE_PROCEDURE_SYNTHETIC',
          sanitizerProcedure: 'SANITIZER_PROCEDURE_SYNTHETIC',
          cleanupProcedure: 'CLEANUP_PROCEDURE_SYNTHETIC',
          incidentPath: 'INCIDENT_REF_SYNTHETIC',
          escalationPath: 'ESCALATION_REF_SYNTHETIC',
          dryRunRehearsalReference: 'DRY_RUN_REHEARSAL_REF_SYNTHETIC',
          stopConditionsAccepted: true,
        },
      };

      const result = validateBrazilReceitaOwnerDecisionArtifact(artifact);

      assert.equal(result.gate1Approved, true);
      assert.ok(
        result.findings.some(
          (finding) => finding.code === CODES.gate7CannotPrecedeGate2,
        ),
      );

      // `gate7Approved` is SECTION-scoped: it reports that the gate7 section is internally
      // complete and says `approved`, and the precedence violation is carried as a separate
      // blocking finding rather than folded back into the flag. So it reads `true` here even
      // though GATE-7 is not approved in governance terms. That is the merged 13A contract for
      // both ordering rules (`gate2Approved` behaves identically under an unapproved GATE-1), and
      // it is pinned here so a change to it cannot pass unnoticed. The verdict a caller must gate
      // on is `goNoGo` / `canProceedToControlledExecutionPreflight`, never a bare section flag.
      assert.equal(result.gate7Approved, true);
      assert.equal(result.status, 'invalid');
      assert.equal(result.goNoGo, 'NO_GO');
      assert.equal(result.canProceedToControlledExecutionPreflight, false);
    });
  });

  describe('recording rules — 10K § 14', () => {
    it('records a role, never an identity', () => {
      assert.equal(BRAZIL_RECEITA_GATE1_APPROVER_ROLE, 'legal/privacy owner');
      assert.ok(!BRAZIL_RECEITA_GATE1_APPROVER_ROLE.includes('@'));
    });

    it('records the approval date', () => {
      assert.match(BRAZIL_RECEITA_GATE1_APPROVAL_DATE, /^\d{4}-\d{2}-\d{2}$/);
    });

    it('carries no forbidden content in any recorded gate1 field', () => {
      const gate1 =
        buildBrazilReceitaGate1RecordedOwnerDecisionArtifact().gate1;
      assert.ok(gate1);

      for (const value of Object.values(gate1)) {
        if (typeof value !== 'string') continue;
        for (const pattern of BRAZIL_RECEITA_OWNER_DECISION_FORBIDDEN_CONTENT_PATTERNS) {
          const carries: boolean = pattern.caseSensitive
            ? value.includes(pattern.token)
            : value.toLowerCase().includes(pattern.token.toLowerCase());
          assert.equal(
            carries,
            false,
            `recorded gate1 field carries ${pattern.token}`,
          );
        }
      }
    });

    it('completes every gate1 field 13A requires, with no placeholder left behind', () => {
      const gate1 = buildBrazilReceitaGate1RecordedOwnerDecisionArtifact()
        .gate1 as Record<string, unknown>;

      for (const field of BRAZIL_RECEITA_OWNER_DECISION_REQUIRED_STRING_FIELDS.gate1) {
        const value = gate1[field];
        assert.equal(typeof value, 'string', `${field} must be a string`);
        assert.notEqual((value as string).trim(), '');
        assert.notEqual(
          (value as string).trim(),
          BRAZIL_RECEITA_OWNER_DECISION_PLACEHOLDER_TOKEN,
        );
      }

      assert.equal(gate1.stopConditionsAccepted, true);
    });

    it('enumerates the restrictions rather than summarizing them', () => {
      for (const required of [
        'no socios file family, rejected by file-family name before any read',
        'no QSA file family, rejected by file-family name before any read',
        'no CPF, in any form, including hashed, truncated or fingerprinted',
        'no explicitly person-linked Receita file family',
        'no automatic production enablement',
        'no Supabase write and no import authorization implied by GATE-1',
        'no Agent 1 Brazil enablement implied by GATE-1',
        'no provider write implied by GATE-1',
        'downstream gates remain independently required and are not approved by this decision',
        'privacy and sanitization controls remain mandatory',
        'any downstream persistence or output must satisfy its own gates',
      ]) {
        assert.ok(
          BRAZIL_RECEITA_GATE1_RESTRICTIONS.includes(required),
          `missing enumerated restriction: ${required}`,
        );
      }
    });
  });

  describe('licence disposition — history preserved, resolution not claimed', () => {
    it('keeps the conflicting-metadata history and the owner disposition as separate facts', () => {
      assert.equal(
        BRAZIL_RECEITA_GATE1_LICENCE_METADATA_HISTORY,
        'CONFLICTING_OFFICIAL_METADATA',
      );
      assert.equal(
        BRAZIL_RECEITA_GATE1_LEGAL_PRIVACY_OWNER_DISPOSITION,
        'accepted_for_continuation_of_development',
      );
    });

    it('never claims an agent resolved which licence governs', () => {
      assert.equal(BRAZIL_RECEITA_GATE1_LICENCE_RESOLVED_BY_AGENT, false);
    });
  });

  describe('R1–R7 — the seven GATE-1 required-evidence confirmations', () => {
    it('covers exactly seven confirmations, in order', () => {
      assert.deepEqual(
        BRAZIL_RECEITA_GATE1_REQUIRED_EVIDENCE_DISPOSITION.map(
          (entry) => entry.id,
        ),
        ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'],
      );
    });

    it('records each one as accepted as part of the whole-scope decision, never more broadly', () => {
      for (const entry of BRAZIL_RECEITA_GATE1_REQUIRED_EVIDENCE_DISPOSITION) {
        assert.ok(
          entry.disposition.startsWith(
            'accepted_as_part_of_whole_scope_decision',
          ),
          `${entry.id} must not claim a broader permission than the owner supplied`,
        );
      }
    });
  });

  describe('historical executions and the attempt budget', () => {
    it('approves no prior execution retroactively and resets no budget', () => {
      assert.deepEqual(BRAZIL_RECEITA_GATE1_HISTORICAL_EXECUTION_CLAUSE, {
        retroactivelyApprovesPriorExecutions: false,
        modifiesHistoricalAuditRecord: false,
        resetsBenchmarkAttemptBudget: false,
      });
    });

    it('leaves the attempt-3 ledger constant at false and never references the ledger', () => {
      const ledger = readConnectorSource(
        'br-receita-cnpj-real-benchmark-attempt-ledger.ts',
      );
      assert.match(
        ledger,
        /BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED\s*=\s*false as const/,
      );

      // Stripped of comments first: this module DISCUSSES the ledger in prose deliberately, and
      // grepping the raw source would confuse 'cites it in a comment' with 'depends on it in code'.
      const recordBody = stripComments(
        readConnectorSource('br-receita-cnpj-gate1-recorded-owner-decision.ts'),
      );
      assert.ok(!recordBody.includes('attempt-ledger'));
      assert.ok(!recordBody.includes('ATTEMPT_3_ALLOWED'));
    });
  });

  describe('static guards — the record cannot act', () => {
    it('performs no I/O and holds no executable import', () => {
      const body = stripComments(
        readConnectorSource('br-receita-cnpj-gate1-recorded-owner-decision.ts'),
      );

      for (const forbidden of [
        'node:fs',
        'node:path',
        'node:http',
        'node:child_process',
        'process.env',
        'fetch(',
        'createClient',
        'supabase',
      ]) {
        assert.ok(
          !body.includes(forbidden),
          `record must not reference ${forbidden}`,
        );
      }

      // Every `import` in the module body must be a TYPE import.
      const imports = body.match(/^import\s[\s\S]*?from\s+['"][^'"]+['"];/gm) ?? [];
      assert.ok(imports.length > 0, 'expected at least one import to inspect');
      for (const statement of imports) {
        assert.match(
          statement,
          /^import type\s/,
          `not a type import: ${statement}`,
        );
      }
    });

    it('names no gate section other than gate1 in its artifact builder', () => {
      const record = readConnectorSource(
        'br-receita-cnpj-gate1-recorded-owner-decision.ts',
      );
      const body = stripComments(record).slice(
        stripComments(record).indexOf(
          'export function buildBrazilReceitaGate1RecordedOwnerDecisionArtifact',
        ),
      );

      for (const section of [
        'gate2:',
        'gate7:',
        'capInputPolicy:',
        'controlledExecutionAttempt:',
      ]) {
        assert.ok(
          !body.includes(section),
          `builder must not emit a ${section} section`,
        );
      }
    });
  });
});
