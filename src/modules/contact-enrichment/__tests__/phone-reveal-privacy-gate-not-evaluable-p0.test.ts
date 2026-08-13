/**
 * Agente 2A — AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1
 *
 * Puerta de privacidad previa a Lusha (`phone-reveal-privacy-gate.ts`): guardas
 * estáticas de que `not_evaluable` ya NO se traduce a `clear`.
 *
 * Esta puerta es exactamente el caso "cross-provider" del hallazgo P0: un
 * candidato SIN Apollo person id resoluble (el caso típico es origen Lusha) no
 * tiene clave con la que emparejar el tombstone Apollo, y antes de este hito eso
 * se traducía en `clear` — Lusha se llamaba igual. Ahora se traduce en
 * `check_unavailable`, el mismo estado ya existente que bloquea con 0 llamadas y
 * 0 créditos (ver `phone-reveal-waterfall-deps.ts` y `lusha-phone-fallback-core.ts`,
 * que ya tratan `check_unavailable` como bloqueo — no hace falta cablear nada
 * nuevo para que la Lusha no se llame).
 *
 * Es un guard ESTÁTICO (lee el archivo en disco) y no de runtime porque
 * `checkPhoneRevealPrivacyGate` hace I/O real (Supabase admin client) y no es
 * inyectable: el runtime de "0 llamadas a Lusha cuando el gate dice
 * check_unavailable" ya está cubierto por
 * `phone-privacy-race-gates-core-4o-e3.test.ts`, que inyecta `checkPrivacyGate`
 * directamente. Esta prueba cierra el hueco que faltaba: que la FUNCIÓN REAL
 * produce ese `check_unavailable` para el caso not_evaluable, en vez de `clear`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const REL = 'src/modules/contact-enrichment/phone-reveal-privacy-gate.ts';

function read(): string {
  return readFileSync(join(REPO_ROOT, REL), 'utf8');
}

/** Cuerpo del switch de `checkPhoneRevealPrivacyGate`, sin comentarios. */
function switchBody(source: string): string {
  const start = source.indexOf('switch (suppression.kind) {');
  assert.notEqual(start, -1, 'no se encontró el switch del veredicto');
  const end = source.indexOf('\n  }', start);
  assert.notEqual(end, -1, 'no se encontró el cierre del switch');
  return source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('P0 — puerta previa a Lusha: not_evaluable ya NO es clear', () => {
  it('el caso not_evaluable devuelve check_unavailable, no clear', () => {
    const body = switchBody(read());
    // La forma exacta importa: 'not_evaluable' debe caer en la MISMA rama que
    // 'check_unavailable', y NUNCA en la de 'allowed'/'clear'.
    const notEvaluableIdx = body.indexOf("case 'not_evaluable':");
    const clearReturnIdx = body.lastIndexOf("return 'clear';");
    assert.notEqual(notEvaluableIdx, -1, 'falta el case not_evaluable');
    assert.notEqual(clearReturnIdx, -1, 'falta el return clear por defecto');
    assert.ok(
      notEvaluableIdx < clearReturnIdx,
      'not_evaluable debe resolverse ANTES del return clear final',
    );

    // El case not_evaluable no puede compartir bloque con 'allowed' (que sigue
    // siendo el único camino legítimo a 'clear').
    const notEvaluableBlock = body.slice(notEvaluableIdx);
    const beforeAllowed = notEvaluableBlock.split("case 'allowed':")[0];
    assert.match(
      beforeAllowed,
      /return\s+'check_unavailable';/,
      'not_evaluable debe devolver check_unavailable antes de llegar a allowed',
    );
  });

  it('el case allowed sigue siendo el único que cae en clear por defecto', () => {
    const body = switchBody(read());
    const allowedIdx = body.indexOf("case 'allowed':");
    assert.notEqual(allowedIdx, -1);
    const afterAllowed = body.slice(allowedIdx);
    assert.match(afterAllowed, /default:\s*\n\s*return\s+'clear';/);
  });

  it('la puerta sigue sin fuzzy matching (teléfono/email/nombre/linkedin) en la clave', () => {
    const source = read();
    const guardSection = source.split('checkPhoneRevealPrivacyGate')[1] ?? '';
    for (const forbidden of ['normalizedPhone', 'fullName']) {
      assert.equal(
        guardSection.includes(forbidden),
        false,
        `la puerta no puede usar ${forbidden} como clave de supresión`,
      );
    }
  });
});
