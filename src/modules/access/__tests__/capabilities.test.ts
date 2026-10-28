/**
 * Quién puede qué: Growth es un vendedor más que además prospecta en masa (dueña 28-10).
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
const lead: AccessSnapshot = { userId: 'u-lead', roleKey: 'commercial_lead', isAdmin: false };
const anon: AccessSnapshot = { userId: null, roleKey: null, isAdmin: false };

const ON = { enforced: true };
const OFF = { enforced: false };

describe('prospección masiva', () => {
  it('encendida: sólo Growth y admin (dueña 28-10); ni el BD ni los líderes', () => {
    assert.equal(hasCapability(growth, 'prospectarMasivo', ON), true);
    assert.equal(hasCapability(admin, 'prospectarMasivo', ON), true);
    assert.equal(hasCapability(manager, 'prospectarMasivo', ON), false);
    assert.equal(hasCapability(lead, 'prospectarMasivo', ON), false);
    assert.equal(hasCapability(bd, 'prospectarMasivo', ON), false);
  });

  it('buscar contactos en masa: de cualquier usuario activo, como antes', () => {
    assert.equal(hasCapability(bd, 'enriquecerMasivo', ON), true);
    assert.equal(hasCapability(growth, 'enriquecerMasivo', ON), true);
    assert.equal(hasCapability(lead, 'enriquecerMasivo', ON), true);
    assert.equal(hasCapability(anon, 'enriquecerMasivo', ON), false);
  });

  it('revisar TODAS las candidatas es sólo de admin (Growth revisa lo suyo)', () => {
    assert.equal(hasCapability(lead, 'revisarTodasLasCandidatas', ON), false);
    assert.equal(hasCapability(growth, 'revisarTodasLasCandidatas', ON), false);
    assert.equal(hasCapability(admin, 'revisarTodasLasCandidatas', ON), true);
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

  it('encendida: admin decide sobre cualquiera; Growth, como un BD, sólo sobre lo suyo', () => {
    assert.equal(canReviewCandidate(admin, deOtro, ON), true);
    assert.equal(canReviewCandidate(growth, deOtro, ON), false);
    assert.equal(canReviewCandidate(growth, { batchCreatedBy: 'u-growth' }, ON), true);
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

  it('Growth, como el BD, ve sólo lo suyo', () => {
    assert.equal(classifyRole('growth', false), 'self');
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

describe('aprobar: el posible duplicado de un BD o de Growth pasa a admin', () => {
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

  it('el BD NO aprueba su posible duplicado ni lo que ya está en HubSpot: lo decide admin', () => {
    assert.deepEqual(decideCandidateApproval(bd, deBd, posible, ON), { ok: false, reason: 'needs_growth_review' });
    assert.deepEqual(decideCandidateApproval(bd, deBd, enHubSpot, ON), { ok: false, reason: 'needs_growth_review' });
  });

  it('admin aprueba aunque haya riesgo (con su confirmación de siempre); Growth no', () => {
    assert.deepEqual(decideCandidateApproval(admin, deBd, enHubSpot, ON), { ok: true });
    const deGrowth = { batchCreatedBy: 'u-growth' };
    assert.deepEqual(decideCandidateApproval(growth, deGrowth, limpia, ON), { ok: true });
    assert.deepEqual(decideCandidateApproval(growth, deGrowth, posible, ON), { ok: false, reason: 'needs_growth_review' });
    assert.deepEqual(decideCandidateApproval(growth, deBd, limpia, ON), { ok: false, reason: 'not_allowed' });
  });

  it('lo ajeno sigue sin permiso, y apagada solo aprueba admin', () => {
    assert.deepEqual(decideCandidateApproval(bd, { batchCreatedBy: 'u-otro' }, limpia, ON), {
      ok: false,
      reason: 'not_allowed',
    });
    assert.deepEqual(decideCandidateApproval(bd, deBd, limpia, OFF), { ok: false, reason: 'not_allowed' });
  });
});
