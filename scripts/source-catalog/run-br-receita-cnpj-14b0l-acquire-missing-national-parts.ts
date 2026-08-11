/**
 * BR-SOURCE-14B.0L — acquire ONLY the parts the authoritative inventory says are missing.
 *
 * This is an acquisition operator, not a pipeline stage. It downloads named ZIP parts from the
 * official Receita publisher, verifies them, extracts the single expected member of each, and installs
 * it into the operator's local dataset. It does NOT scan, join, benchmark, import or open a data row,
 * and completing it does not authorize the second real benchmark.
 *
 * ── What makes a part "acquired" ─────────────────────────────────────────────────────────────────
 * Four independent gates, in order, all of which must pass. A part that fails any gate is not
 * acquired, keeps no final artifact, and does not stop the parts that already succeeded:
 *
 *   1. DOWNLOAD_VERIFIED    — transferred completely and the byte count equals the PUBLISHED size.
 *   2. ZIP_INTEGRITY        — central directory readable, CRC test passes, exactly the expected family.
 *   3. EXTRACTION_VERIFIED  — one member, extracted with path-traversal/symlink defenses.
 *   4. FINAL_SOURCE_INSTALLED — landed under the extract root and hardlinked into the input root.
 *
 * ── Why the published size is the identity, not a checksum ───────────────────────────────────────
 * The publisher exposes no checksum. What it does expose, and what BR-SOURCE-14B.0K froze into a
 * versioned artifact, is `name|size` per entry. So the size is not a sanity check here — it IS the
 * identity assertion, and a mismatch means the publisher changed the file underneath a frozen
 * contract. That is a hard stop for owner review, never a retry.
 *
 * ── Token handling (§ 4) ────────────────────────────────────────────────────────────────────────
 * The public-share token arrives ONLY through the environment, is never accepted as an argument (argv
 * is visible to every process on the host), is never logged, and is never written to the report. Every
 * string that leaves this process passes through `redact()`. The durable evidence records publisher,
 * host and period — never the credential, and never an absolute local path.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

import {
  BRAZIL_RECEITA_PUBLISHER_HOST,
  BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07,
  canonicalBrazilReceitaPublisherInventoryText,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-14b0k-publisher-inventory';

// ─── Policy constants ─────────────────────────────────────────────────────────

/** The only period this milestone acquires. A different period has no frozen inventory. */
const SUPPORTED_PERIOD = '2026-07' as const;

/** The only two families that may be acquired. `socios` and every person-linked family are absent. */
const ACQUIRABLE_FAMILIES = ['Empresas', 'Estabelecimentos'] as const;
type AcquirableFamily = (typeof ACQUIRABLE_FAMILIES)[number];

/** Tokens that must never appear in an acquisition target, whatever the caller asks for (§ 2). */
const PROHIBITED_NAME_TOKENS = ['socio', 'qsa', 'cpf'] as const;

/** Part 0 is already staged and is explicitly out of scope (§ 2). */
const PROHIBITED_ORDINALS: readonly number[] = [0];

/** The archive member suffix each family must contain, exactly once. */
const FAMILY_MEMBER_SUFFIX: Record<AcquirableFamily, string> = {
  Empresas: 'EMPRECSV',
  Estabelecimentos: 'ESTABELE',
};

/** Lowercase directory/file stem used by the local dataset layout, mirroring part 0. */
const FAMILY_LOCAL_STEM: Record<AcquirableFamily, string> = {
  Empresas: 'empresas',
  Estabelecimentos: 'estabelecimentos',
};

/**
 * § 7: parts are acquired STRICTLY SEQUENTIALLY — the section's first-choice setting.
 *
 * Not a pool with the width set to one: `curl` and `unzip` are driven through `spawnSync`, which parks
 * the event loop for the duration of each child, so any apparent worker pool here would collapse to
 * one-at-a-time anyway. Saying so plainly beats offering a `--concurrency` flag that silently does
 * nothing, and one download at a time is also the gentlest pattern against a public publisher.
 */
const ACQUISITION_ORDER = 'sequential' as const;

/** § 7: a network retry is bounded and counted. Identity failures are never retried. */
const DEFAULT_MAX_ATTEMPTS = 3;

/** § 5: the operative floor that must remain free after acquisition finishes. */
const FREE_DISK_RESERVE_AFTER_ACQUISITION_BYTES = 15 * 1024 ** 3;

