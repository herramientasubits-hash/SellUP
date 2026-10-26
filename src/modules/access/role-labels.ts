/**
 * Cómo se nombra cada rol en la interfaz. Refleja los roles sembrados en la
 * migración 001. Vive aparte para que lo lean tanto el servidor (filtros de
 * alcance) como el cliente (el chip de la cabecera): antes el chip pintaba la
 * clave cruda, «Seller bd».
 */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  admin: 'Administrador',
  seller_bd: 'Vendedor / BD',
  commercial_manager: 'Manager comercial',
  commercial_lead: 'Líder comercial',
  growth: 'Growth',
};

/** El nombre del rol en español; si es uno nuevo sin nombre, la clave legible. */
export function roleLabelFor(roleKey: string | null | undefined): string {
  if (!roleKey) return 'Miembro';
  return ROLE_LABELS[roleKey] ?? roleKey.charAt(0).toUpperCase() + roleKey.slice(1).replace(/_/g, ' ');
}
