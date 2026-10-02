/**
 * Guarda estática del sistema de diseño (tema Azul de Thema).
 *
 * Ejecuta `node scripts/check-design-system.mjs --summary` desde la raíz del
 * repo y exige salida 0: ninguna de sus reglas (color a mano, paleta cruda,
 * sombra a mano, librería ajena…) puede tener hallazgos en `src/`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join('scripts', 'check-design-system.mjs');

describe('check-design-system', () => {
  it('el script existe en la raíz del repo', () => {
    assert.ok(existsSync(join(REPO_ROOT, SCRIPT)), `falta ${SCRIPT}`);
  });

  it('`--summary` termina con código 0: el código cumple todas las reglas', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--summary'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    assert.equal(result.error, undefined, `no se pudo ejecutar el script: ${result.error?.message}`);
    assert.equal(
      result.status,
      0,
      `check-design-system encontró hallazgos:\n${result.stdout}\n${result.stderr}`,
    );
  });
});
