import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OwnerRequiredError,
  requireOwnerForCreate,
  resolveOwnerForCreate,
} from '../resolve-owner-for-create';

describe('resolveOwnerForCreate — todo lo que se crea lleva responsable', () => {
  it('manda el responsable elegido', () => {
    assert.equal(resolveOwnerForCreate({ chosenOwnerId: 'u-elegido', actorUserId: 'u-crea' }), 'u-elegido');
  });

  it('sin responsable elegido, el responsable es quien crea', () => {
    assert.equal(resolveOwnerForCreate({ chosenOwnerId: null, actorUserId: 'u-crea' }), 'u-crea');
    assert.equal(resolveOwnerForCreate({ chosenOwnerId: undefined, actorUserId: 'u-crea' }), 'u-crea');
  });

  it('un responsable vacío o con espacios cuenta como «no elegido» (el formulario manda "")', () => {
    assert.equal(resolveOwnerForCreate({ chosenOwnerId: '', actorUserId: 'u-crea' }), 'u-crea');
    assert.equal(resolveOwnerForCreate({ chosenOwnerId: '   ', actorUserId: 'u-crea' }), 'u-crea');
  });

  it('recorta espacios del id elegido', () => {
    assert.equal(resolveOwnerForCreate({ chosenOwnerId: ' u-elegido ' }), 'u-elegido');
  });

  it('sin persona delante, usa el primer humano de respaldo en orden', () => {
    assert.equal(
      resolveOwnerForCreate({ actorUserId: null, fallbackUserIds: [null, '', 'u-disparo', 'u-pidio'] }),
      'u-disparo',
    );
  });

  it('devuelve null sólo si no hay ningún humano — nunca inventa un responsable', () => {
    assert.equal(resolveOwnerForCreate({}), null);
    assert.equal(resolveOwnerForCreate({ chosenOwnerId: null, actorUserId: '', fallbackUserIds: [undefined] }), null);
  });
});

describe('requireOwnerForCreate — falla cerrado en lo que ve el usuario', () => {
  it('devuelve el responsable resuelto', () => {
    assert.equal(requireOwnerForCreate({ actorUserId: 'u-crea' }, 'la empresa'), 'u-crea');
  });

  it('lanza OwnerRequiredError si no hay ningún humano', () => {
    assert.throws(
      () => requireOwnerForCreate({ chosenOwnerId: null, actorUserId: null }, 'la empresa'),
      (err: unknown) =>
        err instanceof OwnerRequiredError &&
        err.code === 'OWNER_REQUIRED' &&
        /la empresa sin responsable/.test(err.message),
    );
  });
});
