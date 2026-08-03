// Tests for isPhoneRevealWaterfallEnabled in feature-flags.server.ts
// (Agente 2A · AGENT2A-PHONE-WATERFALL-1). Node.js built-in test runner.
//
// El punto crítico: este flag AUTOMATIZA cuándo corre el fallback Lusha, no lo
// autoriza. `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK` sigue siendo el kill switch, y el
// ban duro `isLushaPhoneRevealEnabled(): false` del cliente V3 email-only no se
// debilita en ningún estado de este flag.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isLushaPhoneRevealEnabled,
  isLushaPhoneRevealFallbackEnabled,
  isPhoneRevealWaterfallEnabled,
  PHONE_REVEAL_WATERFALL_FLAG,
} from '../feature-flags.server';

const ENV_KEY = 'ENABLE_PHONE_REVEAL_WATERFALL';
const LUSHA_FALLBACK_ENV_KEY = 'ENABLE_LUSHA_PHONE_REVEAL_FALLBACK';

function withEnv(
  entries: Record<string, string | undefined>,
  fn: () => void,
): void {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(entries)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('isPhoneRevealWaterfallEnabled — parser fail-closed', () => {
  test('env ausente → false (default de producción)', () => {
    withEnv({ [ENV_KEY]: undefined }, () => {
      assert.equal(isPhoneRevealWaterfallEnabled(), false);
    });
  });

  test('"true" → true; "TRUE" y " true " también (case/whitespace tolerante)', () => {
    for (const value of ['true', 'TRUE', ' true ', 'True']) {
      withEnv({ [ENV_KEY]: value }, () => {
        assert.equal(isPhoneRevealWaterfallEnabled(), true, value);
      });
    }
  });

  test('cualquier valor que no sea el token canónico → false', () => {
    for (const value of ['false', '1', 'yes', 'on', 'enabled', '', '  ', 'truthy']) {
      withEnv({ [ENV_KEY]: value }, () => {
        assert.equal(isPhoneRevealWaterfallEnabled(), false, JSON.stringify(value));
      });
    }
  });

  test('la constante del flag coincide con el nombre real de la env var', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_FLAG, 'ENABLE_PHONE_REVEAL_WATERFALL');
  });

  test('NO es un flag NEXT_PUBLIC (no puede resolverse en el cliente)', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_FLAG.startsWith('NEXT_PUBLIC'), false);
  });
});

describe('isPhoneRevealWaterfallEnabled — no debilita los candados de Lusha', () => {
  test('el ban duro del cliente V3 email-only sigue en false con el waterfall ON', () => {
    withEnv({ [ENV_KEY]: 'true' }, () => {
      assert.equal(isLushaPhoneRevealEnabled(), false);
    });
  });

  test('el waterfall ON no enciende el fallback Lusha: son flags independientes', () => {
    withEnv({ [ENV_KEY]: 'true', [LUSHA_FALLBACK_ENV_KEY]: undefined }, () => {
      assert.equal(isPhoneRevealWaterfallEnabled(), true);
      // El kill switch real sigue apagado: sin él no hay pata Lusha posible.
      assert.equal(isLushaPhoneRevealFallbackEnabled(), false);
    });
  });

  test('el fallback Lusha ON no enciende el waterfall', () => {
    withEnv({ [ENV_KEY]: undefined, [LUSHA_FALLBACK_ENV_KEY]: 'true' }, () => {
      assert.equal(isLushaPhoneRevealFallbackEnabled(), true);
      assert.equal(isPhoneRevealWaterfallEnabled(), false);
    });
  });
});
