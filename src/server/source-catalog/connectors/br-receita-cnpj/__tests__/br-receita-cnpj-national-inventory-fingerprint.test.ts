import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrReceitaNationalInventoryFingerprintError,
  deriveBrReceitaNationalInventoryFingerprint,
} from '../br-receita-cnpj-national-inventory-fingerprint';

function fullManifest(overrides: Partial<Record<string, unknown>> = {}) {
  const files: Array<Record<string, unknown>> = [];
  for (const family of ['empresas', 'estabelecimentos']) {
    for (let partOrdinal = 0; partOrdinal < 10; partOrdinal += 1) {
      files.push({
        fileType: family,
        partOrdinal,
        path: `${family}-${partOrdinal}.csv`,
        expectedSha256: String(partOrdinal + (family === 'empresas' ? 1 : 21)).padStart(64, 'a').slice(-64),
        expectedSizeBytes: 1000 + partOrdinal,
        encoding: 'latin1',
        delimiter: ';',
        layoutMode: 'official_headerless',
      });
    }
  }
  for (const [index, family] of ['cnaes', 'municipios', 'naturezas'].entries()) {
    files.push({
      fileType: family,
      partOrdinal: 0,
      path: `${family}.csv`,
      expectedSha256: String(index + 50).padStart(64, 'b').slice(-64),
      expectedSizeBytes: 2000 + index,
      encoding: 'latin1',
      delimiter: ';',
      layoutMode: 'official_headerless',
    });
  }
  return {
    mode: 'local_manifest_validation',
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    inputScope: 'full_national',
    layoutMode: 'official_headerless',
    files,
    ...overrides,
  };
}

test('fingerprint is deterministic and does not depend on file paths or manifest order', () => {
  const first = fullManifest();
  const second = fullManifest();
  second.files = [...(second.files as Array<Record<string, unknown>>)]
    .reverse()
    .map((entry, index) => ({ ...entry, path: `renamed-${index}.csv` }));

  const a = deriveBrReceitaNationalInventoryFingerprint({
    manifestDocument: JSON.stringify(first),
    expectedSourcePeriod: '2026-07',
  });
  const b = deriveBrReceitaNationalInventoryFingerprint({
    manifestDocument: JSON.stringify(second),
    expectedSourcePeriod: '2026-07',
  });

  assert.match(a, /^sha256:[a-f0-9]{64}$/);
  assert.equal(a, b);
});

test('changing a consumed file hash changes the fingerprint', () => {
  const first = fullManifest();
  const second = fullManifest();
  const files = second.files as Array<Record<string, unknown>>;
  files[0] = { ...files[0], expectedSha256: 'f'.repeat(64) };

  const a = deriveBrReceitaNationalInventoryFingerprint({
    manifestDocument: JSON.stringify(first),
    expectedSourcePeriod: '2026-07',
  });
  const b = deriveBrReceitaNationalInventoryFingerprint({
    manifestDocument: JSON.stringify(second),
    expectedSourcePeriod: '2026-07',
  });
  assert.notEqual(a, b);
});

test('fingerprint refuses a missing national join part', () => {
  const manifest = fullManifest();
  manifest.files = (manifest.files as Array<Record<string, unknown>>).filter(
    (entry) => !(entry.fileType === 'empresas' && entry.partOrdinal === 9),
  );

  assert.throws(
    () =>
      deriveBrReceitaNationalInventoryFingerprint({
        manifestDocument: JSON.stringify(manifest),
        expectedSourcePeriod: '2026-07',
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalInventoryFingerprintError &&
      error.reason === 'required_join_part_missing_or_duplicated',
  );
});

test('fingerprint refuses consumed files without strong hash and size declarations', () => {
  const manifest = fullManifest();
  const files = manifest.files as Array<Record<string, unknown>>;
  files[3] = { ...files[3], expectedSha256: undefined };

  assert.throws(
    () =>
      deriveBrReceitaNationalInventoryFingerprint({
        manifestDocument: JSON.stringify(manifest),
        expectedSourcePeriod: '2026-07',
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalInventoryFingerprintError &&
      error.reason === 'used_file_integrity_declaration_missing',
  );
});

test('fingerprint refuses a wrong period or staged subset', () => {
  assert.throws(
    () =>
      deriveBrReceitaNationalInventoryFingerprint({
        manifestDocument: JSON.stringify(fullManifest()),
        expectedSourcePeriod: '2026-06',
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalInventoryFingerprintError &&
      error.reason === 'manifest_identity_mismatch',
  );
  assert.throws(
    () =>
      deriveBrReceitaNationalInventoryFingerprint({
        manifestDocument: JSON.stringify(fullManifest({ inputScope: 'staged_subset' })),
        expectedSourcePeriod: '2026-07',
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalInventoryFingerprintError &&
      error.reason === 'manifest_not_full_national',
  );
});
