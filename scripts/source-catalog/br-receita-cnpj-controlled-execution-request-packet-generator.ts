/**
 * BR Receita CNPJ — controlled execution request packet generator CLI (BR-SOURCE-13D).
 *
 * Prints the controlled execution attempt review request packet for a named SYNTHETIC fixture:
 *
 *   13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
 *                          →  13D request packet
 *                          →  JSON or Markdown on stdout
 *
 * The packet is the artefact a human reviewer is asked to read. This CLI has exactly two inputs — a
 * fixture NAME and a FORMAT — and it has no code path that accepts a location: there is no
 * `--manifest`, no `--input`, no `--output`, no `--path`, and no way to point it at a byte of the real
 * dataset. It writes to stdout only; it never creates a file.
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   A packet may say "ready_for_review".
 *   A packet may NEVER say "ready to execute".
 *
 *   Ready for review is not ready for execution.
 *
 * ── This CLI NEVER (fail-closed by construction) ─────────────────────────────
 *   - reads or writes a file: no fs, no path module, no module-directory resolution, and no location
 *     argument of any kind.
 *   - spawns a process, opens a socket, or reads an environment variable.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - executes a join or a coverage computation.
 *   - opens a Supabase client, writes to a database, or runs a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - approves a gate, authorizes a cap, or marks Brazil ready.
 *
 * Its only inputs are `process.argv`; its only outputs are stdout (the packet) and stderr (a usage
 * error). The packet carries a STATIC timestamp, so two runs of the same fixture are byte-identical.
 *
 * Usage:
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-request-packet-generator.ts --fixture synthetic-ready --format json
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-request-packet-generator.ts --fixture synthetic-ready --format json --pretty
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-request-packet-generator.ts --fixture synthetic-ready --format markdown
 */

import {
  BRAZIL_RECEITA_REQUEST_PACKET_FIXTURE_NAMES,
  BRAZIL_RECEITA_REQUEST_PACKET_FORMATS,
  buildBrazilReceitaControlledExecutionRequestPacket,
  formatBrazilReceitaControlledExecutionRequestPacket,
  isBrazilReceitaRequestPacketFixtureName,
  isBrazilReceitaRequestPacketFormat,
  type BrazilReceitaRequestPacketFormat,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-request-packet-generator';
import type { BrazilReceitaSyntheticOwnerArtifactFixtureName } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Constants ───────────────────────────────────────────────────────────────

/** The only flags this CLI accepts. */
export const ALLOWED_FLAGS = ['--fixture', '--format', '--pretty'] as const;

/**
 * Flags that would turn this into a real-data tool. Their mere presence is a fail-closed usage
 * error — this generator has NO code path for a location, a payload, or a real-data run.
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
  '--import',
  '--supabase',
  '--production',
  '--runtime',
  '--agent1',
] as const;

/** Usage error codes, so a caller can branch on the reason instead of parsing prose. */
export const GENERATOR_USAGE_ERROR_CODES = {
  forbiddenFlag: 'BRSOURCE13D_FORBIDDEN_ARGUMENT',
  unknownFlag: 'BRSOURCE13D_UNKNOWN_ARGUMENT',
  fixtureMissing: 'BRSOURCE13D_FIXTURE_REQUIRED',
  fixtureUnknown: 'BRSOURCE13D_FIXTURE_UNKNOWN',
  formatMissing: 'BRSOURCE13D_FORMAT_REQUIRED',
  formatUnknown: 'BRSOURCE13D_FORMAT_UNKNOWN',
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type GeneratorCliOptions = {
  readonly fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly format: BrazilReceitaRequestPacketFormat;
  readonly pretty: boolean;
};

/** A usage error carrying its own code, so `main` never has to classify a message. */
export class GeneratorUsageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'GeneratorUsageError';
    this.code = code;
  }
}

// ─── Argument parsing ────────────────────────────────────────────────────────

/** Renders the fixture list once, for every usage message that needs it. */
function fixtureList(): string {
  return BRAZIL_RECEITA_REQUEST_PACKET_FIXTURE_NAMES.join(', ');
}

/** Renders the format list once, for the same reason. */
function formatList(): string {
  return BRAZIL_RECEITA_REQUEST_PACKET_FORMATS.join('|');
}

