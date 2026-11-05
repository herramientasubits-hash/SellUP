import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LEADERS_OPEN_AT,
  evaluateLaunchGate,
  isBlockedRegardlessOfRole,
  parseLaunchAudience,
  parseLaunchGateConfig,
} from '../launch-gate';

const BEFORE = new Date('2026-11-06T15:00:00Z');
const AFTER = new Date('2026-11-11T13:00:01Z');
const config = parseLaunchGateConfig({});

describe('launch gate — configuración', () => {
  it('queda puesta por defecto, con egarcia y brcastro y la apertura de líderes del miércoles 11', () => {
    assert.equal(config.enabled, true);
    assert.ok(config.allowedEmails.has('egarcia@ubits.co'));
    assert.ok(config.allowedEmails.has('brcastro@ubits.co'));
    assert.equal(config.leadersOpenAt, DEFAULT_LEADERS_OPEN_AT);
  });

  it('se quita con "off" y acepta correos extra y otra fecha', () => {
    const custom = parseLaunchGateConfig({
      SELLUP_LAUNCH_GATE: ' OFF ',
      SELLUP_LAUNCH_GATE_ALLOW: 'Fpico@ubits.co, no-es-correo',
      SELLUP_LAUNCH_LEADERS_AT: '2026-11-12T14:00:00Z',
    });
    assert.equal(custom.enabled, false);
    assert.ok(custom.allowedEmails.has('fpico@ubits.co'));
    assert.equal(custom.allowedEmails.has('no-es-correo'), false);
    assert.equal(custom.leadersOpenAt, '2026-11-12T14:00:00.000Z');
  });

  it('una fecha inválida no abre antes de tiempo: cae a la de por defecto', () => {
    assert.equal(parseLaunchGateConfig({ SELLUP_LAUNCH_LEADERS_AT: 'mañana' }).leadersOpenAt, DEFAULT_LEADERS_OPEN_AT);
  });
});

describe('launch gate — quién entra', () => {
  it('egarcia y brcastro entran siempre, sin importar mayúsculas', () => {
    assert.deepEqual(evaluateLaunchGate({ config, email: 'EGarcia@ubits.co', roleKey: 'admin', now: BEFORE }), { allowed: true });
    assert.deepEqual(evaluateLaunchGate({ config, email: 'brcastro@ubits.co', now: BEFORE }), { allowed: true });
  });

  it('un líder espera la cuenta regresiva y entra cuando llega a cero', () => {
    assert.deepEqual(evaluateLaunchGate({ config, email: 'dsanchez@ubits.co', roleKey: 'commercial_lead', now: BEFORE }), {
      allowed: false,
      audience: 'leaders',
    });
    assert.deepEqual(evaluateLaunchGate({ config, email: 'dsanchez@ubits.co', roleKey: 'commercial_lead', now: AFTER }), { allowed: true });
  });

  it('vendedores, Growth y otros admins siguen fuera después de la apertura de líderes', () => {
    for (const roleKey of ['seller_bd', 'growth', 'admin', null]) {
      assert.deepEqual(evaluateLaunchGate({ config, email: 'x@ubits.co', roleKey, now: AFTER }), {
        allowed: false,
        audience: 'team',
      });
    }
  });

  it('sin puerta entra todo el mundo', () => {
    const off = parseLaunchGateConfig({ SELLUP_LAUNCH_GATE: 'off' });
    assert.deepEqual(evaluateLaunchGate({ config: off, email: 'x@ubits.co', roleKey: 'seller_bd', now: BEFORE }), { allowed: true });
  });
});

describe('launch gate — proxy (sólo correo)', () => {
  it('antes de la apertura bloquea a todo el que no esté en la lista', () => {
    assert.equal(isBlockedRegardlessOfRole(config, 'dsanchez@ubits.co', BEFORE), true);
    assert.equal(isBlockedRegardlessOfRole(config, 'egarcia@ubits.co', BEFORE), false);
  });

  it('después de la apertura deja decidir al layout, que conoce el rol', () => {
    assert.equal(isBlockedRegardlessOfRole(config, 'dsanchez@ubits.co', AFTER), false);
  });
});

describe('launch gate — audiencia del aviso', () => {
  it('sólo acepta los dos valores conocidos', () => {
    assert.equal(parseLaunchAudience('leaders'), 'leaders');
    assert.equal(parseLaunchAudience('team'), 'team');
    assert.equal(parseLaunchAudience('otra'), null);
  });
});
