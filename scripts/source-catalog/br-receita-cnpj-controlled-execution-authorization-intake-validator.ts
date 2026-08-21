/**
 * BR Receita CNPJ — controlled execution authorization intake validator CLI (BR-SOURCE-13J).
 *
 * Builds a named SYNTHETIC controlled execution authorization intake, validates it against the nine
 * decisions BR-SOURCE-13I lists as pending, and prints the result as JSON or Markdown:
 *
 *   13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
 *                          →  13D request packet
 *                          →  13E review decision validation
 *                          →  13F controlled execution attempt plan
 *                          →  13G controlled execution attempt runner scaffold
 *                          →  13H controlled execution readiness report
 *                          →  13I controlled execution authorization handoff packet
 *                          →  13J controlled execution authorization intake validation
 *                          →  JSON or Markdown on stdout
 *
 * This CLI has exactly four inputs — a 13C fixture NAME, a 13E decision VALUE, a 13J intake FIXTURE and a
 * FORMAT — and it has no code path that accepts a location: there is no `--manifest`, no `--input`, no
 * `--output`, no `--path`, no `--real-data`, and no way to point it at a byte of the real dataset. It
 * also has no `--execute`, no `--run`, no `--apply`, no `--force`, no `--import`, no `--activate`, no
 * `--approve` and no `--sign`, because it has nothing to run, nothing to switch on and nothing to
 * approve or sign: it always prints a `NO_GO` result and exits. It writes to stdout only; it never
 * creates a file.
 *
 * `--sign` deserves its own note, alongside `--approve`. A completed intake is the artefact most likely
 * to be mistaken for a signed authorization — it names reviewers, dates and acceptances — so this CLI
 * refuses both flags explicitly, for the same reason it refuses `--execute`: there is no switch here that
 * turns a validated document into a granted authorization.
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   intake_complete          ≠  execution_authorized
 *   synthetic_intake_valid   ≠  gate approval
 *
 *   Authorization intake validation is not execution authorization.
 *
 * ── This CLI NEVER (fail-closed by construction) ─────────────────────────────
 *   - reads or writes a file: no filesystem module, no path module, no module-directory resolution, and
 *     no location argument of any kind.
 *   - spawns a child, opens a socket, or reads an environment variable.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - runs a join or a coverage computation.
 *   - opens a database client, writes to a database, or applies a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - approves a gate, authorizes a cap, or marks Brazil ready for the full join, import, runtime or
 *     Agent 1 — regardless of how complete the intake fixture is.
 *
 * Its only inputs are the command-line arguments; its only outputs are stdout (the result) and stderr (a
 * usage error). The result carries a STATIC timestamp, so two identical runs are byte-identical.
 *
 * Usage:
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts --fixture synthetic-ready --decision approve --intake complete_synthetic_accept --format json
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts --fixture synthetic-ready --decision approve --intake complete_synthetic_accept --format json --pretty
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts --fixture synthetic-ready --decision approve --intake complete_synthetic_accept --format markdown
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts --fixture synthetic-ready --decision approve --intake missing_gate_2 --format json
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts --fixture synthetic-ready --decision approve --intake inconsistent_import_without_full_join --format json
 */

