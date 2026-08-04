/**
 * BR Receita CNPJ — owner decision artifact validator — tests (BR-SOURCE-13A).
 *
 * The load-bearing property is fail-closed: every path that is not a fully completed, internally
 * consistent, content-safe artifact must end in `invalid` / `NO_GO` with
 * `canProceedToControlledExecutionPreflight === false`. Exactly ONE fixture in this file reaches
 * `valid` / `GO`, and it is 100% synthetic — no real path, no real cap number, no address, no URL,
 * no token, no CNPJ or CPF.
 *
 * 100% offline. No dataset, no manifest, no CSV, no ZIP, no row, no Supabase, no network, no
 * runtime, no provider. The only file I/O is reading this repository's OWN validator source for the
 * static no-I/O guard at the end. Forbidden-content fixtures assemble their tokens by
 * CONCATENATION, so no path-shaped or credential-shaped literal exists in this source file.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_OWNER_DECISION_FINDING_CODES as CODES,
  BRAZIL_RECEITA_OWNER_DECISION_PLACEHOLDER_TOKEN,
  BRAZIL_RECEITA_OWNER_DECISION_REQUIRED_STRING_FIELDS,
  validateBrazilReceitaOwnerDecisionArtifact,
  type OwnerDecisionArtifact,
  type OwnerDecisionValidationResult,
} from '../br-receita-cnpj-owner-decision-validator';

// ─── Synthetic fixtures ───────────────────────────────────────────────────────

/**
 * The one artifact in this file that is allowed to pass. Every reference is an opaque synthetic
 * label; the only digits live in the two date fields, which no rule forbids.
 */
