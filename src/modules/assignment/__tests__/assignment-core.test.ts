import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ASSIGNMENT_BATCH,
  buildAssignmentNotification,
  buildCandidateOwnershipOrClause,
  decideApprovalResponsible,
  describeAssignmentResult,
  intersectOptionalUserIds,
  isAssignableCandidateStatus,
  partitionByCurrentOwner,
  partitionByExplicitAssignee,
  presentCandidateResponsible,
  resolveCandidateResponsibleId,
  resolveConversionOwnerUserId,
  validateAssignmentRequest,
  splitEvenly,
} from '../assignment-core';

describe('validateAssignmentRequest', () => {
  it('quita duplicados, vacíos y valores que no son texto', () => {
    const result = validateAssignmentRequest({ ids: ['a', ' a ', '', 'b', 7, null], targetUserId: ' u1 ' });
    assert.deepEqual(result, { ok: true, ids: ['a', 'b'], targetUserId: 'u1' });
  });

  it('exige destinatario', () => {
    const result = validateAssignmentRequest({ ids: ['a'], targetUserId: '  ' });
    assert.equal(result.ok, false);
  });

  it('exige al menos una fila', () => {
    const result = validateAssignmentRequest({ ids: [], targetUserId: 'u1' });
    assert.equal(result.ok, false);
  });

  it(`rechaza más de ${MAX_ASSIGNMENT_BATCH} a la vez`, () => {
    const ids = Array.from({ length: MAX_ASSIGNMENT_BATCH + 1 }, (_, i) => `id-${i}`);
    const result = validateAssignmentRequest({ ids, targetUserId: 'u1' });
    assert.equal(result.ok, false);
    const atLimit = validateAssignmentRequest({ ids: ids.slice(0, MAX_ASSIGNMENT_BATCH), targetUserId: 'u1' });
    assert.equal(atLimit.ok, true);
  });
});

describe('isAssignableCandidateStatus', () => {
  it('solo lo que sigue vivo en Por revisar se puede asignar', () => {
    for (const status of ['needs_review', 'generated', 'normalized', 'approved', null]) {
      assert.equal(isAssignableCandidateStatus(status), true, String(status));
    }
    for (const status of ['converted_to_account', 'discarded', 'duplicate']) {
      assert.equal(isAssignableCandidateStatus(status), false, status);
    }
  });
});

describe('resolveCandidateResponsibleId', () => {
  it('manda el asignado sobre el dueño del lote', () => {
    assert.equal(
      resolveCandidateResponsibleId({ assignedTo: 'seller', batchOwnerId: 'lead', batchCreatedBy: 'lead' }),
      'seller',
    );
  });

  it('sin asignación: dueño del lote y, si falta, quien lo creó', () => {
    assert.equal(
      resolveCandidateResponsibleId({ assignedTo: null, batchOwnerId: 'owner', batchCreatedBy: 'creator' }),
      'owner',
    );
    assert.equal(
      resolveCandidateResponsibleId({ assignedTo: undefined, batchOwnerId: null, batchCreatedBy: 'creator' }),
      'creator',
    );
    assert.equal(
      resolveCandidateResponsibleId({ assignedTo: null, batchOwnerId: null, batchCreatedBy: null }),
      null,
    );
  });
});

describe('resolveConversionOwnerUserId', () => {
  it('al aprobar, la empresa queda a nombre del asignado aunque apruebe otro', () => {
    assert.equal(
      resolveConversionOwnerUserId({ assignedTo: 'seller', batchCreatedBy: 'lead', approverUserId: 'lead' }),
      'seller',
    );
  });

  it('sin asignación sigue la regla de antes: quien buscó y, si no, quien aprueba', () => {
    assert.equal(
      resolveConversionOwnerUserId({ assignedTo: null, batchCreatedBy: 'lead', approverUserId: 'admin' }),
      'lead',
    );
    assert.equal(
      resolveConversionOwnerUserId({ assignedTo: undefined, batchCreatedBy: null, approverUserId: 'admin' }),
      'admin',
    );
  });

  // AGENT1-AUDIT-WS4 — la empresa no nace a nombre de una persona inactiva.
  it('salta a la persona inactiva y pasa a la siguiente opción', () => {
    const active = new Set(['lead', 'admin']);
    const isActiveUser = (id: string) => active.has(id);
    assert.equal(
      resolveConversionOwnerUserId({ assignedTo: 'gone', batchCreatedBy: 'lead', approverUserId: 'admin', isActiveUser }),
      'lead',
    );
    assert.equal(
      resolveConversionOwnerUserId({ assignedTo: 'gone', batchCreatedBy: 'gone-too', approverUserId: 'admin', isActiveUser }),
      'admin',
    );
  });

  it('sin asignación manda el dueño de la búsqueda, como la columna «Responsable»', () => {
    assert.equal(
      resolveConversionOwnerUserId({ assignedTo: null, batchOwnerId: 'owner', batchCreatedBy: 'lead', approverUserId: 'admin' }),
      'owner',
    );
    const isActiveUser = (id: string) => id !== 'owner';
    assert.equal(
      resolveConversionOwnerUserId({
        assignedTo: null,
        batchOwnerId: 'owner',
        batchCreatedBy: 'lead',
        approverUserId: 'admin',
        isActiveUser,
      }),
      'lead',
    );
  });

  it('sin poder leer quién está activo, la regla de siempre', () => {
    assert.equal(
      resolveConversionOwnerUserId({ assignedTo: 'gone', batchCreatedBy: 'lead', approverUserId: 'admin' }),
      'gone',
    );
  });
});

