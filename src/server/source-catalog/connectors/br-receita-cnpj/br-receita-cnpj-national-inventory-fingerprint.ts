import { createHash } from 'node:crypto';

import {
  BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
  BR_RECEITA_CNPJ_MANIFEST_MODE,
  BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
  BR_RECEITA_CNPJ_NATIONAL_PART_COUNT,
} from './br-receita-cnpj-manifest';

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const USED_JOIN_FAMILIES = ['empresas', 'estabelecimentos'] as const;
const USED_LOOKUP_FAMILIES = ['cnaes', 'municipios', 'naturezas'] as const;
const USED_FAMILIES = [...USED_JOIN_FAMILIES, ...USED_LOOKUP_FAMILIES] as const;

type UsedFamily = (typeof USED_FAMILIES)[number];

export type BrReceitaNationalInventoryFingerprintRefusalReason =
  | 'manifest_not_json'
  | 'manifest_identity_mismatch'
  | 'manifest_not_full_national'
  | 'used_file_declaration_invalid'
  | 'used_file_integrity_declaration_missing'
  | 'required_join_part_missing_or_duplicated'
  | 'required_lookup_missing_or_duplicated';

export class BrReceitaNationalInventoryFingerprintError extends Error {
  readonly reason: BrReceitaNationalInventoryFingerprintRefusalReason;

  constructor(reason: BrReceitaNationalInventoryFingerprintRefusalReason) {
    super(`br receita national inventory fingerprint refused (${reason})`);
    this.name = 'BrReceitaNationalInventoryFingerprintError';
    this.reason = reason;
  }
}

interface CanonicalUsedFile {
  readonly family: UsedFamily;
  readonly partOrdinal: number;
  readonly expectedSha256: string;
  readonly expectedSizeBytes: number;
  readonly encoding: 'latin1';
  readonly delimiter: ';';
  readonly layoutMode: 'official_headerless';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUsedFamily(value: string): value is UsedFamily {
  return (USED_FAMILIES as readonly string[]).includes(value);
}

function partOrdinal(value: unknown): number | null {
  if (value === undefined) return 0;
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value < BR_RECEITA_CNPJ_NATIONAL_PART_COUNT
  ) {
    return value;
  }
  return null;
}

/**
 * Produces the inventory identity carried by every national chunk/checkpoint.
 *
 * It deliberately hashes NO path or filename. The identity is over the manifest's verified content
 * declarations for exactly the files the loader consumes: Empresas0..9, Estabelecimentos0..9, CNAE,
 * Municipios and Naturezas. Every consumed file must carry an expected SHA-256 and byte size; the
 * official manifest validator is responsible for checking those declarations against the real files
 * before this fingerprint is trusted by an operator.
 */
export function deriveBrReceitaNationalInventoryFingerprint(args: {
  readonly manifestDocument: string;
  readonly expectedSourcePeriod: string;
}): string {
  let raw: unknown;
  try {
    raw = JSON.parse(args.manifestDocument);
  } catch {
    throw new BrReceitaNationalInventoryFingerprintError('manifest_not_json');
  }
  if (!isRecord(raw) || !Array.isArray(raw.files)) {
    throw new BrReceitaNationalInventoryFingerprintError('manifest_not_json');
  }
  if (
    raw.mode !== BR_RECEITA_CNPJ_MANIFEST_MODE ||
    raw.sourceKey !== BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY ||
    raw.countryCode !== BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE ||
    raw.sourcePeriod !== args.expectedSourcePeriod ||
    typeof raw.sourceYear !== 'number' ||
    !Number.isSafeInteger(raw.sourceYear)
  ) {
    throw new BrReceitaNationalInventoryFingerprintError('manifest_identity_mismatch');
  }
  if (raw.inputScope !== 'full_national') {
    throw new BrReceitaNationalInventoryFingerprintError('manifest_not_full_national');
  }

  const canonical: CanonicalUsedFile[] = [];
  const identities = new Set<string>();
  for (const candidate of raw.files) {
    if (!isRecord(candidate) || typeof candidate.fileType !== 'string') continue;
    if (!isUsedFamily(candidate.fileType)) continue;

    const ordinal = partOrdinal(candidate.partOrdinal);
    if (
      ordinal === null ||
      candidate.encoding !== 'latin1' ||
      candidate.delimiter !== ';' ||
      (candidate.layoutMode ?? raw.layoutMode) !== 'official_headerless'
    ) {
      throw new BrReceitaNationalInventoryFingerprintError('used_file_declaration_invalid');
    }
    if (
      typeof candidate.expectedSha256 !== 'string' ||
      !HASH_PATTERN.test(candidate.expectedSha256) ||
      typeof candidate.expectedSizeBytes !== 'number' ||
      !Number.isSafeInteger(candidate.expectedSizeBytes) ||
      candidate.expectedSizeBytes <= 0
    ) {
      throw new BrReceitaNationalInventoryFingerprintError(
        'used_file_integrity_declaration_missing',
      );
    }

    const identity = `${candidate.fileType}:${ordinal}`;
    if (identities.has(identity)) {
      if ((USED_JOIN_FAMILIES as readonly string[]).includes(candidate.fileType)) {
        throw new BrReceitaNationalInventoryFingerprintError(
          'required_join_part_missing_or_duplicated',
        );
      }
      throw new BrReceitaNationalInventoryFingerprintError(
        'required_lookup_missing_or_duplicated',
      );
    }
    identities.add(identity);
    canonical.push({
      family: candidate.fileType,
      partOrdinal: ordinal,
      expectedSha256: candidate.expectedSha256.toLowerCase(),
      expectedSizeBytes: candidate.expectedSizeBytes,
      encoding: 'latin1',
      delimiter: ';',
      layoutMode: 'official_headerless',
    });
  }

  for (const family of USED_JOIN_FAMILIES) {
    for (let ordinal = 0; ordinal < BR_RECEITA_CNPJ_NATIONAL_PART_COUNT; ordinal += 1) {
      if (!identities.has(`${family}:${ordinal}`)) {
        throw new BrReceitaNationalInventoryFingerprintError(
          'required_join_part_missing_or_duplicated',
        );
      }
    }
  }
  for (const family of USED_LOOKUP_FAMILIES) {
    const matching = canonical.filter((entry) => entry.family === family);
    if (matching.length !== 1 || matching[0]!.partOrdinal !== 0) {
      throw new BrReceitaNationalInventoryFingerprintError(
        'required_lookup_missing_or_duplicated',
      );
    }
  }

  canonical.sort((left, right) => {
    const familyDelta = left.family.localeCompare(right.family);
    return familyDelta !== 0 ? familyDelta : left.partOrdinal - right.partOrdinal;
  });
  const payload = JSON.stringify({
    sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
    countryCode: BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
    sourceYear: raw.sourceYear,
    sourcePeriod: raw.sourcePeriod,
    files: canonical,
  });
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}