function buildSyntheticCompleteArtifact(): OwnerDecisionArtifact {
  return {
    gate2: {
      decisionValue: 'approved',
      ownerRole: 'OWNER_ROLE_SYNTHETIC_GATE2',
      ownerReference: 'OWNER_REF_SYNTHETIC_GATE2',
      decisionDate: '2026-08-04',
      expirationOrReviewDate: '2026-11-04',
      evidencePacketReference: 'EVIDENCE_REF_SYNTHETIC_PACKET',
      legalPrivacySecurityReference: 'LEGAL_REF_SYNTHETIC_PRIVACY_SECURITY',
      operatorReviewerRequirement: 'OPERATOR_REVIEWER_REQUIREMENT_SYNTHETIC',
      incidentEscalationReference: 'INCIDENT_REF_SYNTHETIC',
      stopConditionsAccepted: true,
    },
    gate7: {
      decisionValue: 'approved',
      ownerRole: 'OWNER_ROLE_SYNTHETIC_GATE7',
      ownerReference: 'OWNER_REF_SYNTHETIC_GATE7',
      decisionDate: '2026-08-04',
      expirationOrReviewDate: '2026-11-04',
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
    capInputPolicy: {
      decisionValue: 'approved',
      ownerRole: 'OWNER_ROLE_SYNTHETIC_CAP_INPUT',
      ownerReference: 'OWNER_REF_SYNTHETIC_CAP_INPUT',
      decisionDate: '2026-08-04',
      expirationOrReviewDate: '2026-11-04',
      capMaximaDecision: 'CAP_POLICY_SYNTHETIC_APPROVED_WITHOUT_NUMERIC_VALUES',
      inputRootDecision: 'INPUT_ROOT_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      outputRootDecision: 'OUTPUT_ROOT_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      tempStorageDecision: 'TEMP_STORAGE_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      evidenceBucketDecision: 'EVIDENCE_BUCKET_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      familyAllowDenyDecision: 'FAMILY_ALLOW_DENY_SYNTHETIC',
      manifestControlFilePolicyDecision: 'MANIFEST_CONTROL_FILE_POLICY_SYNTHETIC',
      exactPercentagePolicyDecision: 'EXACT_PERCENTAGE_POLICY_SYNTHETIC_FORBIDDEN',
      fullDatasetDenominatorPolicyDecision: 'FULL_DATASET_DENOMINATOR_POLICY_SYNTHETIC_FORBIDDEN',
      coverageLanguageDecision: 'COVERAGE_LANGUAGE_SYNTHETIC_QUALITATIVE_ONLY',
      legalPrivacySecurityReference: 'LEGAL_REF_SYNTHETIC_PRIVACY_SECURITY',
      stopConditionsAccepted: true,
    },
    controlledExecutionAttempt: {
      authorizationDecision: 'approved',
      ownerRole: 'OWNER_ROLE_SYNTHETIC_CONTROLLED',
      ownerReference: 'OWNER_REF_SYNTHETIC_CONTROLLED',
      decisionDate: '2026-08-04',
      expirationOrReviewDate: '2026-11-04',
      scopeBoundary: 'SCOPE_BOUNDARY_SYNTHETIC_DOCUMENT_PREFLIGHT_ONLY',
      stopConditionsAccepted: true,
    },
  };
}

type SectionKey = keyof typeof BRAZIL_RECEITA_OWNER_DECISION_REQUIRED_STRING_FIELDS;

const SECTION_KEYS: readonly SectionKey[] = [
  'gate2',
  'gate7',
  'capInputPolicy',
  'controlledExecutionAttempt',
];

/** Returns a copy of the complete artifact with one section patched. Never mutates the original. */
function withSection(section: SectionKey, patch: Record<string, unknown>): OwnerDecisionArtifact {
  const base = buildSyntheticCompleteArtifact();
  return {
    ...base,
    [section]: { ...(base[section] as Record<string, unknown>), ...patch },
  } as OwnerDecisionArtifact;
}

/** Returns a copy of the complete artifact with one required field removed. */
function withoutField(section: SectionKey, field: string): OwnerDecisionArtifact {
  const base = buildSyntheticCompleteArtifact();
  const remaining = Object.fromEntries(
    Object.entries(base[section] as Record<string, unknown>).filter(([key]) => key !== field),
  );
  return { ...base, [section]: remaining } as OwnerDecisionArtifact;
}

function codesOf(result: OwnerDecisionValidationResult): readonly string[] {
  return result.findings.map((finding) => finding.code);
}

function blockingOf(result: OwnerDecisionValidationResult): readonly string[] {
  return result.findings.filter((f) => f.severity === 'blocking').map((f) => f.code);
}

/** Asserts the shape every refusal must share. */
function assertRefused(result: OwnerDecisionValidationResult): void {
  assert.equal(result.status, 'invalid');
  assert.equal(result.goNoGo, 'NO_GO');
  assert.equal(result.canProceedToControlledExecutionPreflight, false);
  assert.ok(blockingOf(result).length > 0, 'a refusal must carry at least one blocking finding');
}

// ─── Absent artifact ──────────────────────────────────────────────────────────

describe('BR-SOURCE-13A owner decision validator — absent artifact', () => {
  it('refuses a null artifact', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(null);
    assertRefused(result);
    assert.ok(codesOf(result).includes(CODES.artifactMissing));
    assert.equal(result.gate2Approved, false);
    assert.equal(result.gate7Approved, false);
    assert.equal(result.capInputPolicyApproved, false);
    assert.equal(result.controlledExecutionAttemptAuthorized, false);
  });

  it('refuses an undefined artifact', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(undefined);
    assertRefused(result);
    assert.ok(codesOf(result).includes(CODES.artifactMissing));
  });

  it('refuses an empty object with one missing-decision finding per section', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact({});
    assertRefused(result);
    const missing = result.findings.filter((f) => f.code === CODES.decisionMissing);
    assert.equal(missing.length, SECTION_KEYS.length);
    for (const section of SECTION_KEYS) {
      assert.ok(
        missing.some((finding) => finding.field === section),
        `expected a missing-decision finding for ${section}`,
      );
    }
  });
});

// ─── Placeholders and whitespace ──────────────────────────────────────────────

