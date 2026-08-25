/**
 * lusha-phone-reveal-error-diagnostic-static.test.ts
 * (Agente 2A · AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1)
 *
 * GUARDA ESTÁTICA DEL CABLEADO.
 *
 * Existe porque el defecto que este hito arregla es EXACTAMENTE de la clase que un
 * test de comportamiento no ve y el compilador tampoco: el core del waterfall pasaba
 * `lushaContactId` a `callLushaLeg`, el ejecutor no lo declaraba, y TypeScript lo
 * aceptó — una función cuyo objeto de parámetros declara MENOS propiedades es
 * asignable a una que declara más. Los tests del core pasaban (inyectan su propio
 * `callLushaLeg` de mentira) y los del fallback también (le pasan el id a mano). El
 * único sitio donde el hueco existía era la juntura real, que nadie miraba.
 *
 * Estas guardas miran esa juntura. Leen el FUENTE, y a propósito lo hacen con los
 * comentarios QUITADOS: mencionar un símbolo en una explicación no es cablearlo
 * (feedback_static_guards_strip_comments).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODULE_DIR = join(process.cwd(), 'src/modules/contact-enrichment');

/**
 * Quita comentarios de bloque y de línea. Sin esto, un archivo que sólo EXPLICA
 * `lushaContactId` en su documentación pasaría la guarda sin cablearlo.
 */
function readCode(relativePath: string): string {
  return readFileSync(join(MODULE_DIR, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('cableado del id nativo de Lusha hasta la petición', () => {
  test('el ejecutor de la pata DECLARA `lushaContactId` en su firma', () => {
    const code = readCode('phone-reveal-waterfall-deps.ts');
    assert.match(
      code,
      /lushaContactId\?: string;/,
      'sin este parámetro el id resuelto se descarta en silencio, que es el fallo de 2a49e0f7',
    );
  });

  test('el ejecutor lo REENVÍA al core del fallback como `resolvedLushaContactId`', () => {
    const code = readCode('phone-reveal-waterfall-deps.ts');
    assert.match(
      code,
      /resolvedLushaContactId:\s*args\.lushaContactId/,
      'declararlo sin reenviarlo dejaría el mismo hueco una capa más abajo',
    );
  });

  test('el core del fallback USA el id inyectado al resolver', () => {
    const code = readCode('lusha-phone-fallback-core.ts');
    assert.match(code, /resolveLushaContactId\(\s*candidate,\s*input\.resolvedLushaContactId/);
  });

  test('el core del waterfall sigue pasando el id que resolvió', () => {
    const code = readCode('phone-reveal-waterfall-core.ts');
    assert.match(code, /lushaContactId:\s*resolvedLushaContactId/);
  });

  /**
   * La prueba EN NEGATIVO de la guarda: si el reenvío desapareciera del fuente, la
   * guarda tiene que fallar. Se comprueba sobre una copia en memoria para no tocar
   * el archivo real.
   */
  test('la guarda falla si el reenvío se borra (prueba en negativo)', () => {
    const mutated = readCode('phone-reveal-waterfall-deps.ts').replace(
      /resolvedLushaContactId:\s*args\.lushaContactId/,
      'resolvedLushaContactId: undefined',
    );
    assert.doesNotMatch(mutated, /resolvedLushaContactId:\s*args\.lushaContactId/);
  });
});

describe('privacidad del diagnóstico, verificada en el fuente', () => {
  test('el módulo del evento no puede emitir campos de PII', () => {
    const code = readCode('phone-reveal-lusha-attempt-diagnostics.ts');
    for (const forbidden of [
      'phoneNumber',
      'contactId',
      'apiKey',
      'linkedinUrl',
      'rawBody',
      'email',
      'fullName',
    ]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `el constructor del evento no puede conocer ${forbidden}`,
      );
    }
  });

  test('el módulo del evento es PURO: sin fetch, sin cliente Supabase, sin flags', () => {
    const code = readCode('phone-reveal-lusha-attempt-diagnostics.ts');
    for (const forbidden of ['fetch(', 'createSupabase', 'process.env', 'import ']) {
      assert.equal(code.includes(forbidden), false, `módulo puro: no puede usar ${forbidden}`);
    }
  });
});
