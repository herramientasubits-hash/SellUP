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

  it('apagada también: el responsable decide lo suyo (dueña 11-11); lo ajeno no', () => {
    assert.equal(canReviewCandidate(bd, deBd, OFF), true);
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

  it('el responsable aprueba su posible duplicado y lo que ya está en HubSpot (lo confirma en el panel; dueña 11-11)', () => {
    assert.deepEqual(decideCandidateApproval(bd, deBd, posible, ON), { ok: true });
    assert.deepEqual(decideCandidateApproval(bd, deBd, enHubSpot, ON), { ok: true });
  });

  it('admin aprueba aunque haya riesgo; Growth decide lo suyo, no lo ajeno', () => {
    assert.deepEqual(decideCandidateApproval(admin, deBd, enHubSpot, ON), { ok: true });
    const deGrowth = { batchCreatedBy: 'u-growth' };
    assert.deepEqual(decideCandidateApproval(growth, deGrowth, limpia, ON), { ok: true });
    assert.deepEqual(decideCandidateApproval(growth, deGrowth, posible, ON), { ok: true });
    assert.deepEqual(decideCandidateApproval(growth, deBd, limpia, ON), { ok: false, reason: 'not_allowed' });
  });

  it('lo ajeno sigue sin permiso; apagada, el responsable igual aprueba lo suyo', () => {
    assert.deepEqual(decideCandidateApproval(bd, { batchCreatedBy: 'u-otro' }, limpia, ON), {
      ok: false,
      reason: 'not_allowed',
    });
    assert.deepEqual(decideCandidateApproval(bd, deBd, limpia, OFF), { ok: true });
  });
});

describe('cascada hacia abajo al decidir (dueña 12-11)', () => {
  const lider: AccessSnapshot = { userId: 'u-lider', roleKey: 'commercial_lead', isAdmin: false };
  const vendedor: AccessSnapshot = { userId: 'u-v1', roleKey: 'seller_bd', isAdmin: false };
  const deV1 = { assignedTo: null, batchOwnerId: 'u-v1', batchCreatedBy: 'u-v1' };
  const deOtroEquipo = { assignedTo: 'u-x', batchOwnerId: 'u-x', batchCreatedBy: 'u-x' };

  it('el líder decide lo de su gente (asignado o dueño de la búsqueda)', () => {
    const team = ['u-lider', 'u-v1', 'u-v2'];
    assert.equal(canReviewCandidate(lider, deV1, { enforced: true, team }), true);
    assert.equal(canReviewCandidate(lider, { assignedTo: 'u-v2' }, { enforced: false, team }), true);
    assert.equal(decideCandidateApproval(lider, deV1, {}, { enforced: true, team }).ok, true);
  });

  it('🔴 nunca lo de otro equipo', () => {
    const team = ['u-lider', 'u-v1'];
    assert.equal(canReviewCandidate(lider, deOtroEquipo, { enforced: true, team }), false);
  });

  it('sin equipo (bandera de alcance apagada) sólo lo propio, como antes', () => {
    assert.equal(canReviewCandidate(lider, deV1, { enforced: true }), false);
    assert.equal(canReviewCandidate(vendedor, deV1, { enforced: true }), true);
  });
});

describe('cargar archivos de empresas (dueña 12-11)', () => {
  it('de cualquier usuario activo, con las reglas encendidas o apagadas', () => {
    for (const who of [admin, growth, manager, lead, bd]) {
      assert.equal(hasCapability(who, 'importarArchivos', ON), true, who.roleKey ?? '');
      assert.equal(hasCapability(who, 'importarArchivos', OFF), true, who.roleKey ?? '');
    }
    assert.equal(hasCapability(anon, 'importarArchivos', ON), false);
  });
});

describe('decisión 4: una candidata reasignada la decide sólo su asignado y su cadena', () => {
  const vendedor: AccessSnapshot = { userId: 'u-v1', roleKey: 'seller_bd', isAdmin: false };
  const lider: AccessSnapshot = { userId: 'u-lider', roleKey: 'commercial_lead', isAdmin: false };
  const reasignada = { assignedTo: 'u-otro', batchOwnerId: 'u-v1', batchCreatedBy: 'u-v1' };

  it('el dueño de la búsqueda ya no decide la candidata que reasignó a otro', () => {
    assert.equal(canReviewCandidate(vendedor, reasignada, ON), false);
    assert.equal(decideCandidateApproval(vendedor, reasignada, {}, ON).ok, false);
  });

  it('ni el líder del dueño de la búsqueda, si el asignado no es de su equipo', () => {
    assert.equal(canReviewCandidate(lider, reasignada, { enforced: true, team: ['u-lider', 'u-v1'] }), false);
  });

  it('sí el asignado y el líder del asignado', () => {
    assert.equal(canReviewCandidate({ userId: 'u-otro', roleKey: 'seller_bd', isAdmin: false }, reasignada, ON), true);
    assert.equal(canReviewCandidate(lider, reasignada, { enforced: true, team: ['u-lider', 'u-otro'] }), true);
  });

  it('sin asignado, el dueño o creador de la búsqueda como antes; admin siempre', () => {
    assert.equal(canReviewCandidate(vendedor, { batchOwnerId: 'u-v1' }, ON), true);
    assert.equal(canReviewCandidate(vendedor, { assignedTo: null, batchCreatedBy: 'u-v1' }, ON), true);
    assert.equal(canReviewCandidate(admin, reasignada, ON), true);
  });
});
