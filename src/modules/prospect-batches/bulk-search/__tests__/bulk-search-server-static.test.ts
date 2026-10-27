/**
 * Búsqueda masiva · servidor (PR 2) — contrato ESTÁTICO: quién puede, que la
 * corrida del asistente no cambió y que cada ruta pasa por la misma puerta.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

const SERVICE = read('modules/prospect-batches/bulk-search/bulk-search-service.server.ts');
const ROUTES = [
  'app/api/prospect-batches/bulk-searches/route.ts',
  'app/api/prospect-batches/bulk-searches/[id]/round/route.ts',
  'app/api/prospect-batches/bulk-searches/[id]/control/route.ts',
].map((path) => [path, read(path)] as const);

describe('quién puede', () => {
  it('Growth o admin, con la bandera encendida, sin depender de ENABLE_ROLE_CAPABILITIES', () => {
    assert.ok(SERVICE.includes('isGrowthBulkSearchEnabled()'));
    assert.ok(SERVICE.includes('!access.isAdmin && !isGrowthRole(access.roleKey)'));
    assert.equal(SERVICE.includes('checkCapability('), false, 'checkCapability se abre a todos con su bandera apagada');
  });

  it('cada ruta pasa por la puerta antes de hacer nada', () => {
    for (const [path, source] of ROUTES) {
      const gate = source.indexOf('await resolveBulkSearchAccess()');
      assert.ok(gate > 0, `${path} no pasa por la puerta`);
      for (const action of ['ForUser(', 'safeParse(']) {
        const use = source.indexOf(action);
        if (use > 0) assert.ok(gate < use, `${path}: la puerta va antes de ${action}`);
      }
    }
  });

  it('todas las lecturas y escrituras filtran por la persona en sesión', () => {
    for (const fn of ['findLiveSearch', 'loadSearch', 'applyControl', 'listSearches']) {
      const start = SERVICE.indexOf(`${fn}: async`);
      const body = SERVICE.slice(start, SERVICE.indexOf('\n    },', start));
      assert.ok(body.includes(".eq('created_by', userId)"), `${fn} no filtra por created_by`);
    }
  });
});

describe('la corrida normal no cambió', () => {
  it('el esquema del asistente sigue sin campo de cantidad', () => {
    const schema = read('modules/prospect-batches/chat-wizard-execution/wizard-execution-schema.ts');
    for (const field of ['targetCount:', 'requestedCount:', 'bulkTargetCount:']) {
      assert.equal(schema.includes(field), false, `wizardExecutionRequestSchema ganó ${field}`);
    }
  });

  it('cada ronda llama a la corrida normal tal cual', () => {
    assert.ok(SERVICE.includes('runWizard: (request) => executeProspectWizardGenerationAction(request)'));
  });

  it('la ronda tiene el mismo tiempo que una corrida', () => {
    const round = ROUTES.find(([path]) => path.includes('/round/'))![1];
    assert.ok(round.includes('export const maxDuration = 300;'));
  });
});

describe('gasto', () => {
  it('solo Apollo y Lusha cuentan contra el tope pagado', () => {
    assert.ok(SERVICE.includes("const PAID_PROVIDER_KEYS = ['apollo', 'lusha'];"));
  });

  it('el cambio de estado al terminar no pisa una pausa ni una cancelación', () => {
    const start = SERVICE.indexOf('writeProgress: async');
    const body = SERVICE.slice(start, SERVICE.indexOf('releaseLease: async', start));
    assert.ok(body.includes(".eq('status', 'running')"));
    assert.ok(body.includes(".eq('lease_token', leaseToken)"));
  });
});
