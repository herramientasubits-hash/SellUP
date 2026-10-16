/**
 * AGENT1-AUDIT-WS1 — migración 151: `claim_enrichment_jobs` sólo para
 * service_role, con search_path fijo y recuperación de trabajos muertos.
 *
 * Guarda estática (sin base): la 055 dejaba la función SECURITY DEFINER sin
 * `SET search_path` y sin REVOKE —ejecutable con la clave pública— y sólo
 * reclamaba `pending`, así que un trabajo muerto «en proceso» no volvía nunca.
 *
 * Verificada además contra PostgreSQL 17 desechable (embedded-postgres) al
 * escribirla: anon/authenticated sin EXECUTE, service_role con EXECUTE,
 * `search_path=public, pg_temp`, muerto con intentos → reclamado, muerto sin
 * intentos → `failed max_attempts_exceeded`, bloqueo vivo intacto, re-aplicable.
 *
 * Correr: node --import tsx --test src/server/prospect-batches/__tests__/claim-enrichment-jobs-151-static.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const FILE = readdirSync(MIGRATIONS).find((name) => name.startsWith('151_'));

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

function sql(): string {
  assert.ok(FILE, 'falta supabase/migrations/151_*.sql');
  return readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
}

describe('migración 151 — claim_enrichment_jobs', () => {
  it('declara en la cabecera que NO está aplicada', () => {
    assert.match(sql(), /NO APLICADA/);
  });

  it('reemplaza la función con la MISMA firma (el worker no cambia)', () => {
    const code = stripSqlComments(sql());
    assert.match(
      code,
      /CREATE OR REPLACE FUNCTION public\.claim_enrichment_jobs\(\s*p_worker_id TEXT,\s*p_limit INTEGER,\s*p_lock_duration_minutes INTEGER\s*\)/,
    );
  });

  it('SECURITY DEFINER con search_path fijo', () => {
    const code = stripSqlComments(sql());
    assert.match(code, /SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  });

  it('quita EXECUTE a PUBLIC, anon y authenticated; sólo service_role', () => {
    const code = stripSqlComments(sql());
    assert.match(
      code,
      /REVOKE ALL ON FUNCTION public\.claim_enrichment_jobs\(TEXT, INTEGER, INTEGER\) FROM PUBLIC, anon, authenticated;/,
    );
    assert.match(code, /GRANT EXECUTE ON FUNCTION public\.claim_enrichment_jobs\(TEXT, INTEGER, INTEGER\) TO service_role;/);
    assert.doesNotMatch(code, /GRANT EXECUTE[^;]*claim_enrichment_jobs[^;]*TO (anon|authenticated|PUBLIC)/i);
  });

  it('recupera los muertos «en proceso» con bloqueo vencido, y cierra los que no tienen intentos', () => {
    const code = stripSqlComments(sql());
    assert.match(code, /j\.status = 'processing'\s+AND j\.locked_at IS NOT NULL\s+AND j\.locked_at < v_lock_cutoff\s+AND j\.attempts < j\.max_attempts/);
    assert.match(code, /j\.attempts >= j\.max_attempts/);
    assert.match(code, /error_code = 'max_attempts_exceeded'/);
    assert.match(code, /FOR UPDATE SKIP LOCKED/);
  });

  it('no borra filas', () => {
    assert.doesNotMatch(stripSqlComments(sql()), /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i);
  });
});

describe('la app sólo llama a claim_enrichment_jobs con el cliente de servicio', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full, out);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it('el único llamador es enrichment-worker.ts y usa SUPABASE_SERVICE_ROLE_KEY', () => {
    const callers = walk(path.join(ROOT, 'src')).filter((file) =>
      /\.rpc\(\s*['"]claim_enrichment_jobs['"]/.test(readFileSync(file, 'utf8')),
    );
    assert.deepEqual(
      callers.map((file) => path.relative(ROOT, file)),
      ['src/server/prospect-batches/enrichment-worker.ts'],
    );
    const worker = readFileSync(callers[0], 'utf8');
    assert.match(worker, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(worker, /@\/lib\/supabase\/server/, 'nunca con el cliente de sesión');
  });
});
