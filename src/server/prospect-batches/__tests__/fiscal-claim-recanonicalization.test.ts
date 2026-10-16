/**
 * AUDIT-HARDENING-1 — poner al día las claves fiscales guardadas con la forma vieja.
 *
 * Puro: sin red ni base. Verifica el plan (qué se actualiza, qué choca, qué se
 * deja) y que la aplicación sólo escribe los `update`, de uno en uno y sin lanzar.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeChileRutCheckDigit,
  computeParaguayRucCheckDigit,
} from '@/server/agents/prospecting-toolkit/fiscal-identity';
import {
  applyFiscalClaimRecanonicalization,
  fiscalClaimKeyCountry,
  planFiscalClaimRecanonicalization,
  type ActiveFiscalClaim,
  type ClaimCandidateFacts,
} from '../fiscal-claim-recanonicalization';

function candidates(...list: ClaimCandidateFacts[]): Map<string, ClaimCandidateFacts> {
  return new Map(list.map((c) => [c.id, c]));
}
const claim = (id: string, candidateId: string, claimKey: string): ActiveFiscalClaim => ({ id, candidateId, claimKey });
const fact = (id: string, countryCode: string | null, taxIdentifier: string | null, taxId: string | null = null): ClaimCandidateFacts => ({
  id,
  countryCode,
  taxId,
  taxIdentifier,
});

describe('fiscalClaimKeyCountry', () => {
  it('lee el país de la clave', () => {
    assert.equal(fiscalClaimKeyCountry('CO:900123456'), 'CO');
    assert.equal(fiscalClaimKeyCountry('co:9'), 'CO');
    assert.equal(fiscalClaimKeyCountry('sin-pais'), null);
  });
});

describe('plan — Colombia: NIT con el dígito pegado', () => {
  it('la clave vieja con el DV pegado pasa a la canónica de hoy', () => {
    // 890.903.938-8 (DV 8): el escritor viejo guardó el 10.º dígito dentro de la clave.
    const plan = planFiscalClaimRecanonicalization(
      [claim('c1', 'k1', 'CO:8909039388')],
      candidates(fact('k1', 'CO', '890.903.938-8')),
    );
    assert.deepEqual(plan.items[0], { action: 'update', claimId: 'c1', candidateId: 'k1', from: 'CO:8909039388', to: 'CO:890903938' });
    assert.equal(plan.summary.update, 1);
  });

  it('una clave que ya es la canónica queda igual', () => {
    const plan = planFiscalClaimRecanonicalization(
      [claim('c1', 'k1', 'CO:890903938')],
      candidates(fact('k1', 'CO', '890903938-8')),
    );
    assert.equal(plan.items[0].action, 'unchanged');
    assert.equal(plan.summary.update, 0);
  });
});

describe('plan — Chile y Paraguay: sin dígito de verificación', () => {
  it('RUT de persona jurídica sin DV → cuerpo + DV', () => {
    const dv = computeChileRutCheckDigit('76086428').toLowerCase();
    const plan = planFiscalClaimRecanonicalization(
      [claim('c1', 'k1', 'CL:76086428')],
      candidates(fact('k1', 'CL', `76.086.428-${dv}`)),
    );
    const item = plan.items[0];
    assert.equal(item.action, 'update');
    if (item.action === 'update') assert.equal(item.to, `CL:76086428${dv}`);
  });

  it('RUC 80xxxxxx sin DV → cuerpo + DV', () => {
    const dv = computeParaguayRucCheckDigit('80000005');
    const plan = planFiscalClaimRecanonicalization(
      [claim('c1', 'k1', 'PY:80000005')],
      candidates(fact('k1', 'PY', `80000005-${dv}`)),
    );
    const item = plan.items[0];
    assert.equal(item.action, 'update');
    if (item.action === 'update') assert.equal(item.to, `PY:80000005${dv}`);
  });
});

describe('plan — lo que NO se toca', () => {
  it('sin candidato, sin país, país distinto, columnas en conflicto o sin identidad fiscal: se salta con su motivo', () => {
    const plan = planFiscalClaimRecanonicalization(
      [
        claim('c1', 'falta', 'CO:890903938'),
        claim('c2', 'k2', 'CO:890903938'),
        claim('c3', 'k3', 'CO:890903938'),
        claim('c4', 'k4', 'CO:890903938'),
        claim('c5', 'k5', 'CO:890903938'),
      ],
      candidates(
        fact('k2', null, '890903938'),
        fact('k3', 'MX', 'ABC123456AB1'),
        fact('k4', 'CO', '890903938', '900123456'),
        fact('k5', 'CO', null),
      ),
    );
    assert.deepEqual(
      plan.items.map((i) => (i.action === 'skip' ? i.reason : i.action)),
      ['candidate_not_found', 'no_country_scope', 'country_mismatch', 'fiscal_columns_conflict', 'no_fiscal_identity'],
    );
    assert.equal(plan.summary.skip, 5);
  });
});

describe('plan — colisiones', () => {
  it('si la clave nueva ya la tiene OTRO candidato, es una doble reclamación: se informa, no se resuelve', () => {
    const plan = planFiscalClaimRecanonicalization(
      [claim('c1', 'k1', 'CO:8909039388'), claim('c2', 'k2', 'CO:890903938')],
      candidates(fact('k1', 'CO', '890903938-8'), fact('k2', 'CO', '890903938')),
    );
    const collision = plan.items[0];
    assert.equal(collision.action, 'collision');
    if (collision.action === 'collision') {
      assert.equal(collision.heldByCandidateId, 'k2');
      assert.equal(collision.sameCandidate, false);
    }
    assert.equal(plan.summary.collisionOtherCandidate, 1);
    assert.equal(plan.summary.update, 0);
  });

  it('si la tiene el MISMO candidato, el reclamo viejo sobra pero no se toca', () => {
    const plan = planFiscalClaimRecanonicalization(
      [claim('c1', 'k1', 'CO:8909039388'), claim('c2', 'k1', 'CO:890903938')],
      candidates(fact('k1', 'CO', '890903938-8')),
    );
    const item = plan.items[0];
    assert.equal(item.action, 'collision');
    if (item.action === 'collision') assert.equal(item.sameCandidate, true);
    assert.equal(plan.summary.collisionOtherCandidate, 0);
  });

  it('dos reclamos viejos que querrían la misma clave nueva: el primero la toma, el segundo choca', () => {
    const plan = planFiscalClaimRecanonicalization(
      [claim('c1', 'k1', 'CO:8909039388'), claim('c2', 'k2', 'CO:8909039380')],
      candidates(fact('k1', 'CO', '890903938-8'), fact('k2', 'CO', '890.903.938')),
    );
    assert.deepEqual(plan.items.map((i) => i.action), ['update', 'collision']);
  });
});

describe('aplicación', () => {
  const plan = planFiscalClaimRecanonicalization(
    [claim('c1', 'k1', 'CO:8909039388'), claim('c2', 'k2', 'CO:890903938-x'), claim('c3', 'k3', 'CO:111111111')],
    candidates(fact('k1', 'CO', '890903938-8'), fact('k2', 'CO', null), fact('k3', 'CO', '111111111')),
  );

  it('escribe sólo los `update`, con la clave vieja como valla', async () => {
    const calls: Array<{ claimId: string; from: string; to: string }> = [];
    const result = await applyFiscalClaimRecanonicalization(plan, async (input) => {
      calls.push(input);
      return 'updated';
    });
    assert.deepEqual(calls, [{ claimId: 'c1', from: 'CO:8909039388', to: 'CO:890903938' }]);
    assert.equal(result.updated, 1);
  });

  it('cuenta cada desenlace y nunca lanza', async () => {
    const multi = planFiscalClaimRecanonicalization(
      [claim('c1', 'k1', 'CO:8909039388'), claim('c2', 'k2', 'CO:1234567890')],
      candidates(fact('k1', 'CO', '890903938-8'), fact('k2', 'CO', '123456789-0')),
    );
    const outcomes = ['unique_violation', 'boom'] as const;
    let i = 0;
    const result = await applyFiscalClaimRecanonicalization(multi, async () => {
      const outcome = outcomes[i++];
      if (outcome === 'boom') throw new Error('red caída');
      return outcome;
    });
    assert.equal(result.uniqueViolation + result.failed + result.updated + result.notFound, multi.summary.update);
    assert.equal(result.updated, 0);
  });
});