describe('decideApprovalResponsible', () => {
  const users: Record<string, { active: boolean; roleKey: string | null }> = {
    bd: { active: true, roleKey: 'bd' },
    growth: { active: true, roleKey: 'growth' },
    admin: { active: true, roleKey: 'ADMIN' },
    gone: { active: false, roleKey: 'bd' },
  };
  const lookup = (id: string) => users[id];
  const decide = (input: { assignedTo?: string | null; batchOwnerId?: string | null; batchCreatedBy?: string | null }) =>
    decideApprovalResponsible({
      assignedTo: input.assignedTo ?? null,
      batchOwnerId: input.batchOwnerId ?? null,
      batchCreatedBy: input.batchCreatedBy ?? null,
      lookup,
    });
  const NEEDS = { ok: false, reason: 'needs_assignee' };

  it('asignada a alguien activo: se aprueba, aunque la búsqueda sea de Growth', () => {
    assert.deepEqual(decide({ assignedTo: 'bd', batchOwnerId: 'growth' }), { ok: true, responsibleId: 'bd' });
    assert.deepEqual(decide({ assignedTo: 'growth', batchOwnerId: 'growth' }), { ok: true, responsibleId: 'growth' });
  });

  it('sin asignar, la búsqueda propia de un BD no pide nada más', () => {
    assert.deepEqual(decide({ batchOwnerId: 'bd' }), { ok: true, responsibleId: 'bd' });
    assert.deepEqual(decide({ batchCreatedBy: 'bd' }), { ok: true, responsibleId: 'bd' });
  });

  it('sin asignar, lo de Growth o admin necesita responsable', () => {
    assert.deepEqual(decide({ batchOwnerId: 'growth' }), NEEDS);
    assert.deepEqual(decide({ batchOwnerId: 'admin' }), NEEDS);
  });

  it('una persona dada de baja, o que no se pudo leer, no cuenta', () => {
    assert.deepEqual(decide({ assignedTo: 'gone', batchOwnerId: 'growth' }), NEEDS);
    assert.deepEqual(decide({ batchOwnerId: 'gone' }), NEEDS);
    assert.deepEqual(decide({ batchOwnerId: 'nadie' }), NEEDS);
    assert.deepEqual(decide({}), NEEDS);
  });
});

describe('buildCandidateOwnershipOrClause', () => {
  it('sin personas no hay filtro posible', () => {
    assert.equal(buildCandidateOwnershipOrClause([], ['b1']), null);
  });

  it('sin lotes propios solo cuenta la asignación', () => {
    assert.equal(buildCandidateOwnershipOrClause(['u1', 'u2'], []), 'assigned_to.in.(u1,u2)');
  });

  it('lo asignado a la persona o lo no asignado de sus lotes', () => {
    assert.equal(
      buildCandidateOwnershipOrClause(['u1'], ['b1', 'b2']),
      'assigned_to.in.(u1),and(assigned_to.is.null,batch_id.in.(b1,b2))',
    );
  });
});

describe('intersectOptionalUserIds', () => {
  it('sin alcance ni filtro no restringe', () => {
    assert.equal(intersectOptionalUserIds(null, null), null);
  });

  it('una sola dimensión manda', () => {
    assert.deepEqual(intersectOptionalUserIds(null, ['u1', 'u1']), ['u1']);
    assert.deepEqual(intersectOptionalUserIds(['u1', 'u2'], null), ['u1', 'u2']);
  });

  it('el filtro nunca amplía el alcance', () => {
    assert.deepEqual(intersectOptionalUserIds(['u1', 'u2'], ['u2', 'u3']), ['u2']);
    assert.deepEqual(intersectOptionalUserIds(['u1'], ['u3']), []);
  });
});

describe('partitionByCurrentOwner', () => {
  it('separa lo que ya era del destinatario', () => {
    const rows = [
      { id: 'a', currentOwnerId: 'u1' },
      { id: 'b', currentOwnerId: 'u2' },
      { id: 'c', currentOwnerId: null },
    ];
    const { toChange, alreadyOwned } = partitionByCurrentOwner(rows, 'u1');
    assert.deepEqual(toChange.map((r) => r.id), ['b', 'c']);
    assert.deepEqual(alreadyOwned.map((r) => r.id), ['a']);
  });
});

