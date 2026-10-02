"use client";

import * as React from "react"
import { Minus, Plus } from "@/icons"

import { cn } from "@/lib/utils"

/**
 * Campo numérico con botones de − y +.
 *
 * Usa `<input type="text" inputMode="decimal">` a propósito: con `type="number"`
 * la rueda del ratón cambia el valor sin querer al desplazar la página, y el
 * navegador se queda con el formato del número en lugar de dejárnoslo a nosotros.
 * El patrón accesible lo da `role="spinbutton"` + `aria-valuenow/min/max`.
 *
 * Port de Thema `forms/NumberField`: misma anatomía y props. Dentro de un
 * `Field` recibe el `id` y el `aria-describedby` en el `<input>`; con `name`
 * participa en un `<form>` como cualquier campo de texto.
 */

export type NumberFieldSize = "sm" | "default"
export type NumberFieldStepper = "inline" | "sides" | "none"

export interface NumberFieldProps
  extends Omit<
    React.ComponentProps<"input">,
    "value" | "defaultValue" | "onChange" | "size" | "prefix" | "step" | "min" | "max" | "type" | "role"
  > {
  /** Valor controlado. `null` o `undefined` dejan el campo vacío. */
  value?: number | null
  /** Valor inicial cuando el campo no está controlado. */
  defaultValue?: number
  /** Se llama con el valor ya saneado; `null` cuando el campo queda vacío. */
  onValueChange?: (value: number | null) => void
  min?: number
  max?: number
  /** Salto de las flechas y los botones. */
  step?: number
  /** Decimales fijos al mostrar el valor. Si no se pasa, se deducen del `step`. */
  precision?: number
  size?: NumberFieldSize
  /** Adorno a la izquierda del número (p. ej. «$»). */
  prefix?: React.ReactNode
  /** Adorno a la derecha del número (p. ej. «horas», «%»). */
  suffix?: React.ReactNode
  /** `inline`: botones pegados a la derecha. `sides`: − a la izquierda y + a la derecha. */
  stepper?: NumberFieldStepper
}

const SIZES = {
  default: { box: "h-10", square: "size-10", padding: "px-3.5", paddingInline: "pl-3.5 pr-1", button: "size-8", icon: "size-4" },
  sm: { box: "h-8", square: "size-8", padding: "px-2.5", paddingInline: "pl-2.5 pr-0.5", button: "size-6", icon: "size-3.5" },
} as const satisfies Record<NumberFieldSize, Record<string, string>>

/** Multiplicador de PageUp/PageDown frente al salto normal. */
const PAGE_MULTIPLIER = 10
/** Multiplicador cuando se mantiene Shift. */
const SHIFT_MULTIPLIER = 10

function countDecimals(value: number): number {
  const [, decimals = ""] = String(value).split(".")
  return decimals.length
}

function clamp(value: number, min?: number, max?: number): number {
  if (min !== undefined && value < min) return min
  if (max !== undefined && value > max) return max
  return value
}

/** Corta el arrastre de coma flotante (0.1 + 0.2) sin perder precisión real. */
function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(Math.min(Math.max(decimals, 0), 15)))
}

/** Acepta coma o punto como separador decimal; `null` si no hay número. */
function parseNumber(raw: string): number | null {
  const normalized = raw.replace(/\s/g, "").replace(",", ".")
  if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatNumber(value: number | null, precision?: number): string {
  if (value === null) return ""
  return precision === undefined ? String(value) : value.toFixed(precision)
}

interface StepperButtonProps {
  label: string
  icon: React.ReactNode
  disabled: boolean
  bordered: boolean
  sizeClass: string
  onStep: () => void
}

function StepperButton({ label, icon, disabled, bordered, sizeClass, onStep }: StepperButtonProps) {
  return (
    <button
      type="button"
      // El patrón accesible del spinbutton ya vive en el input (flechas,
      // PageUp/PageDown): sacar los botones del orden de tabulación evita
      // tres paradas de teclado por cada campo sin quitar nada.
      tabIndex={-1}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onStep}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-surface-subtle hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:opacity-40",
        bordered && "border border-input bg-card dark:bg-muted",
        sizeClass
      )}
    >
      {icon}
    </button>
  )
}

