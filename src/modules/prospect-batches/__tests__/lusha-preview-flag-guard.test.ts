/**
 * Q3F-5BB.10C2 — P0 server-side ENABLE_LUSHA_PREVIEW gate.
 *
 * Proves the flag is enforced SERVER-SIDE (not just in the UI):
 *   - `guardLushaPreviewEnabled` returns the disabled result and NEVER runs the
 *     callback when the flag is off — so no Lusha client is built, no search runs,
 *     and no DB write happens on a direct action call that bypasses the UI.
 *   - `isLushaPreviewEnabled` is strict ("true" only).
 *   - Static ordering proof: both Lusha server actions invoke the guard BEFORE any
 *     Supabase client / API-key resolution / Lusha search in their source.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  guardLushaPreviewEnabled,
  buildLushaPreviewDisabledResult,
  buildLushaPendingReviewDisabledResult,
  LUSHA_PREVIEW_DISABLED_ERROR,
} from '@/modules/prospect-batches/lusha-preview-flag-guard';
import { isLushaPreviewEnabled, LUSHA_PREVIEW_FLAG } from '@/lib/feature-flags.server';

const ROOT = process.cwd();

describe('guardLushaPreviewEnabled — flag OFF blocks every Lusha side effect', () => {
  it('flag OFF → returns the disabled result and NEVER runs the callback', async () => {
    let ran = false;
    const res = await guardLushaPreviewEnabled(
      false,
      buildLushaPreviewDisabledResult,
      async () => {
        ran = true; // building the client / running the search would happen HERE
        return { ok: true, status: 'success' } as never;
      },
    );
    assert.equal(ran, false); // no client built, no runSearch, no DB write
    assert.equal(res.ok, false);
    assert.equal((res as { error: string }).error, LUSHA_PREVIEW_DISABLED_ERROR);
  });

  it('flag ON → runs the callback exactly once and returns its result', async () => {
    let calls = 0;
    const res = await guardLushaPreviewEnabled(
      true,
      buildLushaPreviewDisabledResult,
      async () => {
        calls++;
        return { ok: true, status: 'success' } as never;
      },
    );
    assert.equal(calls, 1);
    assert.equal((res as { ok: boolean }).ok, true);
  });

  it('disabled pending-review result is a safe fail-closed shape (no batch/candidates)', () => {
    const r = buildLushaPendingReviewDisabledResult();
    assert.equal(r.ok, false);
    assert.equal(r.status, 'error');
    assert.equal(r.error, LUSHA_PREVIEW_DISABLED_ERROR);
    assert.equal(r.batchId, null);
    assert.equal(r.createdCandidatesCount, 0);
    assert.equal(r.creditsCharged, null);
  });
});

describe('isLushaPreviewEnabled — strict "true"', () => {
  it('is true only for exactly "true" (trim + case-insensitive)', () => {
    const prev = process.env[LUSHA_PREVIEW_FLAG];
    try {
      delete process.env[LUSHA_PREVIEW_FLAG];
      assert.equal(isLushaPreviewEnabled(), false);
      process.env[LUSHA_PREVIEW_FLAG] = 'false';
      assert.equal(isLushaPreviewEnabled(), false);
      process.env[LUSHA_PREVIEW_FLAG] = '1';
      assert.equal(isLushaPreviewEnabled(), false);
      process.env[LUSHA_PREVIEW_FLAG] = '  TRUE ';
      assert.equal(isLushaPreviewEnabled(), true);
    } finally {
      if (prev === undefined) delete process.env[LUSHA_PREVIEW_FLAG];
      else process.env[LUSHA_PREVIEW_FLAG] = prev;
    }
  });
});

describe('server actions gate BEFORE any Lusha work (static ordering proof)', () => {
  const PREVIEW = readFileSync(
    join(ROOT, 'src/modules/prospect-batches/lusha-preview-actions.ts'),
    'utf8',
  );
  const GENERATE = readFileSync(
    join(ROOT, 'src/modules/prospect-batches/lusha-pending-review-actions.ts'),
    'utf8',
  );

  // AGENT1-LUSHA-CUT-L3 § 16 — los marcadores se declaran POR ACCIÓN porque las dos
  // acciones dejaron de delegar en lo mismo, no porque la propiedad se haya relajado.
  //
  //   · `preview` ya no puede ejecutar Prospecting pagado: su dependencia de
  //     proveedor es un rechazo LOCAL previo al envío, así que el marcador que
  //     prueba «el trabajo real va después de la puerta» sigue siendo
  //     `executeLushaPreview(`, y ya no existe `searchLushaCompaniesV3(` que ordenar.
  //   · `generate` delega la búsqueda en `createFencedLushaRunSearch(`, que compone
  //     valla durable + núcleo de preview + cliente. Ése es ahora su punto de
  //     delegación, y ordenarlo prueba EXACTAMENTE lo mismo que antes: con el flag
  //     apagado no se construye cliente, no se resuelve credencial y no se pide nada.
  for (const [name, src, markers] of [
    ['preview', PREVIEW, ['createClient(', 'getLushaApiKey(', 'executeLushaPreview(']],
    ['generate', GENERATE, ['createClient(', 'getLushaApiKey(', 'createFencedLushaRunSearch(']],
  ] as const) {
    it(`${name} action imports + invokes the flag guard`, () => {
      assert.match(src, /isLushaPreviewEnabled/, name);
      assert.match(src, /guardLushaPreviewEnabled\(/, name);
    });

    it(`${name} action invokes the guard before building a client / key / search`, () => {
      const guardIdx = src.indexOf('guardLushaPreviewEnabled(');
      assert.ok(guardIdx >= 0, 'guard must be present');
      // The real work (client / api key / Lusha search) is delegated to a
      // callback/helper that appears strictly AFTER the guard CALL. Markers use a
      // trailing "(" so they match the call site, not the top-of-file import.
      for (const marker of markers) {
        const idx = src.indexOf(marker);
        assert.ok(idx > guardIdx, `${marker} must appear after the guard call in ${name}`);
      }
    });
  }

  it('CUT-L3 § 16 — la acción de preview ya no puede llamar al Prospecting pagado', () => {
    const code = PREVIEW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /searchLushaCompaniesV3\s*\(/);
  });
});
