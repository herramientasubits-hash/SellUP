import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ASSIGNMENT_BATCH,
  buildAssignmentNotification,
  buildCandidateOwnershipOrClause,
  describeAssignmentResult,
  intersectOptionalUserIds,
  isAssignableCandidateStatus,
  partitionByCurrentOwner,
  resolveCandidateResponsibleId,
  resolveConversionOwnerUserId,
  validateAssignmentRequest,
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