export function NumberField({
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  step = 1,
  precision,
  size = "default",
  prefix,
  suffix,
  stepper = "inline",
  disabled,
  readOnly,
  className,
  onBlur,
  onKeyDown,
  ...props
}: NumberFieldProps) {
  const sizes = SIZES[size]
  const decimals = precision ?? countDecimals(step)
  const isControlled = value !== undefined

  const [uncontrolled, setUncontrolled] = React.useState<number | null>(defaultValue ?? null)
  const current = isControlled ? (value ?? null) : uncontrolled

  const [text, setText] = React.useState(() => formatNumber(current, precision))
  // Patrón de React para «ajustar estado durante el render»: solo reescribimos
  // el texto cuando el valor llega de fuera, nunca mientras se escribe (si no,
  // «3,» se convertiría en «3» en mitad de la pulsación).
  const [seenValue, setSeenValue] = React.useState(current)
  if (seenValue !== current) {
    setSeenValue(current)
    setText(formatNumber(current, precision))
  }

  const live = parseNumber(text)
  const interactive = !disabled && !readOnly

  const emit = (next: number | null) => {
    setSeenValue(next)
    if (!isControlled) setUncontrolled(next)
    onValueChange?.(next)
  }

  const commit = (next: number | null) => {
    const resolved = next === null ? null : roundTo(clamp(next, min, max), decimals)
    setText(formatNumber(resolved, precision))
    emit(resolved)
  }

  const stepBy = (direction: 1 | -1, multiplier: number) => {
    if (!interactive) return
    if (live === null) {
      commit(min ?? 0)
      return
    }
    commit(live + direction * step * multiplier)
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setText(event.target.value)
    emit(parseNumber(event.target.value))
  }

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    commit(live)
    onBlur?.(event)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const multiplier = event.shiftKey ? SHIFT_MULTIPLIER : 1
    if (event.key === "ArrowUp") {
      event.preventDefault()
      stepBy(1, multiplier)
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      stepBy(-1, multiplier)
    } else if (event.key === "PageUp") {
      event.preventDefault()
      stepBy(1, PAGE_MULTIPLIER * multiplier)
    } else if (event.key === "PageDown") {
      event.preventDefault()
      stepBy(-1, PAGE_MULTIPLIER * multiplier)
    }
    onKeyDown?.(event)
  }

  const atMin = min !== undefined && live !== null && live <= min
  const atMax = max !== undefined && live !== null && live >= max

  const minusButton = (bordered: boolean) => (
    <StepperButton
      label="Restar"
      icon={<Minus className={sizes.icon} aria-hidden="true" />}
      disabled={!interactive || atMin}
      bordered={bordered}
      sizeClass={bordered ? sizes.square : sizes.button}
      onStep={() => stepBy(-1, 1)}
    />
  )

  const plusButton = (bordered: boolean) => (
    <StepperButton
      label="Sumar"
      icon={<Plus className={sizes.icon} aria-hidden="true" />}
      disabled={!interactive || atMax}
      bordered={bordered}
      sizeClass={bordered ? sizes.square : sizes.button}
      onStep={() => stepBy(1, 1)}
    />
  )

  return (
    <div data-slot="number-field" className={cn("flex w-full items-center gap-2", className)}>
      {stepper === "sides" && minusButton(true)}

      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-card transition-all dark:bg-muted",
          "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30",
          sizes.box,
          stepper === "inline" ? sizes.paddingInline : sizes.padding,
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        {prefix ? (
          <span className="shrink-0 text-sm text-muted-foreground" aria-hidden="true">
            {prefix}
          </span>
        ) : null}

        <input
          {...props}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          role="spinbutton"
          aria-valuenow={live ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          value={text}
          disabled={disabled}
          readOnly={readOnly}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-full min-w-0 bg-transparent text-sm text-foreground tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />

        {suffix ? (
          <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground" aria-hidden="true">
            {suffix}
          </span>
        ) : null}

        {stepper === "inline" ? (
          <div className="flex shrink-0 items-center gap-0.5">
            {minusButton(false)}
            {plusButton(false)}
          </div>
        ) : null}
      </div>

      {stepper === "sides" && plusButton(true)}
    </div>
  )
}
