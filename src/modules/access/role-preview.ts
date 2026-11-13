// ============================================================
// «Ver como…» — vista previa de rol para probar permisos (dueña 12-11).
// Sólo para quien está en ROLE_PREVIEW_EMAILS y es administrador de verdad.
// Elige una persona real (su rol y su lugar en el organigrama) y SellUp le
// muestra lo que ve esa persona: menú, alcance en cascada, capacidades.
// Sólo puede RESTRINGIR lo que ve un admin; nunca ampliar. Lo que hace sigue
// quedando a su nombre (no es suplantar a nadie).
// Puro: sin Next ni Supabase (se usa en servidor y en cliente).
// ============================================================

export const ROLE_PREVIEW_COOKIE = 'sellup_role_preview';
/** Ocho horas: una sesión de pruebas; después vuelve solo a su rol. */
export const ROLE_PREVIEW_MAX_AGE_SECONDS = 8 * 60 * 60;

/** Quién puede usar «Ver como…». */
export const ROLE_PREVIEW_EMAILS: readonly string[] = ['egarcia@ubits.co'];

/** Roles que se pueden previsualizar (admin es el propio). */
export const PREVIEWABLE_ROLE_KEYS = ['commercial_manager', 'commercial_lead', 'seller_bd', 'growth'] as const;
export type PreviewableRoleKey = (typeof PREVIEWABLE_ROLE_KEYS)[number];

export function isPreviewableRole(roleKey: string | null | undefined): roleKey is PreviewableRoleKey {
  return !!roleKey && (PREVIEWABLE_ROLE_KEYS as readonly string[]).includes(roleKey);
}

/** ¿Puede esta persona usar «Ver como…»? Admin de verdad y en la lista. */
export function canUseRolePreview(real: { email: string | null | undefined; roleKey: string | null | undefined }): boolean {
  const email = real.email?.trim().toLowerCase() ?? '';
  return real.roleKey === 'admin' && ROLE_PREVIEW_EMAILS.includes(email);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El valor de la cookie: el id de la persona como quien se mira. */
export function parseRolePreviewCookie(value: string | null | undefined): string | null {
  const v = value?.trim() ?? '';
  return UUID.test(v) ? v.toLowerCase() : null;
}

/** Lo que el menú y el aviso necesitan saber (sólo datos serializables). */
export interface RolePreviewState {
  /** Puede usar «Ver como…» (sólo la persona autorizada). */
  allowed: boolean;
  /** Si está mirando como otra persona: su rol y su nombre. */
  active: { roleKey: PreviewableRoleKey; asName: string } | null;
}
