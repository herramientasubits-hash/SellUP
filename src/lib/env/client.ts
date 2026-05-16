/**
 * Environment Variables Configuration
 *
 * Este archivo proporciona validación de variables de entorno para el cliente.
 * En una fase posterior, se implementará validación más robusta.
 */

/**
 * Variables de entorno requeridas para el cliente
 */
export const requiredClientEnvVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

/**
 * Verifica si las variables de entorno del cliente están configuradas
 */
export function hasClientEnvVars(): boolean {
  return requiredClientEnvVars.every(
    (key) => process.env[key] !== undefined && process.env[key] !== "",
  );
}