import {
  BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES,
  BRAZIL_RECEITA_INTAKE_FORMATS,
  buildBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult,
  formatBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult,
  isBrazilReceitaIntakeFixtureName,
  isBrazilReceitaIntakeFormat,
  type BrazilReceitaControlledExecutionAuthorizationIntakeFixture,
  type BrazilReceitaControlledExecutionAuthorizationIntakeFormat,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-authorization-intake-validator';
import { isBrazilReceitaRequestPacketFixtureName } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-request-packet-generator';
import {
  BRAZIL_RECEITA_REVIEW_DECISION_VALUES,
  isBrazilReceitaReviewDecisionValue,
  type BrazilReceitaControlledExecutionReviewDecisionValue,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-review-decision-validator';
import type { BrazilReceitaSyntheticOwnerArtifactFixtureName } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Constants ───────────────────────────────────────────────────────────────

/** The only flags this CLI accepts. */
export const ALLOWED_FLAGS = ['--fixture', '--decision', '--intake', '--format', '--pretty'] as const;

/**
 * Flags that would turn this into a real-data, an executing, an activating or an APPROVING/SIGNING tool.
 * Their mere presence is a fail-closed usage error — this validator builds a synthetic intake and reports
 * a `NO_GO` result and nothing else: it accepts no path, no payload, no manifest and no real-data mode, it
 * has no run, execute, apply, import or activate behaviour to reach, and it cannot approve, authorize or
 * sign any of the nine decisions the intake it validates describes.
 */
export const FORBIDDEN_FLAGS = [
  '--manifest',
  '--input',
  '--input-dir',
  '--output',
  '--output-dir',
  '--path',
  '--dir',
  '--file',
  '--csv',
  '--zip',
  '--real-data',
  '--execute',
  '--run',
  '--apply',
  '--force',
  '--import',
  '--activate',
  '--approve',
  '--authorize',
  '--sign',
  '--gate2',
  '--gate7',
  '--supabase',
  '--production',
  '--runtime',
  '--agent1',
] as const;

/** Usage error codes, so a caller can branch on the reason instead of parsing prose. */
export const INTAKE_USAGE_ERROR_CODES = {
  forbiddenFlag: 'BRSOURCE13J_FORBIDDEN_ARGUMENT',
  unknownFlag: 'BRSOURCE13J_UNKNOWN_ARGUMENT',
  fixtureMissing: 'BRSOURCE13J_FIXTURE_REQUIRED',
  fixtureUnknown: 'BRSOURCE13J_FIXTURE_UNKNOWN',
  decisionMissing: 'BRSOURCE13J_DECISION_REQUIRED',
  decisionUnknown: 'BRSOURCE13J_DECISION_UNKNOWN',
  intakeMissing: 'BRSOURCE13J_INTAKE_REQUIRED',
  intakeUnknown: 'BRSOURCE13J_INTAKE_UNKNOWN',
  formatMissing: 'BRSOURCE13J_FORMAT_REQUIRED',
  formatUnknown: 'BRSOURCE13J_FORMAT_UNKNOWN',
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type IntakeCliOptions = {
  readonly fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly decision: BrazilReceitaControlledExecutionReviewDecisionValue;
  readonly intake: BrazilReceitaControlledExecutionAuthorizationIntakeFixture;
  readonly format: BrazilReceitaControlledExecutionAuthorizationIntakeFormat;
  readonly pretty: boolean;
};

/** A usage error carrying its own code, so `main` never has to classify a message. */
export class IntakeUsageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'IntakeUsageError';
    this.code = code;
  }
}

// ─── Argument parsing ────────────────────────────────────────────────────────

/** Renders each accepted-value list once, for every usage message that needs it. */
function fixtureList(): string {
  return 'a BR-SOURCE-13C synthetic fixture name';
}

function decisionList(): string {
  return BRAZIL_RECEITA_REVIEW_DECISION_VALUES.join('|');
}

function intakeList(): string {
  return BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES.join(', ');
}

function formatList(): string {
  return BRAZIL_RECEITA_INTAKE_FORMATS.join('|');
}

/**
 * Reads the value of a `--flag value` or `--flag=value` pair, or `undefined` when the flag was given
 * without one. Returns the index to continue parsing from.
 */
function readValue(
  argv: readonly string[],
  index: number,
  inlineValue: string | undefined,
): { readonly value: string | undefined; readonly nextIndex: number } {
  if (inlineValue !== undefined) return { value: inlineValue, nextIndex: index };

  const next = argv[index + 1];
  if (next === undefined || next.startsWith('--')) return { value: undefined, nextIndex: index + 1 };

  return { value: next, nextIndex: index + 1 };
}

/**
 * Parses `--fixture <name>`, `--decision <approve|reject|defer>`, `--intake <name>`,
 * `--format <json|markdown>` and the optional `--pretty`. Everything else is rejected: a forbidden flag
 * first (with the reason it can never be supported), then any unrecognized argument, positionals
 * included.
 *
 * @throws IntakeUsageError on any input this CLI does not accept.
 */
export function parseIntakeArgs(argv: readonly string[]): IntakeCliOptions {
  let fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName | undefined;
  let decision: BrazilReceitaControlledExecutionReviewDecisionValue | undefined;
  let intake: BrazilReceitaControlledExecutionAuthorizationIntakeFixture | undefined;
  let format: BrazilReceitaControlledExecutionAuthorizationIntakeFormat | undefined;
  let pretty = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    // `--flag=value` is normalized so a forbidden flag cannot slip through in that form.
    const equalsAt = arg.indexOf('=');
    const flag = equalsAt === -1 ? arg : arg.slice(0, equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : arg.slice(equalsAt + 1);

    if ((FORBIDDEN_FLAGS as readonly string[]).includes(flag)) {
      throw new IntakeUsageError(
        INTAKE_USAGE_ERROR_CODES.forbiddenFlag,
        `${flag} is not supported and never will be. This intake validator builds a synthetic intake and reports a NO_GO result only: it accepts no path, no payload, no manifest and no real-data mode, it cannot run, execute, apply, import, activate or force anything, it cannot approve, authorize or sign any of the nine decisions the intake describes, and it writes to stdout only. Accepted flags: ${ALLOWED_FLAGS.join(', ')}.`,
      );
    }

    if (flag === '--pretty') {
      pretty = true;
      continue;
    }

    if (flag === '--fixture') {
      const read = readValue(argv, index, inlineValue);
      index = read.nextIndex;

      if (read.value === undefined) {
        throw new IntakeUsageError(
          INTAKE_USAGE_ERROR_CODES.fixtureMissing,
          `--fixture requires a fixture name. Known fixtures: ${fixtureList()}.`,
        );
      }

      if (!isBrazilReceitaRequestPacketFixtureName(read.value)) {
        throw new IntakeUsageError(
          INTAKE_USAGE_ERROR_CODES.fixtureUnknown,
          `unknown fixture "${read.value}". Known fixtures: ${fixtureList()}.`,
        );
      }

      fixture = read.value;
      continue;
    }

    if (flag === '--decision') {
      const read = readValue(argv, index, inlineValue);
      index = read.nextIndex;

      if (read.value === undefined) {
        throw new IntakeUsageError(
          INTAKE_USAGE_ERROR_CODES.decisionMissing,
          `--decision requires a decision value. Accepted decisions: ${decisionList()}.`,
        );
      }

      if (!isBrazilReceitaReviewDecisionValue(read.value)) {
        throw new IntakeUsageError(
          INTAKE_USAGE_ERROR_CODES.decisionUnknown,
          `unknown decision "${read.value}". Accepted decisions: ${decisionList()}.`,
        );
      }

      decision = read.value;
      continue;
    }

    if (flag === '--intake') {
      const read = readValue(argv, index, inlineValue);
      index = read.nextIndex;

      if (read.value === undefined) {
        throw new IntakeUsageError(
          INTAKE_USAGE_ERROR_CODES.intakeMissing,
          `--intake requires an intake fixture name. Known intake fixtures: ${intakeList()}.`,
        );
      }

      if (!isBrazilReceitaIntakeFixtureName(read.value)) {
        throw new IntakeUsageError(
          INTAKE_USAGE_ERROR_CODES.intakeUnknown,
          `unknown intake fixture "${read.value}". Known intake fixtures: ${intakeList()}.`,
        );
      }

      intake = read.value;
      continue;
    }

    if (flag === '--format') {
      const read = readValue(argv, index, inlineValue);
      index = read.nextIndex;

      if (read.value === undefined) {
        throw new IntakeUsageError(
          INTAKE_USAGE_ERROR_CODES.formatMissing,
          `--format requires a format. Accepted formats: ${formatList()}.`,
        );
      }

      if (!isBrazilReceitaIntakeFormat(read.value)) {
        throw new IntakeUsageError(
          INTAKE_USAGE_ERROR_CODES.formatUnknown,
          `unknown format "${read.value}". Accepted formats: ${formatList()}.`,
        );
      }

      format = read.value;
      continue;
    }

    throw new IntakeUsageError(
      INTAKE_USAGE_ERROR_CODES.unknownFlag,
      `unrecognized argument "${arg}". Accepted flags: ${ALLOWED_FLAGS.join(', ')}.`,
    );
  }

  if (fixture === undefined) {
    throw new IntakeUsageError(
      INTAKE_USAGE_ERROR_CODES.fixtureMissing,
      `--fixture is required. Known fixtures: ${fixtureList()}.`,
    );
  }

  if (decision === undefined) {
    throw new IntakeUsageError(
      INTAKE_USAGE_ERROR_CODES.decisionMissing,
      `--decision is required. Accepted decisions: ${decisionList()}.`,
    );
  }

  if (intake === undefined) {
    throw new IntakeUsageError(
      INTAKE_USAGE_ERROR_CODES.intakeMissing,
      `--intake is required. Known intake fixtures: ${intakeList()}.`,
    );
  }

  if (format === undefined) {
    throw new IntakeUsageError(
      INTAKE_USAGE_ERROR_CODES.formatMissing,
      `--format is required. Accepted formats: ${formatList()}.`,
    );
  }

  return { fixture, decision, intake, format, pretty };
}

// ─── main ────────────────────────────────────────────────────────────────────

/**
 * Exit code 0 means a result was produced — and every result is `NO_GO`, because a refusal to declare an
 * authorization is the correct outcome for this tool, whatever the intake's own completeness status is. A
 * `NO_GO` result is not an error, so it is never reported as one. Exit code 1 means the ARGUMENTS were
 * unusable and nothing was produced.
 */
export function main(argv: readonly string[] = process.argv.slice(2)): void {
  let options: IntakeCliOptions;
  try {
    options = parseIntakeArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  const result = buildBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult({
    fixtureName: options.fixture,
    reviewDecisionValue: options.decision,
    intakeFixture: options.intake,
  });
  const rendered = formatBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult(
    result,
    options.format,
    options.pretty,
  );

  process.stdout.write(`${rendered}\n`);
}

// Only auto-run when executed directly, never when imported by the test file (whose path ends with
// ".test.ts", not with this filename).
const executedFile = process.argv[1] ?? '';
if (executedFile.endsWith('br-receita-cnpj-controlled-execution-authorization-intake-validator.ts')) {
  main();
}
