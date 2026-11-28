/**
 * «Mis créditos» — candados estáticos de la server action.
 * Cualquiera con sesión puede invocarla desde el navegador: nunca debe aceptar un
 * usuario como parámetro ni leer otra identidad que la de la sesión.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/modules/my-credits/actions.ts'), 'utf8');

describe('getMyCreditUsage — candados', () => {
  it('es una server action', () => {
    assert.match(SRC, /^'use server';/);
  });

  it('no recibe parámetros', () => {
    assert.match(SRC, /export async function getMyCreditUsage\(\): Promise</);
  });

  it('exporta solo getMyCreditUsage', () => {
    const exported = [...SRC.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(exported, ['getMyCreditUsage']);
  });

  it('la identidad sale de la sesión activa', () => {
    assert.match(SRC, /getCurrentActiveUser\(\)/);
    assert.match(SRC, /checkBudget\(providerKey, me\.id\)/);
    assert.match(SRC, /\.eq\('triggered_by', me\.id\)/);
  });

  it('muestra solo lo gastado: no suma lo reservado por revelados en curso', () => {
    assert.match(SRC, /poolCredits: check\.consumedCredits,/);
    assert.doesNotMatch(SRC, /reservedCredits\s*[+,]/);
    assert.doesNotMatch(SRC, /projectedCredits/);
  });
});
