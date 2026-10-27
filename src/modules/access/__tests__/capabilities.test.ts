/**
 * Quién puede qué: el BD prospecta a mano, Growth en masa.
 *
 * Las reglas se prueban encendidas y apagadas: apagadas (ENABLE_ROLE_CAPABILITIES
 * sin activar) nadie pierde lo que podía hacer antes de este cambio.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canReviewCandidate,
  decideCandidateApproval,
  hasCapability,
  hasDuplicateRisk,
  isGrowthRole,
  type AccessSnapshot,
} from '../capabilities';
import { classifyRole } from '../commercial-scope-logic';
import { canAccessNavItem, mainNavItems, type NavItem } from '../../../config/navigation';

const admin: AccessSnapshot = { userId: 'u-admin', roleKey: 'admin', isAdmin: true };
const growth: AccessSnapshot = { userId: 'u-growth', roleKey: 'growth', isAdmin: false };
const bd: AccessSnapshot = { userId: 'u-bd', roleKey: 'seller_bd', isAdmin: false };
const manager: AccessSnapshot = { userId: 'u-mgr', roleKey: 'commercial_manager', isAdmin: false };
const anon: AccessSnapshot = { userId: null, roleKey: null, isAdmin: false };

const ON = { enforced: true };
const OFF = { enforced: false };

describe('prospección masiva', () => {
  it('encendida: solo Growth y admin', () => {
    assert.equal(hasCapability(growth, 'prospectarMasivo', ON), true);
    assert.equal(hasCapability(admin, 'prospectarMasivo', ON), true);
    assert.equal(hasCapability(bd, 'prospectarMasivo', ON), false);
    assert.equal(hasCapability(manager, 'prospectarMasivo', ON), false);
    assert.equal(hasCapability(bd, 'enriquecerMasivo', ON), false);
    assert.equal(hasCapability(growth, 'enriquecerMasivo', ON), true);
  });

  it('apagada: cualquier usuario activo, como antes', () => {
    assert.equal(hasCapability(bd, 'prospectarMasivo', OFF), true);
    assert.equal(hasCapability(manager, 'enriquecerMasivo', OFF), true);
  });

  it('sin usuario activo, nunca', () => {
    assert.equal(hasCapability(anon, 'prospectarMasivo', OFF), false);
    assert.equal(hasCapability(anon, 'prospectarMasivo', ON), false);
  });
});

describe('decidir sobre una candidata', () => {
  const deBd = { assignedTo: null, batchOwnerId: null, batchCreatedBy: 'u-bd' };
  const deOtro = { assignedTo: 'u-otro', batchOwnerId: 'u-otro', batchCreatedBy: 'u-otro' };

  it('encendida: el BD decide sobre lo suyo y no sobre lo ajeno', () => {
    assert.equal(canReviewCandidate(bd, deBd, ON), true);
    assert.equal(canReviewCandidate(bd, { assignedTo: 'u-bd' }, ON), true);
    assert.equal(canReviewCandidate(bd, deOtro, ON), false);
  });

  it('encendida: Growth y admin deciden sobre cualquiera', () => {
    assert.equal(canReviewCandidate(growth, deOtro, ON), true);
    assert.equal(canReviewCandidate(admin, deOtro, ON), true);
  });

  it('apagada: solo admin, como antes (ni siquiera lo propio)', () => {
    assert.equal(canReviewCandidate(bd, deBd, OFF), false);
    assert.equal(canReviewCandidate(growth, deOtro, OFF), false);
    assert.equal(canReviewCandidate(admin, deOtro, OFF), true);
  });

  it('una candidata sin dueño conocido no la decide un BD', () => {
    assert.equal(canReviewCandidate(bd, {}, ON), false);
  });
});

describe('Growth en el alcance y el menú', () => {
  it('el rol se reconoce sin importar mayúsculas o espacios', () => {
    assert.equal(isGrowthRole(' Growth '), true);
    assert.equal(isGrowthRole('seller_bd'), false);
  });

  it('Growth ve toda la base (visibilidad), el BD solo lo suyo', () => {
    assert.equal(classifyRole('growth', false), 'admin');
    assert.equal(classifyRole('seller_bd', false), 'self');
    assert.equal(classifyRole('commercial_lead', false), 'team');
  });

  it('un ítem `growth` del menú lo ven Growth y admin, no el BD', () => {
    const item: NavItem = { title: 'Prospección masiva', href: '/growth', icon: mainNavItems[0].icon, access: 'growth' };
    assert.equal(canAccessNavItem(item, { isAdmin: false, roleKey: 'growth' }), true);
    assert.equal(canAccessNavItem(item, { isAdmin: true, roleKey: 'admin' }), true);
    assert.equal(canAccessNavItem(item, { isAdmin: false, roleKey: 'seller_bd' }), false);
  });
});

describe('aprobar: el posible duplicado de un BD pasa a Growth', () => {
  const deBd = { batchCreatedBy: 'u-bd' };
  const limpia = { duplicateStatus: 'no_match', matchedHubSpotCompanyId: null };
  const posible = { duplicateStatus: 'possible_duplicate' };
  const enHubSpot = { duplicateStatus: 'no_match', matchedHubSpotCompanyId: 'hs-123' };

  it('el riesgo es todo lo que no sea no_match limpio, o una coincidencia en HubSpot', () => {
    assert.equal(hasDuplicateRisk(limpia), false);
    assert.equal(hasDuplicateRisk(posible), true);
    assert.equal(hasDuplicateRisk(enHubSpot), true);
    assert.equal(hasDuplicateRisk({ duplicateStatus: 'related_company' }), true);
  });

  it('el BD aprueba su candidata limpia', () => {
    assert.deepEqual(decideCandidateApproval(bd, deBd, limpia, ON), { ok: true });
  });

  it('el BD NO aprueba su posible duplicado ni lo que ya está en HubSpot: lo decide Growth', () => {
    assert.deepEqual(decideCandidateApproval(bd, deBd, posible, ON), { ok: false, reason: 'needs_growth_review' });
    assert.deepEqual(decideCandidateApproval(bd, deBd, enHubSpot, ON), { ok: false, reason: 'needs_growth_review' });
  });

  it('Growth y admin aprueban aunque haya riesgo (con su confirmación de siempre)', () => {
    assert.deepEqual(decideCandidateApproval(growth, deBd, posible, ON), { ok: true });
    assert.deepEqual(decideCandidateApproval(admin, deBd, enHubSpot, ON), { ok: true });
  });

  it('lo ajeno sigue sin permiso, y apagada solo aprueba admin', () => {
    assert.deepEqual(decideCandidateApproval(bd, { batchCreatedBy: 'u-otro' }, limpia, ON), {
      ok: false,
      reason: 'not_allowed',
    });
    assert.deepEqual(decideCandidateApproval(bd, deBd, limpia, OFF), { ok: false, reason: 'not_allowed' });
  });
});
