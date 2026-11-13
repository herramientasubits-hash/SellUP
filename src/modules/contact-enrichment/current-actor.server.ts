// ============================================================
// Quién pide (servidor), para las acciones de contactos y teléfonos.
//
// Una sola lectura del usuario actual, construida sobre `getCurrentUser()` e
// `isCurrentUserAdmin()` de `@/modules/access/actions`, para que «Ver como…»
// (vista previa de rol) se respete también aquí: mientras una persona prueba
// otro rol, sus acciones ven ESE rol y no se la trata como administradora.
// Antes cada acción leía `internal_users` + `roles` directo de la base y se
// saltaba la vista previa.
//
// Sin 'use server' a propósito: es un ayudante del servidor, no una acción.
// ============================================================

import { redirect } from 'next/navigation';
import { getCurrentUser, isCurrentUserAdmin } from '@/modules/access/actions';

export interface CurrentActor {
  internalUserId: string;
  /** Rol efectivo (el de «Ver como…» si está activo). */
  roleKey: string | null;
  /** Administrador efectivo: `false` mientras dure «Ver como…». */
  isAdmin: boolean;
  /** Acceso activo. */
  active: boolean;
}

/** Usuario actual o `null` si no hay sesión o no tiene usuario interno. */
export async function resolveCurrentActor(): Promise<CurrentActor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const active = user.access_status === 'active';
  const isAdmin = active ? await isCurrentUserAdmin() : false;
  return {
    internalUserId: user.id,
    roleKey: typeof user.role_key === 'string' ? user.role_key : null,
    isAdmin,
    active,
  };
}

/**
 * Usuario actual ACTIVO. Sin sesión, sin usuario interno o sin acceso activo
 * redirige (a /login por defecto), como hacían las acciones hasta ahora.
 */
export async function requireActiveActor(redirectTo: string = '/login'): Promise<CurrentActor> {
  const actor = await resolveCurrentActor();
  if (!actor || !actor.active) redirect(redirectTo);
  return actor;
}