describe('BR-SOURCE-13A owner decision validator — placeholders', () => {
  it('refuses an artifact whose every field still reads the owner placeholder', () => {
    const placeholder = BRAZIL_RECEITA_OWNER_DECISION_PLACEHOLDER_TOKEN;
    const artifact = {
      gate2: {
        decisionValue: placeholder,
        ownerRole: placeholder,
        ownerReference: placeholder,
        decisionDate: placeholder,
        expirationOrReviewDate: placeholder,
        evidencePacketReference: placeholder,
        legalPrivacySecurityReference: placeholder,
        operatorReviewerRequirement: placeholder,
        incidentEscalationReference: placeholder,
        stopConditionsAccepted: placeholder,
      },
      gate7: { decisionValue: placeholder, ownerRole: placeholder },
      capInputPolicy: { decisionValue: placeholder, capMaximaDecision: placeholder },
      controlledExecutionAttempt: { authorizationDecision: placeholder },
    } as unknown as OwnerDecisionArtifact;

    const result = validateBrazilReceitaOwnerDecisionArtifact(artifact);
    assertRefused(result);
    const placeholderFindings = result.findings.filter((f) => f.code === CODES.fieldPlaceholder);
    assert.ok(placeholderFindings.length >= 10);
    assert.ok(
      placeholderFindings.some((f) => f.field === 'gate2.legalPrivacySecurityReference'),
      'placeholder must be reported per field',
    );
  });

  it('refuses whitespace-only strings as never completed', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      withSection('gate2', { ownerReference: '   ', evidencePacketReference: '\t\n ' }),
    );
    assertRefused(result);
    const fields = result.findings
      .filter((f) => f.code === CODES.fieldPlaceholder)
      .map((f) => f.field);
    assert.deepEqual(
      [...fields].sort(),
      ['gate2.evidencePacketReference', 'gate2.ownerReference'],
    );
  });

  it('refuses an empty string in a required field', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      withSection('gate7', { runbookReference: '' }),
    );
    assertRefused(result);
    assert.ok(
      result.findings.some(
        (f) => f.code === CODES.fieldPlaceholder && f.field === 'gate7.runbookReference',
      ),
    );
  });
});

// ─── Required fields ──────────────────────────────────────────────────────────

describe('BR-SOURCE-13A owner decision validator — required fields', () => {
  it('refuses GATE-2 approved without a legal/privacy/security reference', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      withoutField('gate2', 'legalPrivacySecurityReference'),
    );
    assertRefused(result);
    assert.equal(result.gate2Approved, false);
    assert.ok(
      result.findings.some(
        (f) =>
          f.code === CODES.requiredFieldMissing &&
          f.field === 'gate2.legalPrivacySecurityReference',
      ),
    );
  });

  it('refuses every single-field omission across every section', () => {
    for (const section of SECTION_KEYS) {
      for (const field of BRAZIL_RECEITA_OWNER_DECISION_REQUIRED_STRING_FIELDS[section]) {
        const result = validateBrazilReceitaOwnerDecisionArtifact(withoutField(section, field));
        assertRefused(result);
        assert.ok(
          result.findings.some(
            (f) => f.code === CODES.requiredFieldMissing && f.field === `${section}.${field}`,
          ),
          `omitting ${section}.${field} must be reported`,
        );
      }
    }
  });

  it('refuses an absent or unaccepted stop-conditions acknowledgement', () => {
    const absent = validateBrazilReceitaOwnerDecisionArtifact(
      withoutField('gate7', 'stopConditionsAccepted'),
    );
    assertRefused(absent);
    assert.ok(
      absent.findings.some(
        (f) =>
          f.code === CODES.requiredFieldMissing && f.field === 'gate7.stopConditionsAccepted',
      ),
    );

    const refused = validateBrazilReceitaOwnerDecisionArtifact(
      withSection('gate7', { stopConditionsAccepted: false }),
    );
    assertRefused(refused);
    assert.ok(blockingOf(refused).includes(CODES.stopConditionsNotAccepted));
  });
});

// ─── Decision values ──────────────────────────────────────────────────────────

describe('BR-SOURCE-13A owner decision validator — decision values', () => {
  it('refuses a rejected decision in any section', () => {
    for (const section of SECTION_KEYS) {
      const field = section === 'controlledExecutionAttempt' ? 'authorizationDecision' : 'decisionValue';
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        withSection(section, { [field]: 'rejected' }),
      );
      assertRefused(result);
      assert.ok(
        blockingOf(result).includes(CODES.decisionRejected),
        `a rejected decision in ${section} must block`,
      );
    }
  });

  it('refuses a deferred decision in any section', () => {
    for (const section of SECTION_KEYS) {
      const field = section === 'controlledExecutionAttempt' ? 'authorizationDecision' : 'decisionValue';
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        withSection(section, { [field]: 'deferred' }),
      );
      assertRefused(result);
      assert.ok(
        blockingOf(result).includes(CODES.decisionDeferred),
        `a deferred decision in ${section} must block`,
      );
    }
  });

  it('refuses an unrecognized decision value', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      withSection('gate2', { decisionValue: 'approved_with_conditions' }),
    );
    assertRefused(result);
    assert.ok(blockingOf(result).includes(CODES.decisionValueUnrecognized));
  });
});

