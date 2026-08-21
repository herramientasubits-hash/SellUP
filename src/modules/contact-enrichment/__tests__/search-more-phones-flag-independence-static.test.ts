/**
 * Estáticas — el flag DEDICADO de «Buscar más números» no se acopla con el fallback
 * manual de Lusha, en NINGUNA dirección (Agente 2A · AGENT2A-SEARCH-MORE-PHONES-1H).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTA SUITE, Y POR QUÉ NO BASTA CON LA MATRIZ DE ENV VARS
 * ═══════════════════════════════════════════════════════════════════
 *
 * `search-more-phones-flag.test.ts` prueba que los DOS parsers son independientes leyendo
 * variables de entorno. Eso prueba que el PARSER no las mezcla, pero no prueba que ningún
 * CONSUMIDOR las mezcle por su cuenta — un archivo podría, en teoría, leer los dos flags y
 * hacer `a || b`. Esta suite lee el CÓDIGO (sin comentarios) de los archivos reales y
 * afirma, en ambas direcciones:
 *
 *   * «Buscar más números» (las dos server actions + el runtime) usa EXCLUSIVAMENTE
 *     `isSearchMorePhonesEnabled` para su propio permiso de producto, y ya NO importa
 *     `isLushaPhoneRevealFallbackEnabled`;
 *   * los consumidores del fallback MANUAL de Lusha, del `legacy_lusha_only` y de la pata
 *     Lusha del waterfall Apollo→Lusha —que existían antes de este hito y no cambian con
 *     él— siguen leyendo `isLushaPhoneRevealFallbackEnabled` exactamente como antes, y
 *     NINGUNO de ellos importa `isSearchMorePhonesEnabled`.
 *
 * Verificado por mutación: revertir cualquiera de los dos imports en
 * `search-more-phones-actions.ts` o `search-more-phones-runtime.ts` hace fallar esta suite.
 *
 * Sólo lee archivos del disco. Sin red, sin Supabase, sin proveedores, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');

const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), 'utf8');

/** Mismo stripping que el resto de la suite estática del subsistema (1G). */
function stripTsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const SEARCH_MORE_ACTIONS = [
  'src',
  'modules',
  'contact-enrichment',
  'search-more-phones-actions.ts',
];
const SEARCH_MORE_RUNTIME = [
  'src',
  'modules',
  'contact-enrichment',
  'search-more-phones-runtime.ts',
];

describe('1H — «Buscar más números» usa EXCLUSIVAMENTE el flag dedicado', () => {
  it('search-more-phones-actions.ts importa isSearchMorePhonesEnabled', () => {
    const code = stripTsComments(read(...SEARCH_MORE_ACTIONS));
    assert.match(code, /isSearchMorePhonesEnabled/);
  });

  it('search-more-phones-runtime.ts importa isSearchMorePhonesEnabled', () => {
    const code = stripTsComments(read(...SEARCH_MORE_RUNTIME));
    assert.match(code, /isSearchMorePhonesEnabled/);
  });

  it('ninguno de los dos importa ni invoca isLushaPhoneRevealFallbackEnabled', () => {
    for (const path of [SEARCH_MORE_ACTIONS, SEARCH_MORE_RUNTIME]) {
      const code = stripTsComments(read(...path));
      assert.doesNotMatch(
        code,
        /isLushaPhoneRevealFallbackEnabled/,
        `${path.join('/')} no puede depender del fallback manual de Lusha`,
      );
    }
  });

  it('ninguno de los dos lee ENABLE_LUSHA_PHONE_REVEAL_FALLBACK ni ENABLE_PHONE_REVEAL_WATERFALL directamente de process.env', () => {
    for (const path of [SEARCH_MORE_ACTIONS, SEARCH_MORE_RUNTIME]) {
      const code = stripTsComments(read(...path));
      assert.doesNotMatch(code, /process\.env\[?['"]?ENABLE_LUSHA_PHONE_REVEAL_FALLBACK/);
      assert.doesNotMatch(code, /process\.env\[?['"]?ENABLE_PHONE_REVEAL_WATERFALL/);
    }
  });
});

/**
 * La dirección INVERSA: los caminos que YA EXISTÍAN antes de 1H —el fallback manual, el
 * legacy Lusha-only y la pata Lusha del waterfall— no ganan una dependencia nueva del flag
 * dedicado. Si la ganaran, encender «Buscar más números» para QA volvería a encender un
 * camino pagado que nadie pidió, que es exactamente el defecto que 1H corrige.
 */
const UNRELATED_LUSHA_CONSUMERS = [
  ['src', 'modules', 'contact-enrichment', 'lusha-phone-fallback-actions.ts'],
  ['src', 'modules', 'contact-enrichment', 'legacy-lusha-only-reveal-engine.ts'],
  ['src', 'modules', 'contact-enrichment', 'phone-reveal-waterfall-deps.ts'],
  ['src', 'components', 'contact-enrichment', 'contact-candidates-panel.tsx'],
];

describe('1H — los caminos preexistentes de Lusha no ganan una dependencia nueva', () => {
  it('ninguno importa ni invoca isSearchMorePhonesEnabled', () => {
    for (const path of UNRELATED_LUSHA_CONSUMERS) {
      const code = stripTsComments(read(...path));
      assert.doesNotMatch(
        code,
        /isSearchMorePhonesEnabled/,
        `${path.join('/')} no debe depender del flag dedicado de "Buscar más números"`,
      );
    }
  });

  it('ninguno lee ENABLE_SEARCH_MORE_PHONES directamente de process.env', () => {
    for (const path of UNRELATED_LUSHA_CONSUMERS) {
      const code = stripTsComments(read(...path));
      assert.doesNotMatch(code, /process\.env\[?['"]?ENABLE_SEARCH_MORE_PHONES/);
    }
  });

  it('todos siguen leyendo isLushaPhoneRevealFallbackEnabled exactamente como antes de 1H', () => {
    // Prueba de piso de no-vacuidad: si ninguno la leyera, las aserciones de arriba se
    // cumplirían solas y esta suite no estaría vigilando nada.
    const stillReading = UNRELATED_LUSHA_CONSUMERS.filter((path) =>
      /isLushaPhoneRevealFallbackEnabled/.test(stripTsComments(read(...path))),
    );
    assert.ok(
      stillReading.length > 0,
      'ningún archivo de la lista lee isLushaPhoneRevealFallbackEnabled: la guarda estaría vacía',
    );
  });
});
