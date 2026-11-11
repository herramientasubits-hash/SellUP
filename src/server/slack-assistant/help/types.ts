// ============================================================
// Guía de uso de SellUp para el asistente de Slack — forma de una ficha.
// Cada ficha se escribe a partir del CÓDIGO de la pantalla (no de memoria) y
// declara las etiquetas que cita con el archivo donde viven: una prueba
// comprueba que siguen existiendo, así una pantalla renombrada no deja la
// guía diciendo algo que ya no está.
// ============================================================

/** Roles de SellUp (role_key). `todos` = cualquier usuario activo. */
export type HelpRole = 'admin' | 'commercial_lead' | 'commercial_manager' | 'seller_bd' | 'growth';

export interface HelpLabelReference {
  /** Texto tal cual aparece en la pantalla (botón, pestaña, título). */
  texto: string;
  /** Archivo (desde la raíz del repo) donde está ese texto. */
  archivo: string;
}

export interface HelpTopic {
  /** Clave estable: `importar-empresas`, `rumbo`… */
  key: string;
  titulo: string;
  /** Palabras con las que la gente pregunta por esto. */
  palabrasClave: string[];
  /** Quién puede usar la función; `todos` = cualquier rol activo. */
  roles: 'todos' | readonly HelpRole[];
  /** Ruta de la pantalla (sin dominio): `/accounts?tab=prospectos`. */
  ruta: string | null;
  /** El texto de ayuda, en formato de Slack (*negrita*, «•» listas). */
  contenido: string;
  /** Lo que NO hace o lo que depende de un administrador (para no prometer de más). */
  limites?: string;
  /** Etiquetas citadas en `contenido`, con su archivo: la prueba las vigila. */
  etiquetas: readonly HelpLabelReference[];
  /**
   * Interruptores (variables de entorno) que deben estar encendidos (`true`)
   * para que la función exista. Apagado ⇒ el bot dice que no está activa en
   * vez de explicar pasos que nadie puede seguir.
   */
  requiere?: readonly string[];
}