// ─── Ordering rules ───────────────────────────────────────────────────────────

describe('BR-SOURCE-13A owner decision validator — ordering rules', () => {
  it('refuses GATE-7 approved while GATE-2 is absent', () => {
    const base = buildSyntheticCompleteArtifact();
    const withoutGate2: OwnerDecisionArtifact = {
      gate7: base.gate7,
      capInputPolicy: base.capInputPolicy,
      controlledExecutionAttempt: base.controlledExecutionAttempt,
    };
    const result = validateBrazilReceitaOwnerDecisionArtifact(withoutGate2);
    assertRefused(result);
    assert.equal(result.gate2Approved, false);
    assert.equal(result.gate7Approved, true, 'GATE-7 is internally complete in this fixture');
    assert.ok(blockingOf(result).includes(CODES.gate7CannotPrecedeGate2));
    assert.ok(blockingOf(result).includes(CODES.decisionMissing));
  });

  it('refuses a controlled execution attempt authorized without all three prerequisites', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      withSection('gate7', { decisionValue: 'deferred' }),
    );
    assertRefused(result);
    assert.equal(result.gate7Approved, false);
    assert.equal(result.controlledExecutionAttemptAuthorized, true);
    assert.equal(result.canProceedToControlledExecutionPreflight, false);
    assert.ok(blockingOf(result).includes(CODES.controlledExecutionWithoutGates));
  });

  it('never reports preflight readiness when any prerequisite section is incomplete', () => {
    for (const section of SECTION_KEYS) {
      const field = section === 'controlledExecutionAttempt' ? 'authorizationDecision' : 'decisionValue';
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        withSection(section, { [field]: 'deferred' }),
      );
      assert.equal(result.canProceedToControlledExecutionPreflight, false);
    }
  });
});

// ─── Cap maxima ───────────────────────────────────────────────────────────────

describe('BR-SOURCE-13A owner decision validator — cap maxima', () => {
  it('refuses a numeric cap maxima value', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      withSection('capInputPolicy', {
        capMaximaDecision: 'CAP_MAXIMA_SYNTHETIC_ROWS_' + '25',
      }),
    );
    assertRefused(result);
    assert.equal(result.capInputPolicyApproved, false);
    assert.ok(
      result.findings.some(
        (f) =>
          f.code === CODES.capMaximaRealValue && f.field === 'capInputPolicy.capMaximaDecision',
      ),
    );
  });

  it('accepts a cap policy statement that carries no digits', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(buildSyntheticCompleteArtifact());
    assert.equal(
      result.findings.some((f) => f.code === CODES.capMaximaRealValue),
      false,
    );
  });
});

// ─── Forbidden content ────────────────────────────────────────────────────────

