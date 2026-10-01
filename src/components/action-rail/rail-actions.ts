import type * as React from "react"

/**
 * Cuándo aparece una acción.
 *
 * `screen` es lo que se puede hacer en la pantalla mientras no hay nada
 * marcado; `single` lo que solo tiene sentido sobre un registro —editarlo, ver
 * su detalle—; `bulk` lo que se puede hacer con varios a la vez. Una acción
 * puede declarar varios: duplicar vale para uno y para diez.
 */
export type RailActionScope = "screen" | "single" | "bulk"

export interface RailActionSpec {
  id: string
  label: string
  icon: React.ReactNode
  scope: readonly RailActionScope[]
  tone?: "default" | "danger"
  /** La acción rellena del final. Solo una, y solo con `scope: ["screen"]`. */
  primary?: boolean
  /**
   * Se pliega en «más acciones» en vez de ocupar sitio. Es para lo que se
   * toca una vez y se olvida —una configuración, un alta de catálogo—: sigue
   * estando, pero no compite con lo que se hace a diario.
   */
  overflow?: boolean
  /** Añade el recuento a la etiqueta cuando hay varios: «Duplicar (3)». */
  countInLabel?: boolean
  /** Por qué no se puede ahora. La deja a la vista, apagada y explicada. */
  blockedReason?: string | null
  onSelect?: () => void
}

/**
 * En qué contexto está la pantalla según lo que haya marcado.
 *
 * Vive aquí y no en cada componente porque la barra de escritorio y el botón
 * flotante de móvil son la misma pieza en dos formas: si contaran distinto,
 * girar el teléfono cambiaría las acciones disponibles.
 */
export function railModeFor(selectedCount: number): RailActionScope {
  if (selectedCount === 0) return "screen"
  return selectedCount === 1 ? "single" : "bulk"
}

/** Las que aplican a lo que hay marcado, en el orden en que se declararon. */
export function railActionsFor(
  actions: readonly RailActionSpec[],
  selectedCount: number
): readonly RailActionSpec[] {
  const mode = railModeFor(selectedCount)
  return actions.filter((action) => action.scope.includes(mode))
}

/** «Duplicar (3)» con varios marcados; «Duplicar» con uno o ninguno. */
export function railActionLabel(action: RailActionSpec, selectedCount: number): string {
  return action.countInLabel && selectedCount > 1
    ? `${action.label} (${selectedCount})`
    : action.label
}

/** «1 seleccionado» / «3 seleccionadas»: concuerda en número y en género. */
export function selectionLabel(count: number, gender: "f" | "m"): string {
  const base = gender === "f" ? "seleccionada" : "seleccionado"
  return `${count} ${count === 1 ? base : `${base}s`}`
}

/**
 * El reparto de las acciones de pantalla en sus tres pesos: la principal, las
 * que se quedan a la vista y las que se pliegan en «más acciones».
 *
 * Vive aquí y no dentro de la barra porque la cabecera de la pantalla tiene
 * que repartirlas igual: si cada superficie decidiera por su cuenta, mover las
 * acciones de sitio les cambiaría la jerarquía.
 */
export function railScreenTiers(actions: readonly RailActionSpec[]): {
  primary: RailActionSpec | undefined
  inline: readonly RailActionSpec[]
  folded: readonly RailActionSpec[]
} {
  const screen = railActionsFor(actions, 0)
  return {
    primary: screen.find((action) => action.primary),
    inline: screen.filter((action) => !action.primary && !action.overflow),
    folded: screen.filter((action) => !action.primary && action.overflow),
  }
}