/**
 * § 5: extraction envelope when no authoritative uncompressed size exists.
 *
 * Conservative on purpose and declared rather than inferred: comfortably above the ratios observable
 * on the already-staged part 0. Once a ZIP is on disk its central directory states the exact
 * uncompressed size, and `assertRoomToExtract` gates each extraction on that real number instead.
 */
const EXTRACTION_ENVELOPE_FACTOR = 6;

const SHARE_TOKEN_ENV_VAR = 'BR_RECEITA_SHARE_TOKEN';

// ─── Redaction ────────────────────────────────────────────────────────────────

let redactions: readonly string[] = [];

/** Replaces every registered secret and local root with a stable placeholder. */
function redact(text: string): string {
  let out = text;
  for (const secret of redactions) {
    if (secret.length > 0) out = out.split(secret).join('<REDACTED>');
  }
  return out;
}

function log(message: string): void {
  process.stdout.write(`${redact(message)}\n`);
}

// ─── Arguments ────────────────────────────────────────────────────────────────

interface Options {
  readonly period: string;
  readonly stagingDir: string;
  readonly archiveDir: string;
  readonly extractDir: string;
  readonly inputDir: string;
  readonly reportPath: string | null;
  readonly maxAttempts: number;
  readonly retainZips: boolean;
  readonly dryRun: boolean;
}

function readArgs(argv: readonly string[]): Options {
  const map = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(key);
    } else {
      map.set(key, next);
      i += 1;
    }
  }

  const required = (key: string): string => {
    const value = map.get(key);
    if (value === undefined || value.trim().length === 0) {
      throw new Error(`missing required argument --${key}`);
    }
    return resolve(value);
  };

  const attemptsRaw = Number(map.get('max-attempts') ?? DEFAULT_MAX_ATTEMPTS);

  return {
    period: map.get('period') ?? SUPPORTED_PERIOD,
    stagingDir: required('staging-dir'),
    archiveDir: required('archive-dir'),
    extractDir: required('extract-dir'),
    inputDir: required('input-dir'),
    reportPath: map.has('report-path') ? resolve(map.get('report-path')!) : null,
    maxAttempts: Number.isInteger(attemptsRaw) ? Math.min(Math.max(attemptsRaw, 1), 5) : DEFAULT_MAX_ATTEMPTS,
    retainZips: !flags.has('discard-zips'),
    dryRun: flags.has('dry-run'),
  };
}

// ─── Expected inventory (from the frozen 14B.0K artifact) ─────────────────────

interface PublishedPart {
  readonly name: string;
  readonly family: AcquirableFamily;
  readonly ordinal: number;
  readonly publishedSizeBytes: number;
}

/**
 * Derives the acquisition target list from the frozen inventory.
 *
 * Names come from the artifact, never from a template: a part this process would happily construct as
 * `Empresas7.zip` but which the publisher never listed must not be requestable.
 */
