/**
 * Tests para large-import-guardrail.ts
 * Hito: 17A.6F — Guardrail anti-importaciones masivas de fuentes
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkLargeImportGuardrail,
  assertLargeImportAllowed,
  BLOCKED_SOURCE_KEYS,
  SAFE_SOURCE_KEYS,
  LARGE_IMPORT_ROW_THRESHOLD,
} from '../large-import-guardrail';

// ── Helpers ────────────────────────────────────────────────────────────────────

const noEnv = {};

const withOverride = (sourceKey: string) => ({
  SELLUP_ALLOW_LARGE_SOURCE_IMPORT: 'true',
  SELLUP_CONFIRMED_SOURCE_KEY: sourceKey,
});

// ── Dry-run siempre pasa ───────────────────────────────────────────────────────

describe('dry-run', () => {
  it('rd_dgii_bulk en dry-run está permitido', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'rd_dgii_bulk', countryCode: 'DO', estimatedRows: 500_000, isDryRun: true },
      noEnv,
    );
    assert.equal(result.allowed, true);
  });

  it('pe_sunat_bulk en dry-run está permitido', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'pe_sunat_bulk', countryCode: 'PE', estimatedRows: null, isDryRun: true },
      noEnv,
    );
    assert.equal(result.allowed, true);
  });

  it('fuente desconocida con rows ilimitados en dry-run está permitida', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'unknown_source', countryCode: 'XX', estimatedRows: null, isDryRun: true },
      noEnv,
    );
    assert.equal(result.allowed, true);
  });
});

// ── Fuentes seguras (P1/MVP) ───────────────────────────────────────────────────

describe('fuentes seguras P1', () => {
  it('cl_chilecompra_ocds con 54 filas está permitido', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'cl_chilecompra_ocds', countryCode: 'CL', estimatedRows: 54, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, true);
  });

  it('co_siis con 10000 filas está permitido', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'co_siis', countryCode: 'CO', estimatedRows: 10_000, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, true);
  });

  it('co_fedesoft con 5000 filas está permitido', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'co_fedesoft', countryCode: 'CO', estimatedRows: 5_000, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, true);
  });

  it('co_siis con 25000 filas exactas está permitido (en el umbral)', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'co_siis', countryCode: 'CO', estimatedRows: LARGE_IMPORT_ROW_THRESHOLD, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, true);
  });

  it('co_siis con 25001 filas está bloqueado (excede umbral)', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'co_siis', countryCode: 'CO', estimatedRows: 25_001, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, false);
  });
});

// ── rd_dgii_bulk — bloqueado por defecto ──────────────────────────────────────

describe('rd_dgii_bulk — bloqueado por defecto', () => {
  it('bloqueado sin variables de entorno', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'rd_dgii_bulk', countryCode: 'DO', estimatedRows: 493_547, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, false);
  });

  it('bloqueado con solo SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true (falta CONFIRMED_SOURCE_KEY)', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'rd_dgii_bulk', countryCode: 'DO', estimatedRows: 100, isDryRun: false },
      { SELLUP_ALLOW_LARGE_SOURCE_IMPORT: 'true' },
    );
    assert.equal(result.allowed, false);
  });

  it('bloqueado con solo SELLUP_CONFIRMED_SOURCE_KEY=rd_dgii_bulk (falta ALLOW flag)', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'rd_dgii_bulk', countryCode: 'DO', estimatedRows: 100, isDryRun: false },
      { SELLUP_CONFIRMED_SOURCE_KEY: 'rd_dgii_bulk' },
    );
    assert.equal(result.allowed, false);
  });

  it('bloqueado con CONFIRMED_SOURCE_KEY incorrecto', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'rd_dgii_bulk', countryCode: 'DO', estimatedRows: 100, isDryRun: false },
      { SELLUP_ALLOW_LARGE_SOURCE_IMPORT: 'true', SELLUP_CONFIRMED_SOURCE_KEY: 'co_siis' },
    );
    assert.equal(result.allowed, false);
  });

  it('permitido con ambas variables correctas', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'rd_dgii_bulk', countryCode: 'DO', estimatedRows: 1_000, isDryRun: false },
      withOverride('rd_dgii_bulk'),
    );
    assert.equal(result.allowed, true);
  });

  it('mensaje de error contiene sourceKey, countryCode y cómo hacer override', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'rd_dgii_bulk', countryCode: 'DO', estimatedRows: 493_547, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, false);
    if (!result.allowed) {
      assert.ok(result.reason.includes('rd_dgii_bulk'), 'reason debe mencionar sourceKey');
      assert.ok(result.reason.includes('DO'), 'reason debe mencionar countryCode');
      assert.ok(result.howToOverride.includes('SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true'));
      assert.ok(result.howToOverride.includes('SELLUP_CONFIRMED_SOURCE_KEY=rd_dgii_bulk'));
    }
  });
});

// ── pe_sunat_bulk — bloqueado por defecto ─────────────────────────────────────

describe('pe_sunat_bulk — bloqueado por defecto', () => {
  it('bloqueado sin variables de entorno', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'pe_sunat_bulk', countryCode: 'PE', estimatedRows: 250_000, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, false);
  });

  it('bloqueado con rows=null (sin límite)', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'pe_sunat_bulk', countryCode: 'PE', estimatedRows: null, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, false);
  });

  it('permitido con override correcto', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'pe_sunat_bulk', countryCode: 'PE', estimatedRows: 1_000, isDryRun: false },
      withOverride('pe_sunat_bulk'),
    );
    assert.equal(result.allowed, true);
  });
});

// ── Umbral general para fuentes no listadas ────────────────────────────────────

describe('umbral general (fuentes no listadas)', () => {
  it('fuente nueva con 1000 filas está permitida', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'mx_sat_bulk', countryCode: 'MX', estimatedRows: 1_000, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, true);
  });

  it('fuente nueva con 30000 filas está bloqueada', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'mx_sat_bulk', countryCode: 'MX', estimatedRows: 30_000, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, false);
  });

  it('fuente nueva con rows=null está bloqueada (sin límite)', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'br_cnpj_bulk', countryCode: 'BR', estimatedRows: null, isDryRun: false },
      noEnv,
    );
    assert.equal(result.allowed, false);
  });

  it('fuente nueva con 30000 filas permitida con override correcto', () => {
    const result = checkLargeImportGuardrail(
      { sourceKey: 'mx_sat_bulk', countryCode: 'MX', estimatedRows: 30_000, isDryRun: false },
      withOverride('mx_sat_bulk'),
    );
    assert.equal(result.allowed, true);
  });
});

// ── assertLargeImportAllowed ───────────────────────────────────────────────────

describe('assertLargeImportAllowed', () => {
  it('no lanza error para importación permitida', () => {
    assert.doesNotThrow(() =>
      assertLargeImportAllowed(
        { sourceKey: 'co_siis', countryCode: 'CO', estimatedRows: 10_000, isDryRun: false },
        noEnv,
      ),
    );
  });

  it('lanza error para rd_dgii_bulk sin override', () => {
    assert.throws(
      () =>
        assertLargeImportAllowed(
          { sourceKey: 'rd_dgii_bulk', countryCode: 'DO', estimatedRows: 500_000, isDryRun: false },
          noEnv,
        ),
      /guardrail:blocked/,
    );
  });

  it('mensaje de error contiene instrucciones de override', () => {
    assert.throws(
      () =>
        assertLargeImportAllowed(
          { sourceKey: 'rd_dgii_bulk', countryCode: 'DO', estimatedRows: 500_000, isDryRun: false },
          noEnv,
        ),
      /SELLUP_ALLOW_LARGE_SOURCE_IMPORT/,
    );
  });

  it('no lanza error si override está activo para rd_dgii_bulk', () => {
    assert.doesNotThrow(() =>
      assertLargeImportAllowed(
        { sourceKey: 'rd_dgii_bulk', countryCode: 'DO', estimatedRows: 500_000, isDryRun: false },
        withOverride('rd_dgii_bulk'),
      ),
    );
  });

  it('dry-run no lanza error aunque sea fuente bloqueada', () => {
    assert.doesNotThrow(() =>
      assertLargeImportAllowed(
        { sourceKey: 'rd_dgii_bulk', countryCode: 'DO', estimatedRows: 999_999, isDryRun: true },
        noEnv,
      ),
    );
  });
});

// ── Constantes exportadas ──────────────────────────────────────────────────────

describe('constantes exportadas', () => {
  it('BLOCKED_SOURCE_KEYS incluye rd_dgii_bulk', () => {
    assert.ok(BLOCKED_SOURCE_KEYS.includes('rd_dgii_bulk'));
  });

  it('BLOCKED_SOURCE_KEYS incluye pe_sunat_bulk', () => {
    assert.ok(BLOCKED_SOURCE_KEYS.includes('pe_sunat_bulk'));
  });

  it('SAFE_SOURCE_KEYS incluye co_siis', () => {
    assert.ok(SAFE_SOURCE_KEYS.includes('co_siis'));
  });

  it('SAFE_SOURCE_KEYS incluye cl_chilecompra_ocds', () => {
    assert.ok(SAFE_SOURCE_KEYS.includes('cl_chilecompra_ocds'));
  });

  it('LARGE_IMPORT_ROW_THRESHOLD es 25000', () => {
    assert.equal(LARGE_IMPORT_ROW_THRESHOLD, 25_000);
  });
});
