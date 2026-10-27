/**
 * Lo de una búsqueda masiva no se aprueba sin responsable: la guarda única de
 * aprobación lo exige (también a admin y Growth), la empresa nace a nombre de
 * ese responsable y «asignarme a mí» deja escrita la asignación.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

describe('checkCandidateApproval', () => {
  const server = read('modules/access/capabilities.server.ts');
  const fn = server.slice(server.indexOf('export async function checkCandidateApproval('));

  it('aplica la regla del responsable después de autorizar, también a quien revisa todo', () => {
    const gate = fn.indexOf("hasCapability(access, 'revisarTodasLasCandidatas'");
    const rule = fn.indexOf('decideApprovalResponsible(');
    assert.ok(gate > 0 && rule > gate);
    assert.ok(!fn.slice(0, rule).includes('if (reviewsAll) return { ok: true }'));
  });

  it('si no puede leer a las personas, no deja aprobar', () => {
    assert.ok(fn.includes("if (!users) return { ok: false, reason: 'needs_assignee' }"));
  });

  it('el mensaje del rechazo es el de asignar', () => {
    assert.ok(server.includes("if (decision.reason === 'needs_assignee') return NEEDS_ASSIGNEE_MESSAGE;"));
  });
});

describe('la empresa nace a nombre del responsable', () => {
  const actions = read('modules/prospect-batches/actions.ts');

  it('las dos conversiones leen el dueño de la búsqueda y lo pasan a la regla', () => {
    assert.equal(actions.split('batch:prospect_batches!prospect_candidates_batch_id_fkey(source, owner_id, created_by)').length - 1, 2);
    assert.equal(actions.split('batchOwnerId: convertBatchRow?.owner_id').length - 1, 1);
    assert.equal(actions.split('batchOwnerId: batchRow?.owner_id').length - 1, 1);
  });

  it('las listas marcan lo que necesita responsable', () => {
    assert.equal(actions.split('findCandidatesNeedingAssignee(').length - 1, 2);
  });
});

describe('«Asignar a…»', () => {
  it('asignarse a sí mismo lo de su búsqueda sí escribe la asignación', () => {
    const assign = read('modules/prospect-review/assign-actions.ts');
    assert.ok(assign.includes('partitionByExplicitAssignee(candidates, target.id)'));
    assert.ok(!assign.includes('partitionByCurrentOwner('));
  });

  it('el drawer sólo da por suyo lo asignado a mano', () => {
    const table = read('components/prospects/prospects-data-table-client.tsx');
    assert.ok(table.includes('currentOwnerId: r.responsible?.isAssigned ? r.responsible.id : null'));
  });
});