describe('BR-SOURCE-13A owner decision validator — forbidden content', () => {
  it('refuses an absolute local path', () => {
    const forbidden = '/' + 'Users' + '/' + 'synthetic';
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      withSection('capInputPolicy', { inputRootDecision: forbidden }),
    );
    assertRefused(result);
    assert.ok(
      result.findings.some(
        (f) =>
          f.code === CODES.fieldForbiddenContent &&
          f.field === 'capInputPolicy.inputRootDecision',
      ),
    );
  });

  it('refuses a local download directory reference', () => {
    const forbidden = 'Down' + 'loads';
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      withSection('capInputPolicy', { outputRootDecision: forbidden }),
    );
    assertRefused(result);
    assert.ok(blockingOf(result).includes(CODES.fieldForbiddenContent));
  });

  it('refuses a real manifest file name', () => {
    const forbidden = 'manifest' + '.headerless' + '.json';
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      withSection('capInputPolicy', { manifestControlFilePolicyDecision: forbidden }),
    );
    assertRefused(result);
    assert.ok(
      result.findings.some(
        (f) =>
          f.code === CODES.fieldForbiddenContent &&
          f.field === 'capInputPolicy.manifestControlFilePolicyDecision',
      ),
    );
  });

  it('refuses real dataset subtree references', () => {
    for (const forbidden of ['sellup' + '-source-data', 'raw' + '-zips', 'extra' + 'cted', 'manifest' + '-input']) {
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        withSection('capInputPolicy', { tempStorageDecision: forbidden }),
      );
      assertRefused(result);
      assert.ok(
        blockingOf(result).includes(CODES.fieldForbiddenContent),
        `dataset subtree reference must block`,
      );
    }
  });

  it('refuses a privileged database role or env var name', () => {
    for (const forbidden of ['ROLE_' + 'service' + '_role', 'ENV_' + 'SUPABASE' + '_SERVICE_KEY']) {
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        withSection('gate2', { ownerReference: forbidden }),
      );
      assertRefused(result);
      assert.ok(blockingOf(result).includes(CODES.fieldForbiddenContent));
    }
  });

  it('refuses credential-shaped values', () => {
    const forbidden = ['ey' + 'J' + 'synthetic', 's' + 'k-' + 'synthetic', 'xox' + 'b-' + 'synthetic'];
    for (const value of forbidden) {
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        withSection('gate7', { runbookReference: value }),
      );
      assertRefused(result);
      assert.ok(blockingOf(result).includes(CODES.fieldForbiddenContent));
    }
  });

  it('refuses a private key block and a database connection string', () => {
    for (const value of ['BEGIN ' + 'PRIVATE KEY', 'postgres' + '://host']) {
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        withSection('gate7', { escalationPath: value }),
      );
      assertRefused(result);
      assert.ok(blockingOf(result).includes(CODES.fieldForbiddenContent));
    }
  });

  it('refuses address-shaped and personal-profile values', () => {
    for (const value of ['owner' + '@' + 'synthetic.invalid', 'linked' + 'in.com/in/synthetic']) {
      const result = validateBrazilReceitaOwnerDecisionArtifact(
        withSection('gate2', { operatorReviewerRequirement: value }),
      );
      assertRefused(result);
      assert.ok(blockingOf(result).includes(CODES.fieldForbiddenContent));
    }
  });

  it('leaves date-looking strings alone', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      withSection('gate2', { decisionDate: '2026-12-31', expirationOrReviewDate: '2027-06-30' }),
    );
    assert.equal(result.status, 'valid');
    assert.equal(result.gate2Approved, true);
  });
});

// ─── The one passing fixture ──────────────────────────────────────────────────

describe('BR-SOURCE-13A owner decision validator — synthetic complete artifact', () => {
  it('accepts a fully completed synthetic artifact and reports preflight readiness', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(buildSyntheticCompleteArtifact());
    assert.equal(result.status, 'valid');
    assert.equal(result.goNoGo, 'GO');
    assert.equal(result.canProceedToControlledExecutionPreflight, true);
    assert.equal(result.gate2Approved, true);
    assert.equal(result.gate7Approved, true);
    assert.equal(result.capInputPolicyApproved, true);
    assert.equal(result.controlledExecutionAttemptAuthorized, true);
    assert.deepEqual(blockingOf(result), []);
  });

  it('still states that validation is not an execution authorization', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(buildSyntheticCompleteArtifact());
    const disclaimer = result.findings.find(
      (f) => f.code === CODES.validationIsNotAuthorization,
    );
    assert.ok(disclaimer, 'a GO verdict must carry the not-an-authorization note');
    assert.equal(disclaimer?.severity, 'info');
  });

  it('is pure: it neither mutates nor reads beyond the artifact', () => {
    const artifact = buildSyntheticCompleteArtifact();
    const before = JSON.stringify(artifact);
    Object.freeze(artifact);
    for (const section of SECTION_KEYS) Object.freeze(artifact[section]);

    const first = validateBrazilReceitaOwnerDecisionArtifact(artifact);
    const second = validateBrazilReceitaOwnerDecisionArtifact(artifact);

    assert.equal(JSON.stringify(artifact), before, 'the input must not be mutated');
    assert.deepEqual(first, second, 'the same input must produce the same result');
  });
});

// ─── Static no-I/O guard ──────────────────────────────────────────────────────

describe('BR-SOURCE-13A owner decision validator — static guards', () => {
  it('imports nothing that could perform I/O', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'br-receita-cnpj-owner-decision-validator.ts'),
      'utf8',
    );

    const forbiddenImports = [
      'node:fs',
      'node:path',
      'node:http',
      'node:https',
      'node:child_process',
      'node:crypto',
      '@supabase/',
      'process.env',
      'fetch(',
    ];

    for (const token of forbiddenImports) {
      assert.equal(
        source.includes(token),
        false,
        `the validator must not reference ${token}: it is a pure function`,
      );
    }

    assert.equal(/^import\s/m.test(source), false, 'the validator must have no imports at all');
  });
});
