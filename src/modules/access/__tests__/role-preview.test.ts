/**
 * «Ver como…» (dueña 12-11): sólo la persona autorizada y siendo admin de verdad;
 * sólo restringe. Y el gate de Apollo en Rumbo ya no exige admin (Pedro Tapia,
 * «Esta búsqueda de empresas no está disponible»).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canUseRolePreview,
  isPreviewableRole,
  parseRolePreviewCookie,
  PREVIEWABLE_ROLE_KEYS,
  ROLE_PREVIEW_EMAILS,
} from '../role-preview';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('quién puede usar «Ver como…»', () => {
  it('sólo egarcia y siendo admin de verdad', () => {
    assert.deepEqual([...ROLE_PREVIEW_EMAILS], ['egarcia@ubits.co']);
    assert.equal(canUseRolePreview({ email: 'egarcia@ubits.co', roleKey: 'admin' }), true);
    assert.equal(canUseRolePreview({ email: 'EGarcia@ubits.co ', roleKey: 'admin' }), true);
    assert.equal(canUseRolePreview({ email: 'egarcia@ubits.co', roleKey: 'commercial_lead' }), false);
    assert.equal(canUseRolePreview({ email: 'otra@ubits.co', roleKey: 'admin' }), false);
    assert.equal(canUseRolePreview({ email: null, roleKey: 'admin' }), false);
  });

  it('se prueban todos los roles que no son admin (nunca se «sube» a admin)', () => {
    assert.deepEqual([...PREVIEWABLE_ROLE_KEYS], ['commercial_manager', 'commercial_lead', 'seller_bd', 'growth']);
    assert.equal(isPreviewableRole('admin'), false);
    assert.equal(isPreviewableRole('raro'), false);
  });

  it('la cookie sólo acepta un id de persona', () => {
    assert.equal(parseRolePreviewCookie('5A8FB462-EECB-41F2-BFAB-2C8FB6E3F73C'), '5a8fb462-eecb-41f2-bfab-2c8fb6e3f73c');
    assert.equal(parseRolePreviewCookie('admin'), null);
    assert.equal(parseRolePreviewCookie(''), null);
    assert.equal(parseRolePreviewCookie(undefined), null);
  });
});

describe('cableado (código)', () => {
  it('🔴 la vista previa se valida contra la identidad REAL y mientras dura no es admin', () => {
    const server = read('src/modules/access/role-preview.server.ts');
    assert.match(server, /canUseRolePreview\(real\)/);
    const actions = read('src/modules/access/actions.ts');
    assert.match(actions, /if \(await readRolePreview\(\)\) return false;/);
    const scope = read('src/modules/access/commercial-scope.ts');
    assert.match(scope, /const preview = await readRolePreview\(\);/);
    const previewActions = read('src/modules/access/role-preview-actions.ts');
    assert.equal((previewActions.match(/allowedRealUser\(\)/g) ?? []).length >= 3, true, 'cada acción revisa a la persona real');
  });

  it('🔴 Rumbo: buscar con Apollo es de cualquier usuario activo; elegir proveedor sigue siendo de admin', () => {
    const wiring = read('src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts');
    assert.match(wiring, /isRolePermitted: isWizardApolloDiscoveryAllowedForUser,/);
    assert.match(wiring, /requestedProvider !== undefined && \(await resolveIsApolloDiscoveryRolePermitted\(\)\)/);
  });
});
