// Agente 2A — AUTORIDAD CANÓNICA de rol del reveal de teléfono
// (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1)
//
// Módulo diminuto y SIN dependencias a propósito, siguiendo el patrón que el repo ya
// usa para las listas de roles compartidas: lo importan un server component
// (contact-candidates-panel), varios cores puros y las server actions, así que no
// puede arrastrar el cliente de Supabase ni ningún import de servidor.
//
// POR QUÉ EXISTE: antes había DOS listas — la del reveal Apollo, dentro de
// `phone-reveal-core.ts`, y una copia literal escrita a mano en el server component —
// y ADEMÁS una tercera lista propia del waterfall que era más estrecha (`['admin']`).
// Eso partía el producto en dos: un `commercial_manager` con permiso de revelar
// teléfono obtenía Apollo-only, y un `admin` obtenía Apollo → Lusha. La autorización
// de ROL no debe decidir QUÉ flujo corre; solo SI el actor puede revelar.
//
// El waterfall NO tiene autoridad de rol propia: la reutiliza (ver
// `isPhoneRevealWaterfallRoleAuthorized` en phone-reveal-waterfall-core.ts).
// Quien decide si el waterfall corre es el flag `ENABLE_PHONE_REVEAL_WATERFALL`,
// que es el master switch, nunca el rol.
//
// Lo que este módulo NO es: no es la autoridad de las OTRAS operaciones pagadas
// admin-only, que siguen teniendo su propia lista deliberadamente más estrecha —
// el fallback manual de Lusha, «Buscar más números», la revisión manual del
// recovery, la supresión de caché y el disclosure de números ya guardados. Ninguna
// de ellas es el botón «Revelar teléfono».

/**
 * Roles autorizados a disparar un reveal de teléfono: Administrador y Manager
 * comercial. ÚNICA fuente de verdad; nadie debe volver a escribir esta pareja.
 */
export const PHONE_REVEAL_AUTHORIZED_ROLE_KEYS: readonly string[] = [
  'admin',
  'commercial_manager',
];

/**
 * `PHONE_REVEAL_ALLOWED(actor)` del contrato de Product. Un rol ausente, vacío o
 * desconocido NO está autorizado (fail-closed).
 */
export function isPhoneRevealRoleAuthorized(roleKey: string | null | undefined): boolean {
  if (typeof roleKey !== 'string') return false;
  const trimmed = roleKey.trim();
  return trimmed.length > 0 && PHONE_REVEAL_AUTHORIZED_ROLE_KEYS.includes(trimmed);
}