function derivePublishedParts(): readonly PublishedPart[] {
  // `entries` is declared as a union with `unknown` in the artifact so that a malformed transcription
  // cannot type-check its way past the parser. Narrow it the same way the canonical hash does.
  const raw = BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07.entries;
  const entries = Array.isArray(raw)
    ? (raw as readonly { readonly name: string; readonly publishedSizeBytes: number | null }[])
    : [];

  const parts: PublishedPart[] = [];
  for (const entry of entries) {
    const name = entry.name;
    if (typeof name !== 'string') continue;
    const lower = name.toLowerCase();
    if (PROHIBITED_NAME_TOKENS.some((token) => lower.includes(token))) continue;
    for (const family of ACQUIRABLE_FAMILIES) {
      const match = new RegExp(`^${family}(\\d+)\\.zip$`).exec(name);
      if (match === null) continue;
      const ordinal = Number(match[1]);
      if (PROHIBITED_ORDINALS.includes(ordinal)) continue;
      if (typeof entry.publishedSizeBytes !== 'number') continue;
      parts.push({ name, family, ordinal, publishedSizeBytes: entry.publishedSizeBytes });
    }
  }
  return parts.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Disk ─────────────────────────────────────────────────────────────────────

function availableBytes(path: string): number {
  const result = spawnSync('df', ['-k', path], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('df failed');
  const line = result.stdout.trim().split('\n').at(-1) ?? '';
  const columns = line.split(/\s+/);
  const availKib = Number(columns[3]);
  if (!Number.isFinite(availKib)) throw new Error('df output unparseable');
  return availKib * 1024;
}

function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

// ─── Archive inspection ───────────────────────────────────────────────────────

interface ArchiveMember {
  readonly name: string;
  readonly uncompressedSizeBytes: number;
  readonly isSymlink: boolean;
}

/**
 * Reads the central directory and returns the member list.
 *
 * `unzip -Z` inspects archive structure only. It is the integrity surface § 8 explicitly allows and
 * decodes no CSV field: nothing here parses a row or looks at record content.
 */
function listArchiveMembers(zipPath: string): readonly ArchiveMember[] {
  const result = spawnSync('unzip', ['-Z', '-l', zipPath], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (result.status !== 0) throw new Error('zip_central_directory_unreadable');
  const members: ArchiveMember[] = [];
  for (const line of result.stdout.split('\n')) {
    // `-Z -l` long listing, e.g.
    //   -rw-rw-r--  6.3 unx    88215 bx    21930 defN 26-Jul-12 07:12 F.K03200$Z.D60711.CNAECSV
    //   <perms> <ver> <os> <size> <flag> <cmpsize> <method> <date> <time> <name>
    // The name is everything after the time field; capturing from one field too early would fold the
    // clock into the member name and defeat every name-based gate below.
    const match =
      /^(\S{10,11})\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/.exec(line);
    if (match === null) continue;
    const perms = match[1]!;
    members.push({
      name: match[3]!.trim(),
      uncompressedSizeBytes: Number(match[2]),
      isSymlink: perms.startsWith('l'),
    });
  }
  if (members.length === 0) throw new Error('zip_central_directory_empty');
  return members;
}

/** Full CRC verification of every entry. This is the archive integrity test of § 8. */
function testArchiveIntegrity(zipPath: string): void {
  const result = spawnSync('unzip', ['-t', '-qq', zipPath], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (result.status !== 0) throw new Error('zip_integrity_test_failed');
}

/**
 * The member-safety gate (§ 9). Refuses before anything is written, not after.
 *
 * Rejects: absolute archive paths, `..` traversal, any directory component, symlink entries, more than
 * one member, and a member whose suffix belongs to a different family than the ZIP claims.
 */
function assertSafeSingleMember(
  members: readonly ArchiveMember[],
  family: AcquirableFamily,
  ordinal: number,
): ArchiveMember {
  if (members.length !== 1) throw new Error(`zip_unexpected_member_count:${members.length}`);
  const member = members[0]!;
  const name = member.name;

  if (member.isSymlink) throw new Error('zip_symlink_entry_rejected');
  if (name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name)) throw new Error('zip_absolute_path_rejected');
  if (name.split(/[\\/]/).includes('..')) throw new Error('zip_parent_traversal_rejected');
  if (name.includes('/') || name.includes('\\')) throw new Error('zip_nested_path_rejected');
  if (basename(name) !== name) throw new Error('zip_nested_path_rejected');

  const lower = name.toLowerCase();
  if (PROHIBITED_NAME_TOKENS.some((token) => lower.includes(token))) {
    throw new Error('zip_person_linked_member_rejected');
  }

  const expectedSuffix = FAMILY_MEMBER_SUFFIX[family];
  if (!name.endsWith(expectedSuffix)) throw new Error(`zip_family_mismatch:${expectedSuffix}`);
  for (const other of ACQUIRABLE_FAMILIES) {
    if (other !== family && name.endsWith(FAMILY_MEMBER_SUFFIX[other])) {
      throw new Error('zip_family_mismatch_crossover');
    }
  }

  // The publisher's own part marker. Recorded and enforced: an internal ordinal that disagrees with
  // the file name could mean a mis-partitioned publication, which an operator must see, not absorb.
  if (!new RegExp(`Y0*${ordinal}\\.`).test(name)) {
    throw new Error(`zip_member_ordinal_mismatch:${ordinal}`);
  }
  if (member.uncompressedSizeBytes <= 0) throw new Error('zip_member_empty');
  return member;
}

// ─── Per-part acquisition ─────────────────────────────────────────────────────

type PartStatus = 'installed' | 'already_present' | 'failed';

interface PartOutcome {
  readonly name: string;
  readonly family: AcquirableFamily;
  readonly ordinal: number;
  readonly status: PartStatus;
  readonly downloadAttempts: number;
  readonly downloadVerified: boolean;
  readonly zipSizeMatch: boolean;
  readonly zipIntegrityVerified: boolean;
  readonly extractionVerified: boolean;
  readonly finalSourceInstalled: boolean;
  readonly publishedSizeBytes: number;
  readonly observedSizeBytes: number | null;
  readonly extractedSizeBytes: number | null;
  readonly zipRemovedAfterVerifiedExtraction: boolean;
  readonly failureCode: string | null;
}

function localTargets(options: Options, part: PublishedPart) {
  const stem = `${FAMILY_LOCAL_STEM[part.family]}${part.ordinal}`;
  return {
    stem,
    finalZip: join(options.archiveDir, part.name),
    partialZip: join(options.stagingDir, `${part.name}.partial`),
    stagedZip: join(options.stagingDir, part.name),
    extractSubdir: join(options.extractDir, stem),
    inputCsv: join(options.inputDir, `${stem}.csv`),
  };
}

/** Already-installed parts are skipped whole (§ 19) rather than re-downloaded. */
function isAlreadyInstalled(options: Options, part: PublishedPart): boolean {
  const targets = localTargets(options, part);
  if (!existsSync(targets.inputCsv)) return false;
  try {
    return statSync(targets.inputCsv).size > 0;
  } catch {
    return false;
  }
}

async function downloadPart(
  options: Options,
  part: PublishedPart,
  token: string,
): Promise<{ readonly attempts: number; readonly sizeBytes: number }> {
  const targets = localTargets(options, part);
  const url =
    `https://${BRAZIL_RECEITA_PUBLISHER_HOST}/public.php/dav/files/${token}` +
    `/Dados/Cadastros/CNPJ/${options.period}/${part.name}`;

  let lastError = 'download_failed';
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    if (existsSync(targets.partialZip)) rmSync(targets.partialZip, { force: true });
    const result = spawnSync(
      'curl',
      [
        '-sS',
        '--fail',
        '--location',
        '--max-time',
        '3600',
        '--connect-timeout',
        '30',
        '--user',
        `${token}:`,
        '--output',
        targets.partialZip,
        url,
      ],
      { encoding: 'utf8', maxBuffer: 1 << 22 },
    );

    if (result.status !== 0) {
      lastError = 'download_transport_failed';
      log(`    attempt ${attempt}/${options.maxAttempts} transport failure`);
      continue;
    }

    const observed = statSync(targets.partialZip).size;
    if (observed !== part.publishedSizeBytes) {
      // A short transfer is a network fault and may be retried. A LONGER file, or a stable wrong
      // length, means the publisher's bytes disagree with the frozen contract — do not retry that.
      if (observed > part.publishedSizeBytes) {
        rmSync(targets.partialZip, { force: true });
        throw new Error(`published_size_mismatch_larger:${observed}`);
      }
      lastError = `download_truncated:${observed}`;
      log(`    attempt ${attempt}/${options.maxAttempts} truncated (${observed}/${part.publishedSizeBytes})`);
      continue;
    }

    return { attempts: attempt, sizeBytes: observed };
  }

  rmSync(targets.partialZip, { force: true });
  throw new Error(lastError);
}

/** § 5/§ 9: gate each extraction on the archive's own declared uncompressed size. */
function assertRoomToExtract(path: string, uncompressedSizeBytes: number): void {
  const free = availableBytes(path);
  const needed = uncompressedSizeBytes + FREE_DISK_RESERVE_AFTER_ACQUISITION_BYTES;
  if (free < needed) {
    throw new Error(`disk_reserve_breach_before_extraction:${free}`);
  }
}

async function acquirePart(options: Options, part: PublishedPart, token: string): Promise<PartOutcome> {
  const targets = localTargets(options, part);
  const base: Omit<PartOutcome, 'status' | 'failureCode'> = {
    name: part.name,
    family: part.family,
    ordinal: part.ordinal,
    downloadAttempts: 0,
    downloadVerified: false,
    zipSizeMatch: false,
    zipIntegrityVerified: false,
    extractionVerified: false,
    finalSourceInstalled: false,
    publishedSizeBytes: part.publishedSizeBytes,
    observedSizeBytes: null,
    extractedSizeBytes: null,
    zipRemovedAfterVerifiedExtraction: false,
  };

  try {
    // § 11: never overwrite an existing part, part 0 least of all.
    if (existsSync(targets.inputCsv)) throw new Error('input_target_exists_refusing_overwrite');
    if (existsSync(targets.finalZip)) throw new Error('archive_target_exists_refusing_overwrite');

    log(`  ${part.name}: downloading (${gib(part.publishedSizeBytes)})`);
    const download = await downloadPart(options, part, token);
    log(`  ${part.name}: size matches published exactly`);

    // Atomic promotion inside staging: a `.partial` never becomes a candidate for anything.
    renameSync(targets.partialZip, targets.stagedZip);

    const members = listArchiveMembers(targets.stagedZip);
    testArchiveIntegrity(targets.stagedZip);
    const member = assertSafeSingleMember(members, part.family, part.ordinal);
    log(`  ${part.name}: integrity OK, 1 safe member (${gib(member.uncompressedSizeBytes)} uncompressed)`);

    assertRoomToExtract(options.extractDir, member.uncompressedSizeBytes);

    // Extract exactly the one validated member. `-j` junks any path component as a second line of
    // defence behind the member-name gate above.
    mkdirSync(targets.extractSubdir, { recursive: true });
    const extracted = spawnSync(
      'unzip',
      ['-qq', '-j', '-n', targets.stagedZip, member.name, '-d', targets.extractSubdir],
      { encoding: 'utf8', maxBuffer: 1 << 22 },
    );
    if (extracted.status !== 0) throw new Error('extraction_failed');

    const landed = readdirSync(targets.extractSubdir);
    if (landed.length !== 1 || landed[0] !== member.name) {
      throw new Error(`extraction_unexpected_output:${landed.length}`);
    }
    const extractedPath = join(targets.extractSubdir, member.name);
    const extractedSize = statSync(extractedPath).size;
    if (extractedSize !== member.uncompressedSizeBytes) {
      throw new Error(`extraction_size_mismatch:${extractedSize}`);
    }
    log(`  ${part.name}: extraction verified`);

    // Install into the input root exactly as part 0 is installed: a hardlink, so the engine's input
    // and the extract tree are one inode and the dataset does not pay for the file twice.
    linkSync(extractedPath, targets.inputCsv);

    // The ZIP moves to the dataset archive only after extraction is proven (§ 10).
    let zipRemoved = false;
    if (options.retainZips) {
      renameSync(targets.stagedZip, targets.finalZip);
    } else {
      rmSync(targets.stagedZip, { force: true });
      zipRemoved = true;
    }

    log(`  ${part.name}: INSTALLED`);
    return {
      ...base,
      downloadAttempts: download.attempts,
      downloadVerified: true,
      zipSizeMatch: true,
      zipIntegrityVerified: true,
      extractionVerified: true,
      finalSourceInstalled: true,
      observedSizeBytes: download.sizeBytes,
      extractedSizeBytes: extractedSize,
      zipRemovedAfterVerifiedExtraction: zipRemoved,
      status: 'installed',
      failureCode: null,
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'unknown_failure';
    // § 20: no destructive rollback of anything already verified. Only this part's own unpromoted
    // scratch is cleaned, and only inside staging.
    rmSync(targets.partialZip, { force: true });
    log(`  ${part.name}: FAILED (${code})`);
    return { ...base, status: 'failed', failureCode: code };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = readArgs(process.argv.slice(2));
  const token = process.env[SHARE_TOKEN_ENV_VAR];
  if (token === undefined || token.trim().length === 0) {
    throw new Error(`missing ${SHARE_TOKEN_ENV_VAR} in the environment`);
  }
  redactions = [token, options.stagingDir, options.archiveDir, options.extractDir, options.inputDir];

  if (options.period !== SUPPORTED_PERIOD) {
    throw new Error(`period_not_resolved_by_this_milestone:${options.period}`);
  }

  // The inventory this run trusts must be the one that landed, unmodified.
  const canonical = canonicalBrazilReceitaPublisherInventoryText(
    BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07,
  );
  const inventorySha256 = createHash('sha256').update(canonical, 'utf8').digest('hex');

  const published = derivePublishedParts();
  log(`period                : ${options.period}`);
  log(`publisher             : Receita Federal (${BRAZIL_RECEITA_PUBLISHER_HOST})`);
  log(`inventory sha256      : ${inventorySha256}`);
  log(`acquirable parts      : ${published.length}`);
  log(`acquisition order     : ${ACQUISITION_ORDER}`);
  log(`retain zips           : ${options.retainZips}`);

  const pending = published.filter((part) => !isAlreadyInstalled(options, part));
  const skipped = published.filter((part) => isAlreadyInstalled(options, part));
  log(`already installed     : ${skipped.length}`);
  log(`to acquire            : ${pending.length}`);

  // ── § 5 hard gate, before the first GET of a ZIP ──
  const totalMissingCompressed = pending.reduce((sum, part) => sum + part.publishedSizeBytes, 0);
  const envelope = totalMissingCompressed * EXTRACTION_ENVELOPE_FACTOR;
  const requiredStaging = totalMissingCompressed + envelope + FREE_DISK_RESERVE_AFTER_ACQUISITION_BYTES;
  const availableStaging = availableBytes(options.stagingDir);
  const availableFinal = availableBytes(options.inputDir);
  const availableEffective = Math.min(availableStaging, availableFinal);

  log('');
  log(`TOTAL_MISSING_COMPRESSED_BYTES : ${totalMissingCompressed} (${gib(totalMissingCompressed)})`);
  log(`REQUIRED_STAGING_BYTES         : ${requiredStaging} (${gib(requiredStaging)})`);
  log(`AVAILABLE_BYTES_BEFORE         : ${availableEffective} (${gib(availableEffective)})`);

  const diskPreflightPassed = requiredStaging <= availableEffective;
  log(`DISK_PREFLIGHT_PASSED          : ${diskPreflightPassed}`);
  if (!diskPreflightPassed) {
    log('');
    log('INSUFFICIENT_DISK_FOR_NATIONAL_ACQUISITION');
    process.exitCode = 2;
    return;
  }

  if (options.dryRun) {
    log('');
    log('dry run: preflight only, nothing downloaded.');
    return;
  }

  for (const dir of [options.stagingDir, options.archiveDir, options.extractDir, options.inputDir]) {
    mkdirSync(dir, { recursive: true });
  }

  // ── Acquisition, one part at a time (§ 7) ──
  // A failure does not abort the run: § 20 asks for an exact account of which parts landed and which
  // did not, and stopping at the first failure would report neither.
  log('');
  const outcomes: PartOutcome[] = [];
  for (const part of pending) {
    outcomes.push(await acquirePart(options, part, token));
  }

  outcomes.sort((a, b) => a.name.localeCompare(b.name));
  const succeeded = outcomes.filter((outcome) => outcome.status === 'installed');
  const failed = outcomes.filter((outcome) => outcome.status === 'failed');
  const freeAfter = availableBytes(options.inputDir);

  log('');
  log(`ACQUISITION_ATTEMPTED_PARTS : ${outcomes.length}`);
  log(`ACQUISITION_SUCCEEDED_PARTS : ${succeeded.length}`);
  log(`ACQUISITION_FAILED_PARTS    : ${failed.length}`);
  log(`FREE_BYTES_AFTER            : ${freeAfter} (${gib(freeAfter)})`);
  log(
    `FREE_DISK_RESERVE_AFTER_OK  : ${freeAfter >= FREE_DISK_RESERVE_AFTER_ACQUISITION_BYTES}`,
  );

  if (options.reportPath !== null) {
    const report = {
      milestone: 'BR-SOURCE-14B.0L',
      publisher: 'Receita Federal',
      publisherHost: BRAZIL_RECEITA_PUBLISHER_HOST,
      period: options.period,
      inventorySha256,
      diskPreflightPassed,
      totalMissingCompressedBytes: totalMissingCompressed,
      requiredStagingBytes: requiredStaging,
      availableBytesBefore: availableEffective,
      freeBytesAfter: freeAfter,
      freeDiskReserveAfterBytes: FREE_DISK_RESERVE_AFTER_ACQUISITION_BYTES,
      alreadyInstalledParts: skipped.map((part) => part.name),
      outcomes,
      realDataRowsOpened: 0,
      realSourceReaderCalls: 0,
      realScanExecuted: false,
      realJoinExecuted: false,
      secondRealBenchmarkExecuted: false,
      attempt2Authorized: false,
      attempt2Executed: false,
    };
    // The report carries names, sizes and verdicts — never a token and never a local absolute path.
    writeFileSync(options.reportPath, `${redact(JSON.stringify(report, null, 2))}\n`, 'utf8');
    log('report written');
  }

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${redact(message)}\n`);
  process.exitCode = 1;
});