describe('partitionByExplicitAssignee', () => {
  it('asignarse a sí mismo lo que salió de su búsqueda sí cuenta como cambio', () => {
    const rows = [
      { id: 'a', assignedTo: 'u1' },
      { id: 'b', assignedTo: null },
      { id: 'c', assignedTo: 'u2' },
    ];
    const { toChange, alreadyOwned } = partitionByExplicitAssignee(rows, 'u1');
    assert.deepEqual(toChange.map((r) => r.id), ['b', 'c']);
    assert.deepEqual(alreadyOwned.map((r) => r.id), ['a']);
  });
});

describe('buildAssignmentNotification', () => {
  it('una empresa: nombra la empresa y lleva a Empresas', () => {
    const n = buildAssignmentNotification({
      kind: 'accounts',
      count: 1,
      actorName: 'Ana Pérez',
      targetUserId: 'u1',
      sampleNames: ['Bancolombia'],
    });
    assert.equal(n.title, 'Te asignaron 1 empresa');
    assert.equal(n.message, 'Ana Pérez te asignó una empresa: Bancolombia.');
    assert.equal(n.actionUrl, '/accounts');
  });

  it('varias por revisar: muestra tres y cuántas más, y filtra por la persona', () => {
    const n = buildAssignmentNotification({
      kind: 'candidates',
      count: 12,
      actorName: null,
      targetUserId: 'u 1',
      sampleNames: ['A', 'B', 'C', 'D'],
    });
    assert.equal(n.title, 'Te asignaron 12 empresas por revisar');
    assert.equal(n.message, 'Alguien te asignó 12 empresas por revisar: A, B, C y 9 más.');
    assert.equal(n.actionUrl, '/accounts?tab=prospectos&userId=u%201');
  });
});

describe('describeAssignmentResult', () => {
  it('resume asignadas, las que ya eran suyas y las que no se pudieron', () => {
    assert.equal(
      describeAssignmentResult({ kind: 'accounts', assigned: 3, alreadyOwned: 1, skipped: 2, targetName: 'Luis' }),
      '3 empresas asignadas a Luis · 1 ya era suya · 2 no se pudieron asignar',
    );
    assert.equal(
      describeAssignmentResult({ kind: 'candidates', assigned: 1, alreadyOwned: 0, skipped: 0, targetName: 'Luis' }),
      '1 empresa por revisar asignada a Luis',
    );
  });
});

describe('repartir en partes iguales (búsqueda masiva)', () => {
  const ids = Array.from({ length: 100 }, (_, i) => `c${i}`);

  it('100 entre 3 → 34, 33, 33, sin perder ni repetir', () => {
    const shares = splitEvenly(ids, ['ana', 'beto', 'caro']);
    assert.deepEqual(shares.map((s) => [s.userId, s.ids.length]), [['ana', 34], ['beto', 33], ['caro', 33]]);
    assert.equal(new Set(shares.flatMap((s) => s.ids)).size, 100);
  });

  it('una sola persona se queda con todas', () => {
    assert.deepEqual(splitEvenly(ids, ['ana']).map((s) => s.ids.length), [100]);
  });

  it('sin personas no reparte; una persona repetida cuenta una vez', () => {
    assert.deepEqual(splitEvenly(ids, []), []);
    assert.equal(splitEvenly(ids, ['ana', 'ana']).length, 1);
  });

  it('menos empresas que personas: nadie recibe una lista vacía', () => {
    assert.deepEqual(splitEvenly(['c1', 'c2'], ['ana', 'beto', 'caro']).map((s) => s.userId), ['ana', 'beto']);
  });
});

describe('presentCandidateResponsible — la columna «Responsable» dice lo mismo que la regla de aprobación', () => {
  it('lote de Growth o admin sin asignar: «Sin asignar», lanzada por quien buscó', () => {
    assert.deepEqual(
      presentCandidateResponsible({ responsibleId: 'admin', name: 'Felipe', assignedTo: null, needsAssignee: true }),
      { responsible: null, launchedBy: { id: 'admin', name: 'Felipe' } },
    );
  });

  it('el lote propio de un BD no cambia: el BD es el responsable', () => {
    assert.deepEqual(
      presentCandidateResponsible({ responsibleId: 'bd', name: 'Ana', assignedTo: null, needsAssignee: false }),
      { responsible: { id: 'bd', name: 'Ana', isAssigned: false }, launchedBy: null },
    );
  });

  it('asignada a mano: el asignado, marcado como asignado', () => {
    assert.deepEqual(
      presentCandidateResponsible({ responsibleId: 'bd', name: 'Ana', assignedTo: 'bd', needsAssignee: false }),
      { responsible: { id: 'bd', name: 'Ana', isAssigned: true }, launchedBy: null },
    );
  });

  it('sin nadie, ni responsable ni lanzada por', () => {
    assert.deepEqual(
      presentCandidateResponsible({ responsibleId: null, name: null, assignedTo: null, needsAssignee: true }),
      { responsible: null, launchedBy: null },
    );
  });
});
