export const BR_RECEITA_NATIONAL_MATERIALIZATION_CAP_KEYS = [
  'maxAdditionalBytesRead',
  'maxRowsRehydrated',
] as const;

export type BrReceitaNationalMaterializationCapKey =
  (typeof BR_RECEITA_NATIONAL_MATERIALIZATION_CAP_KEYS)[number];

export type BrReceitaNationalMaterializationCaps = Readonly<
  Record<BrReceitaNationalMaterializationCapKey, number>
>;

export type BrReceitaNationalMaterializationCapRejectionReason =
  | 'cap_absent'
  | 'cap_not_a_number'
  | 'cap_not_finite'
  | 'cap_not_an_integer'
  | 'cap_not_positive';

export interface BrReceitaNationalMaterializationCapRejection {
  readonly key: BrReceitaNationalMaterializationCapKey;
  readonly reason: BrReceitaNationalMaterializationCapRejectionReason;
}

export type BrReceitaNationalMaterializationCapResolution =
  | { readonly ok: true; readonly caps: BrReceitaNationalMaterializationCaps }
  | {
      readonly ok: false;
      readonly rejections: readonly BrReceitaNationalMaterializationCapRejection[];
    };

/**
 * Resolves the EXTRA I/O budget used after the join has found a match.
 *
 * This is intentionally separate from the full-join resource envelope. Stage 3 already re-reads the
 * rows to compare the join key; a publishing sink then needs the complete Empresa/Estabelecimento
 * rows to build the approved business snapshot. Calling those second reads "covered by the engine"
 * would under-report I/O. These two caps make that extra cost explicit and fail closed.
 *
 * No defaults. The benchmark's caps are not silently promoted into production import caps.
 */
export function resolveBrReceitaNationalMaterializationCaps(
  input:
    | Readonly<Partial<Record<BrReceitaNationalMaterializationCapKey, unknown>>>
    | null
    | undefined,
): BrReceitaNationalMaterializationCapResolution {
  const rejections: BrReceitaNationalMaterializationCapRejection[] = [];
  const resolved = {} as Record<BrReceitaNationalMaterializationCapKey, number>;

  for (const key of BR_RECEITA_NATIONAL_MATERIALIZATION_CAP_KEYS) {
    const raw = input?.[key];
    if (raw === undefined || raw === null) {
      rejections.push({ key, reason: 'cap_absent' });
      continue;
    }
    if (typeof raw !== 'number') {
      rejections.push({ key, reason: 'cap_not_a_number' });
      continue;
    }
    if (!Number.isFinite(raw)) {
      rejections.push({ key, reason: 'cap_not_finite' });
      continue;
    }
    if (!Number.isSafeInteger(raw)) {
      rejections.push({ key, reason: 'cap_not_an_integer' });
      continue;
    }
    if (raw <= 0) {
      rejections.push({ key, reason: 'cap_not_positive' });
      continue;
    }
    resolved[key] = raw;
  }

  return rejections.length > 0
    ? { ok: false, rejections }
    : { ok: true, caps: Object.freeze(resolved) };
}

export interface BrReceitaNationalMaterializationObservations {
  readonly additionalBytesRead: number;
  readonly rowsRehydrated: number;
}

export interface BrReceitaNationalMaterializationBreach {
  readonly code: 'materialization_resource_cap_exceeded';
  readonly cap: BrReceitaNationalMaterializationCapKey;
  readonly projectedValue: number;
  readonly allowedValue: number;
}

export interface BrReceitaNationalMaterializationGuard {
  /** Reserves one bounded row re-read BEFORE the filesystem call. */
  reserveRow(byteLength: number):
    | { readonly ok: true }
    | { readonly ok: false; readonly breach: BrReceitaNationalMaterializationBreach };
  observations(): BrReceitaNationalMaterializationObservations;
  breach(): BrReceitaNationalMaterializationBreach | null;
}

export function createBrReceitaNationalMaterializationGuard(
  caps: BrReceitaNationalMaterializationCaps,
): BrReceitaNationalMaterializationGuard {
  let additionalBytesRead = 0;
  let rowsRehydrated = 0;
  let latched: BrReceitaNationalMaterializationBreach | null = null;

  return {
    reserveRow(byteLength) {
      if (latched !== null) return { ok: false, breach: latched };
      if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
        latched = {
          code: 'materialization_resource_cap_exceeded',
          cap: 'maxAdditionalBytesRead',
          projectedValue: Number.isFinite(byteLength) ? byteLength : Number.MAX_SAFE_INTEGER,
          allowedValue: caps.maxAdditionalBytesRead,
        };
        return { ok: false, breach: latched };
      }

      const projectedRows = rowsRehydrated + 1;
      if (projectedRows > caps.maxRowsRehydrated) {
        latched = {
          code: 'materialization_resource_cap_exceeded',
          cap: 'maxRowsRehydrated',
          projectedValue: projectedRows,
          allowedValue: caps.maxRowsRehydrated,
        };
        return { ok: false, breach: latched };
      }

      const projectedBytes = additionalBytesRead + byteLength;
      if (!Number.isSafeInteger(projectedBytes) || projectedBytes > caps.maxAdditionalBytesRead) {
        latched = {
          code: 'materialization_resource_cap_exceeded',
          cap: 'maxAdditionalBytesRead',
          projectedValue: Number.isSafeInteger(projectedBytes) ? projectedBytes : Number.MAX_SAFE_INTEGER,
          allowedValue: caps.maxAdditionalBytesRead,
        };
        return { ok: false, breach: latched };
      }

      // Reserved before I/O. A short/failed read is deliberately not refunded: the attempt consumed
      // part of the authorized materialization budget and a retry must not get that budget for free.
      rowsRehydrated = projectedRows;
      additionalBytesRead = projectedBytes;
      return { ok: true };
    },

    observations() {
      return { additionalBytesRead, rowsRehydrated };
    },

    breach() {
      return latched;
    },
  };
}
