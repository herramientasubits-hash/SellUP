// Tests for isSearchMorePhonesEnabled in feature-flags.server.ts
// (Agente 2A · AGENT2A-SEARCH-MORE-PHONES-1H). Node.js built-in test runner.
//
// `ENABLE_SEARCH_MORE_PHONES` es el flag DEDICADO de rollout de «Buscar más números»,
// deliberadamente separado de `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK` (el kill switch del
// fallback MANUAL de Lusha, que hasta 1G esta operación reutilizaba). Esta suite prueba
// DOS cosas distintas:
//
//   1. el parser canónico del flag nuevo, igual que cualquier otro flag del módulo;
//   2. la matriz de independencia CASO A/B/C/D: activar uno de los dos flags nunca
//      resuelve el otro como activo. El CASO C es la prueba crítica del hito —
//      `ENABLE_SEARCH_MORE_PHONES=true` con el fallback de Lusha OFF tiene que bastar.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const SEARCH_MORE_KEY = 'ENABLE_SEARCH_MORE_PHONES';
const LUSHA_FALLBACK_KEY = 'ENABLE_LUSHA_PHONE_REVEAL_FALLBACK';

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const saved = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
}

function withEnvPair(
  searchMore: string | undefined,
  lushaFallback: string | undefined,
  fn: () => void,
) {
  withEnv(SEARCH_MORE_KEY, searchMore, () => {
    withEnv(LUSHA_FALLBACK_KEY, lushaFallback, fn);
  });
}

import {
  isLushaPhoneRevealFallbackEnabled,
  isSearchMorePhonesEnabled,
  isSearchMorePhonesFlagConfigured,
  SEARCH_MORE_PHONES_FLAG,
} from '../feature-flags.server';

describe('isSearchMorePhonesEnabled — parser canónico', () => {
  test('env absent → false (fail-closed)', () => {
    withEnv(SEARCH_MORE_KEY, undefined, () => {
      assert.equal(isSearchMorePhonesEnabled(), false);
    });
  });

  test('"false" → false', () => {
    withEnv(SEARCH_MORE_KEY, 'false', () => {
      assert.equal(isSearchMorePhonesEnabled(), false);
    });
  });

  test('"true" → true', () => {
    withEnv(SEARCH_MORE_KEY, 'true', () => {
      assert.equal(isSearchMorePhonesEnabled(), true);
    });
  });

  test('"TRUE" → true (case-insensitive)', () => {
    withEnv(SEARCH_MORE_KEY, 'TRUE', () => {
      assert.equal(isSearchMorePhonesEnabled(), true);
    });
  });

  test('" true " → true (whitespace-tolerant)', () => {
    withEnv(SEARCH_MORE_KEY, ' true ', () => {
      assert.equal(isSearchMorePhonesEnabled(), true);
    });
  });

  test('"1" → false (not the canonical token)', () => {
    withEnv(SEARCH_MORE_KEY, '1', () => {
      assert.equal(isSearchMorePhonesEnabled(), false);
    });
  });

  test('"" → false (empty string)', () => {
    withEnv(SEARCH_MORE_KEY, '', () => {
      assert.equal(isSearchMorePhonesEnabled(), false);
    });
  });

  test('flag name constant matches expected env var', () => {
    assert.equal(SEARCH_MORE_PHONES_FLAG, 'ENABLE_SEARCH_MORE_PHONES');
  });
});

describe('isSearchMorePhonesFlagConfigured — presencia, nunca el valor', () => {
  test('ausente → false', () => {
    withEnv(SEARCH_MORE_KEY, undefined, () => {
      assert.equal(isSearchMorePhonesFlagConfigured(), false);
    });
  });

  test('presente pero no "true" → true (configurado, aunque apagado)', () => {
    withEnv(SEARCH_MORE_KEY, 'false', () => {
      assert.equal(isSearchMorePhonesFlagConfigured(), true);
    });
  });

  test('vacío → false', () => {
    withEnv(SEARCH_MORE_KEY, '   ', () => {
      assert.equal(isSearchMorePhonesFlagConfigured(), false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Matriz de independencia — CASO A/B/C/D (AGENT2A-SEARCH-MORE-PHONES-1H § 7)
// ═══════════════════════════════════════════════════════════════════
//
// Los dos flags leen variables de entorno DISTINTAS y sin relación de código entre sí
// (ningún OR, ningún fallback del uno al otro): esta matriz lo hace explícito para que
// una futura "simplificación" que los junte con un `||` falle aquí primero.

describe('independencia de ENABLE_SEARCH_MORE_PHONES y ENABLE_LUSHA_PHONE_REVEAL_FALLBACK', () => {
  test('CASO A — ambos false ⇒ ambos resuelven inactivos', () => {
    withEnvPair('false', 'false', () => {
      assert.equal(isSearchMorePhonesEnabled(), false);
      assert.equal(isLushaPhoneRevealFallbackEnabled(), false);
    });
  });

  test('CASO B — search_more=false, lusha_fallback=true ⇒ «Buscar más números» sigue apagado', () => {
    withEnvPair('false', 'true', () => {
      assert.equal(
        isSearchMorePhonesEnabled(),
        false,
        'el fallback de Lusha activo no debe encender "Buscar más números"',
      );
      assert.equal(isLushaPhoneRevealFallbackEnabled(), true);
    });
  });

  test('CASO C (la prueba crítica) — search_more=true, lusha_fallback=false ⇒ «Buscar más números» SÍ resuelve activo', () => {
    withEnvPair('true', 'false', () => {
      assert.equal(
        isSearchMorePhonesEnabled(),
        true,
        '"Buscar más números" debe poder activarse sin el fallback manual de Lusha',
      );
      assert.equal(
        isLushaPhoneRevealFallbackEnabled(),
        false,
        'activar "Buscar más números" no debe encender el fallback manual de Lusha',
      );
    });
  });

  test('CASO D — ambos true ⇒ ambos resuelven activos, sin acoplarse entre sí', () => {
    withEnvPair('true', 'true', () => {
      assert.equal(isSearchMorePhonesEnabled(), true);
      assert.equal(isLushaPhoneRevealFallbackEnabled(), true);
    });
  });

  test('activar el fallback de Lusha con cualquier valor no muta la lectura del otro flag', () => {
    for (const lushaValue of ['true', 'false', undefined, '1', 'TRUE']) {
      withEnvPair('false', lushaValue, () => {
        assert.equal(isSearchMorePhonesEnabled(), false, `lusha=${lushaValue}`);
      });
    }
  });

  test('activar «Buscar más números» con cualquier valor no muta la lectura del fallback', () => {
    for (const searchMoreValue of ['true', 'false', undefined, '1', 'TRUE']) {
      withEnvPair(searchMoreValue, 'false', () => {
        assert.equal(
          isLushaPhoneRevealFallbackEnabled(),
          false,
          `search_more=${searchMoreValue}`,
        );
      });
    }
  });
});
