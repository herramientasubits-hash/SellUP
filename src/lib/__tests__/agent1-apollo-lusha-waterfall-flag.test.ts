/**
 * agent1-apollo-lusha-waterfall-flag.test.ts
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 4 — la bandera del waterfall.
 *
 * Fija tres cosas:
 *   · sólo el token exacto `true` la enciende (fail-closed);
 *   · ausente ⇒ APAGADA, que es su estado en todos los entornos de este hito;
 *   · encenderla NO mueve las banderas de los proveedores. La bandera automatiza
 *     CUÁNDO corre la pierna Lusha; no autoriza a Lusha, que sigue detrás de
 *     `ENABLE_LUSHA_PREVIEW`, ni toca el interruptor de Apollo.
 *
 * 0 red · 0 proveedores · 0 Producción.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT1_APOLLO_LUSHA_WATERFALL_FLAG,
  isAgent1ApolloLushaWaterfallEnabled,
  isAgent1ApolloLushaWaterfallFlagConfigured,
  isLushaPreviewEnabled,
  isApolloCompanySearchEnabled,
} from '../feature-flags.server';

/** Fija varias variables, corre, y restaura exactamente lo que había. */
function withEnv(entries: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(entries)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('bandera del waterfall Apollo → Lusha', () => {
  test('el nombre de la constante ES el nombre de la variable', () => {
    assert.equal(AGENT1_APOLLO_LUSHA_WATERFALL_FLAG, 'ENABLE_AGENT1_APOLLO_LUSHA_WATERFALL');
  });

  test('no es una variable pública: nunca viaja al cliente', () => {
    assert.equal(AGENT1_APOLLO_LUSHA_WATERFALL_FLAG.startsWith('NEXT_PUBLIC'), false);
  });

  test('ausente ⇒ apagada', () => {
    withEnv({ [AGENT1_APOLLO_LUSHA_WATERFALL_FLAG]: undefined }, () => {
      assert.equal(isAgent1ApolloLushaWaterfallEnabled(), false);
      assert.equal(isAgent1ApolloLushaWaterfallFlagConfigured(), false);
    });
  });

  test('sólo el token exacto `true` la enciende', () => {
    for (const raw of ['true', 'TRUE', ' true ', 'True']) {
      withEnv({ [AGENT1_APOLLO_LUSHA_WATERFALL_FLAG]: raw }, () => {
        assert.equal(isAgent1ApolloLushaWaterfallEnabled(), true, `"${raw}" debería encenderla`);
      });
    }
  });

  test('cualquier otro token la deja apagada', () => {
    for (const raw of ['false', '1', 'yes', 'on', 'enabled', '', '  ', 'truthy']) {
      withEnv({ [AGENT1_APOLLO_LUSHA_WATERFALL_FLAG]: raw }, () => {
        assert.equal(isAgent1ApolloLushaWaterfallEnabled(), false, `"${raw}" NO debería encenderla`);
      });
    }
  });

  test('«configurada» y «encendida» son preguntas distintas', () => {
    withEnv({ [AGENT1_APOLLO_LUSHA_WATERFALL_FLAG]: 'false' }, () => {
      assert.equal(isAgent1ApolloLushaWaterfallFlagConfigured(), true, 'existe');
      assert.equal(isAgent1ApolloLushaWaterfallEnabled(), false, 'pero dice que no');
    });
  });

  test('encenderla no enciende a ningún proveedor', () => {
    withEnv(
      {
        [AGENT1_APOLLO_LUSHA_WATERFALL_FLAG]: 'true',
        ENABLE_LUSHA_PREVIEW: undefined,
        ENABLE_APOLLO_COMPANY_SEARCH: undefined,
      },
      () => {
        assert.equal(isAgent1ApolloLushaWaterfallEnabled(), true);
        assert.equal(isLushaPreviewEnabled(), false, 'Lusha sigue detrás de su propia bandera');
        assert.equal(isApolloCompanySearchEnabled(), false, 'y Apollo detrás de la suya');
      },
    );
  });

  test('apagarla no apaga a los proveedores', () => {
    withEnv(
      {
        [AGENT1_APOLLO_LUSHA_WATERFALL_FLAG]: 'false',
        ENABLE_LUSHA_PREVIEW: 'true',
      },
      () => {
        assert.equal(isAgent1ApolloLushaWaterfallEnabled(), false);
        assert.equal(isLushaPreviewEnabled(), true, 'la pierna manual de Lusha sigue disponible');
      },
    );
  });
});
