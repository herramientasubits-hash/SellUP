/**
 * Qué decirle a una persona cuando algo falla de forma inesperada.
 *
 * Un error lanzado (red, Supabase, un proveedor) trae un mensaje técnico, a
 * menudo en inglés, que no le sirve a quien vende y lo asusta. Aquí se le da la
 * frase de la pantalla —«No se pudo importar…»— más una invitación a reintentar,
 * y el detalle técnico queda en la consola para quien lo depure.
 *
 * Los errores que ya devuelve una acción del servidor (`result.error`) están
 * escritos para la persona y se muestran tal cual: no pasan por aquí.
 */
export function mensajeDeError(error: unknown, queFallo: string): string {
  if (error !== undefined) console.error(`[${queFallo}]`, error);
  return `${queFallo}. Inténtalo de nuevo en un momento; si sigue fallando, avisa al equipo.`;
}
