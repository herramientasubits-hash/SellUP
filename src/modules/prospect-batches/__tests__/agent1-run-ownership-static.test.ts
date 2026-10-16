/**
 * AGENT1-AUDIT-WS1 — las corridas del Agente 1 sólo las continúa o termina
 * quien las creó.
 *
 * La RLS de `prospect_batches` deja ver los lotes a CUALQUIER usuario activo
 * (migración 040), así que «la persona puede ver el lote» no autoriza nada:
 *   · la bandeja de A descubría y reanudaba —gastando— la corrida de B;
 *   · cualquiera podía «Terminar» la corrida de otra persona.
 * Las tres puertas filtran ahora por `created_by` = usuario interno actual,
 * con el cliente de la PERSONA y ANTES de usar el cliente de servicio.
 *
 * Guarda estática (sin sesión ni base): el código de esas puertas es de
 * servidor con `requireActiveUser`/cookies y no se puede ejecutar aislado sin
 * mockear módulos, que este repo evita (Node 24 ignora `namedExports`).
 *
 * Correr: node --import tsx --test src/modules/prospect-batches/__tests__/agent1-run-ownership-static.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  const code = readFileSync(path.join(process.cwd(), rel), 'utf8');
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** El cuerpo de una función exportada, hasta la siguiente `export`. */
function body(code: string, fnName: string): string {
  const start = code.indexOf(`export async function ${fnName}(`);
  assert.ok(start >= 0, `falta ${fnName}`);
  const next = code.indexOf('\nexport ', start + 1);
  return code.slice(start, next < 0 ? undefined : next);
}

/** La consulta a `prospect_batches` (hasta su `;`) filtra por `created_by` con el id interno. */
function assertOwnedBatchQuery(src: string, label: string) {
  const at = src.indexOf("from('prospect_batches')");
  assert.ok(at >= 0, `${label}: debe leer el lote`);
  const statement = src.slice(at, src.indexOf(';', at));
  assert.match(statement, /\.eq\('created_by', internalUserId\)/, `${label}: sólo lotes propios`);
}

describe('continuación de Apollo — sólo lotes propios', () => {
  const code = read('src/modules/prospect-batches/apollo-continuation-actions.ts');

  it('continueApolloRound: el lote tiene que ser de quien lo pide', () => {
    const fn = body(code, 'continueApolloRound');
    assert.match(fn, /const \{ internalUserId \} = await requireActiveUser\(\)/);
    assertOwnedBatchQuery(fn, 'continueApolloRound');
    const owned = fn.indexOf("from('prospect_batches')");
    const runs = fn.indexOf('runApolloRoundContinuationWorkerFromEnv(');
    assert.ok(owned > 0 && runs > owned, 'primero la propiedad, después el conductor');
  });

  it('findPendingApolloContinuation: la bandeja sólo ofrece corridas propias', () => {
    const fn = body(code, 'findPendingApolloContinuation');
    assert.match(fn, /const \{ internalUserId \} = await requireActiveUser\(\)/);
    assertOwnedBatchQuery(fn, 'findPendingApolloContinuation');
  });
});

describe('«Terminar» — sólo lotes propios', () => {
  it('finish-run filtra por created_by antes del cliente de servicio', () => {
    const route = read('src/app/api/prospect-batches/finish-run/route.ts');
    assertOwnedBatchQuery(route, 'finish-run');
    const owned = route.indexOf("from('prospect_batches')");
    const service = route.indexOf('createSupabaseAdminClient()');
    assert.ok(owned > 0 && service > owned, 'primero la propiedad, después el servicio');
  });
});
