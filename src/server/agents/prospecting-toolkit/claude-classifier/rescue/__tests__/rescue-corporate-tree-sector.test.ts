// Prod 24-11 (Grupo Aval d2bb643b): el rescate encontró avvillas.com.co para Banco AV Villas,
// pero sin sector pedido (búsqueda en árbol) y sin tamaño ni LinkedIn la dejó en Descartadas.
// En el árbol vale el parentesco con el grupo: un sector sin confirmar no la frena.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideRescue } from '../rescue-decision';
import type { CompanyClassificationResult } from '../../types';


function unclear(overrides: Partial<CompanyClassificationResult> = {}): CompanyClassificationResult {
  return {
    candidateId: 'c1',
    outcome: 'partially_classified',
    sector: null,
    employeeRange: null,
    rejected: [],
    isOperatingCompany: true,
    pageFinalUrl: 'https://www.avvillas.com.co/',
    usage: null,
    errorCode: null,
    durationMs: 10,
    pageSource: 'own_fetch',
    ...overrides,
  } as CompanyClassificationResult;
}

describe('rescate en el árbol: sin sector pedido', () => {
  it('fuera del árbol, sin sector ni tamaño ni LinkedIn ⇒ se queda (como siempre)', () => {
    assert.equal(decideRescue(unclear(), { icpMinEmployees: 200 }).kind, 'unchanged');
  });

  it('en el árbol ⇒ pasa (sin sector ni tamaño confirmados)', () => {
    const d = decideRescue(unclear(), { icpMinEmployees: 200, sectorNotRequested: true });
    assert.deepEqual(d, { kind: 'admit', sectorConfirmed: false, sizeConfirmed: false, linkedinConfirmed: false });
  });

  it('en el árbol, un tamaño COMPROBADO bajo el mínimo sigue descartando', () => {
    const d = decideRescue(
      unclear({
        employeeRange: {
          min: 11,
          max: 50,
          quote: 'De 11 a 50 empleados',
          sourceUrl: 'https://www.avvillas.com.co/',
          confidence: 0.95,
          verification: 'quote_verified',
          status: 'estimated',
        },
      }),
      { icpMinEmployees: 200, sectorNotRequested: true },
    );
    assert.equal(d.kind, 'discard');
  });

  it('nada que comprobar en la web ⇒ no pasa ni en el árbol', () => {
    const d = decideRescue(unclear({ outcome: 'nothing_verifiable' }), { icpMinEmployees: 200, sectorNotRequested: true });
    assert.equal(d.kind, 'unchanged');
  });

  it('el rescate de Descartadas lo usa sólo en el árbol, sin industria pedida y con la web encontrada', () => {
    const source = readFileSync(join(__dirname, '../rescue-batch.ts'), 'utf8');
    assert.match(source, /const treeOwnWebsite = isCorporateTreeRun\(ctx\) && !ctx\.requestedIndustry && !!found;/);
    assert.match(source, /\.\.\.\(treeOwnWebsite \? \{ sectorNotRequested: true \} : \{\}\)/);
    assert.match(source, /sizeOnlyRescued \|\| treeOwnWebsite/);
  });

  it('Multibank (Prod 24-11): una ficha de HubSpot LIBRE puede entrar; decide el chequeo de duplicados', () => {
    // HubSpot 1106135172 (multibank.com.pa): sin actividad de venta desde 07-2025 ⇒ libre para
    // prospectar. Una regla «si el árbol la vio en HubSpot, no entra» la frenaba igual (revertida).
    const source = readFileSync(join(__dirname, '../rescue-batch.ts'), 'utf8');
    assert.doesNotMatch(source, /treeHubSpotDomains|withTreeHubSpotMatch/);
  });

  it('un árbol sin webs del grupo también cuenta como árbol (lo lee del lote)', () => {
    const source = readFileSync(join(__dirname, '../rescue-batch.ts'), 'utf8');
    assert.match(source, /return ctx\.corporateTree === true \|\| \(ctx\.groupDomains\?\.size \?\? 0\) > 0;/);
    const server = readFileSync(join(__dirname, '../rescue-batch.server.ts'), 'utf8');
    assert.match(server, /metadata\.search_mode === 'corporate_tree' \|\| !!metadata\.corporate_tree/);
  });
});
