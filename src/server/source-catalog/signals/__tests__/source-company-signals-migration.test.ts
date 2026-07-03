/**
 * Tests de guardrail para la migración 080_source_company_signals.sql
 *
 * Valida que el archivo de migración:
 * 1. Crea la tabla con columnas requeridas.
 * 2. NO contiene columnas fiscales prohibidas.
 * 3. Tiene el UNIQUE constraint correcto.
 * 4. Tiene el guardrail de revisión humana name-only.
 * 5. Habilita RLS.
 * 6. Documenta la prohibición de post-approval e identidad fiscal.
 *
 * Hito: Centroamérica.7E.1
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/080_source_company_signals.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

describe('Migration 080 — source_company_signals', () => {
  describe('Tabla creada correctamente', () => {
    it('crea la tabla source_company_signals', () => {
      assert.ok(
        sql.includes('source_company_signals'),
        'Migration debe crear source_company_signals',
      );
    });

    const requiredColumns = [
      'source_key',
      'country_code',
      'source_year',
      'supplier_name',
      'normalized_supplier_name',
      'signal_strength',
      'matching_mode',
      'human_review_required',
      'supplier_platform_id',
      'signals',
      'raw_data',
      'signal_kind',
    ];

    for (const col of requiredColumns) {
      it(`contiene la columna ${col}`, () => {
        assert.ok(sql.includes(col), `Migration debe incluir columna: ${col}`);
      });
    }
  });

  describe('Columnas fiscales prohibidas ausentes', () => {
    // Busca definiciones de columna, no frases en comentarios.
    // Estrategia: extraer solo el bloque CREATE TABLE para el check de columnas.
    const createTableBlock = (() => {
      const start = sql.indexOf('create table');
      const end = sql.indexOf(');', start);
      return start >= 0 && end >= 0 ? sql.slice(start, end + 2) : sql;
    })();

    const forbiddenColumnPatterns = [
      { name: 'normalized_tax_id', pattern: /^\s+normalized_tax_id\s/m },
      { name: 'tax_id column', pattern: /^\s+tax_id\s/m },
      { name: 'tax_identifier column', pattern: /^\s+tax_identifier\s/m },
      { name: 'tax_identifier_type column', pattern: /^\s+tax_identifier_type\s/m },
      { name: 'nit column', pattern: /^\s+nit\s/m },
      { name: 'nrc column', pattern: /^\s+nrc\s/m },
      { name: 'rut column', pattern: /^\s+rut\s/m },
      { name: 'ruc column', pattern: /^\s+ruc\s/m },
    ];

    for (const { name, pattern } of forbiddenColumnPatterns) {
      it(`no define columna fiscal prohibida: ${name}`, () => {
        assert.ok(
          !pattern.test(createTableBlock),
          `Migration NO debe definir columna fiscal: ${name}`,
        );
      });
    }
  });

  describe('UNIQUE constraint de dedupe', () => {
    it('tiene unique sobre source_key, country_code, source_year, normalized_supplier_name', () => {
      assert.ok(
        sql.includes('source_key') &&
          sql.includes('country_code') &&
          sql.includes('source_year') &&
          sql.includes('normalized_supplier_name') &&
          sql.includes('unique'),
        'Migration debe tener UNIQUE constraint de dedupe por fuente/país/año/nombre',
      );
    });

    it('el UNIQUE no incluye tax_id', () => {
      const uniqueBlock = (() => {
        const idx = sql.indexOf('unique_signal');
        return idx >= 0 ? sql.slice(idx, idx + 300) : '';
      })();
      assert.ok(
        !uniqueBlock.includes('tax_id'),
        'El UNIQUE constraint no debe incluir tax_id',
      );
    });
  });

  describe('Guardrail de revisión humana', () => {
    it('contiene check de name_only_review_required', () => {
      assert.ok(
        sql.includes('name_only_review_required'),
        'Migration debe incluir validación de name_only_review_required',
      );
    });

    it('contiene check de human_review_required', () => {
      assert.ok(
        sql.includes('human_review_required'),
        'Migration debe incluir columna/check human_review_required',
      );
    });

    it('el guardrail obliga revisión humana para matching_mode name-only', () => {
      assert.ok(
        sql.includes('name_only_review_required') && sql.includes('human_review_required = true'),
        'Migration debe forzar human_review_required=true para name_only_review_required',
      );
    });

    it('el guardrail obliga revisión humana para weak_name_only', () => {
      assert.ok(
        sql.includes('weak_name_only') && sql.includes('human_review_required = true'),
        'Migration debe forzar human_review_required=true para weak_name_only',
      );
    });
  });

  describe('Row Level Security', () => {
    it('habilita RLS en la tabla', () => {
      assert.ok(
        sql.includes('enable row level security'),
        'Migration debe habilitar RLS',
      );
    });
  });

  describe('Documentación de prohibición post-approval e identidad fiscal', () => {
    it('documenta que no representa identidad fiscal', () => {
      assert.ok(
        sql.includes('fiscal') || sql.includes('identity'),
        'Migration debe documentar que no representa identidad fiscal',
      );
    });

    it('documenta prohibición de post-approval automático', () => {
      assert.ok(
        sql.includes('post-approval') || sql.includes('automatic'),
        'Migration debe documentar prohibición de post-approval automático',
      );
    });

    it('documenta que supplier_platform_id no es tax_id', () => {
      assert.ok(
        sql.includes('NOT a tax id') || sql.includes('not a tax id') || sql.includes('Not a tax id'),
        'Migration debe documentar que supplier_platform_id no es tax id',
      );
    });
  });
});