/**
 * Parses `--fixture <name>`, `--format <json|markdown>` and the optional `--pretty`. Everything else
 * is rejected: a forbidden flag first (with the reason it can never be supported), then any
 * unrecognized argument.
 *
 * @throws GeneratorUsageError on any input this CLI does not accept.
 */
export function parseGeneratorArgs(argv: readonly string[]): GeneratorCliOptions {
  let fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName | undefined;
  let format: BrazilReceitaRequestPacketFormat | undefined;
  let pretty = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    // `--flag=value` is normalized so a forbidden flag cannot slip through in that form.
    const equalsAt = arg.indexOf('=');
    const flag = equalsAt === -1 ? arg : arg.slice(0, equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : arg.slice(equalsAt + 1);

    if ((FORBIDDEN_FLAGS as readonly string[]).includes(flag)) {
      throw new GeneratorUsageError(
        GENERATOR_USAGE_ERROR_CODES.forbiddenFlag,
        `${flag} is not supported and never will be. This generator builds synthetic packets only: it accepts no path, no payload, no manifest and no real-data mode, and it writes to stdout only. Accepted flags: ${ALLOWED_FLAGS.join(', ')}.`,
      );
    }

    if (flag === '--pretty') {
      pretty = true;
      continue;
    }

    if (flag === '--fixture') {
      const value = inlineValue ?? argv[index + 1];
      if (inlineValue === undefined) index += 1;

      if (value === undefined || value.startsWith('--')) {
        throw new GeneratorUsageError(
          GENERATOR_USAGE_ERROR_CODES.fixtureMissing,
          `--fixture requires a fixture name. Known fixtures: ${fixtureList()}.`,
        );
      }

      if (!isBrazilReceitaRequestPacketFixtureName(value)) {
        throw new GeneratorUsageError(
          GENERATOR_USAGE_ERROR_CODES.fixtureUnknown,
          `unknown fixture "${value}". Known fixtures: ${fixtureList()}.`,
        );
      }

      fixture = value;
      continue;
    }

    if (flag === '--format') {
      const value = inlineValue ?? argv[index + 1];
      if (inlineValue === undefined) index += 1;

      if (value === undefined || value.startsWith('--')) {
        throw new GeneratorUsageError(
          GENERATOR_USAGE_ERROR_CODES.formatMissing,
          `--format requires a format. Accepted formats: ${formatList()}.`,
        );
      }

      if (!isBrazilReceitaRequestPacketFormat(value)) {
        throw new GeneratorUsageError(
          GENERATOR_USAGE_ERROR_CODES.formatUnknown,
          `unknown format "${value}". Accepted formats: ${formatList()}.`,
        );
      }

      format = value;
      continue;
    }

    throw new GeneratorUsageError(
      GENERATOR_USAGE_ERROR_CODES.unknownFlag,
      `unrecognized argument "${arg}". Accepted flags: ${ALLOWED_FLAGS.join(', ')}.`,
    );
  }

  if (fixture === undefined) {
    throw new GeneratorUsageError(
      GENERATOR_USAGE_ERROR_CODES.fixtureMissing,
      `--fixture is required. Known fixtures: ${fixtureList()}.`,
    );
  }

  if (format === undefined) {
    throw new GeneratorUsageError(
      GENERATOR_USAGE_ERROR_CODES.formatMissing,
      `--format is required. Accepted formats: ${formatList()}.`,
    );
  }

  return { fixture, format, pretty };
}

// ─── main ────────────────────────────────────────────────────────────────────

/**
 * Exit code 0 means a packet was generated — including a packet whose status is `blocked`, because a
 * refusal is a correct outcome for this tool and the refusal itself is the artefact worth reading.
 * Exit code 1 means the ARGUMENTS were unusable and nothing was generated.
 */
export function main(argv: readonly string[] = process.argv.slice(2)): void {
  let options: GeneratorCliOptions;
  try {
    options = parseGeneratorArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  const packet = buildBrazilReceitaControlledExecutionRequestPacket(options.fixture);
  const rendered = formatBrazilReceitaControlledExecutionRequestPacket(
    packet,
    options.format,
    options.pretty,
  );

  process.stdout.write(`${rendered}\n`);
}

// Only auto-run when executed directly, never when imported by the test file (whose path ends with
// ".test.ts", not with this filename).
const executedFile = process.argv[1] ?? '';
if (executedFile.endsWith('br-receita-cnpj-controlled-execution-request-packet-generator.ts')) {
  main();
}
