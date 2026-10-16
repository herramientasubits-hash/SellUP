/**
 * AGENT1-SEARCH-AUDIT-1 — tras una respuesta del servidor, el próximo «Generar
 * prospectos» usa un clientRequestId NUEVO.
 *
 * Antes: «Editar búsqueda» (o reintentar tras un fallo) conservaba el id. El
 * servidor corría otra vez la capa gratuita con los criterios nuevos contra el
 * lote VIEJO y devolvía `already_started` («Esta búsqueda ya había sido
 * iniciada»): la búsqueda corregida nunca corría. Sólo «Proveedores» rotaba el id.
 *
 * Lectura del fuente (el resto de pruebas del asistente ya fijan así el contrato
 * del id): no monta React ni llama al servidor.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WIZARD_SOURCE = readFileSync(
  join(process.cwd(), 'src/components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx'),
  'utf-8',
);
const EXECUTE = WIZARD_SOURCE.slice(
  WIZARD_SOURCE.indexOf('async function handleExecute()'),
  WIZARD_SOURCE.indexOf("type: 'EXECUTION_FAILED',"),
);

describe('rotación del clientRequestId tras ejecutar', () => {
  it('se rota justo después de la respuesta del servidor, antes de despachar éxito o fallo', () => {
    const awaited = EXECUTE.indexOf('const result = await execute({');
    const rotated = EXECUTE.indexOf('clientRequestIdRef.current = crypto.randomUUID();', awaited);
    const firstDispatch = EXECUTE.indexOf("type: 'EXECUTION_SUCCEEDED'");
    assert.ok(awaited > 0, 'handleExecute espera la respuesta');
    assert.ok(rotated > awaited, 'el id se rota después de la respuesta');
    assert.ok(rotated < firstDispatch, 'y antes de despachar el resultado');
  });

  it('la rotación vale para todos los modos, no sólo «Proveedores»', () => {
    assert.doesNotMatch(
      EXECUTE,
      /if \(supplierReference && result\.code === 'GENERATION_FAILED'\) \{\s*clientRequestIdRef\.current = crypto\.randomUUID\(\);/,
    );
  });

  it('el id rotado nunca es null: «Generar prospectos» sigue funcionando sin revalidar', () => {
    assert.doesNotMatch(EXECUTE, /clientRequestIdRef\.current = null;/);
  });

  it('un fallo de red (catch) NO rota el id: la corrida puede seguir viva en el servidor', () => {
    const catchBlock = WIZARD_SOURCE.slice(WIZARD_SOURCE.indexOf('    } catch {', WIZARD_SOURCE.indexOf('async function handleExecute()')));
    const catchBody = catchBlock.slice(0, catchBlock.indexOf('\n    }\n'));
    assert.doesNotMatch(catchBody, /clientRequestIdRef\.current =/);
  });
});
