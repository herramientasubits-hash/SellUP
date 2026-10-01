"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  findCountry,
  formatNational,
  parseE164,
  type Country,
  type CountryCode,
} from "./phone-countries"

/**
 * Teléfono con prefijo de país — port de Thema `forms/PhoneInput`: misma
 * anatomía y props.
 *
 * Hacia dentro se escribe en grupos («300 123 4567»); hacia fuera siempre sale
 * E.164 («+573001234567»). El selector de país es el `Select` del sistema y no
 * el `SearchableSelect`: son veinte países y el Select ya trae typeahead.
 *
 * Solo emite cuando la persona escribe o cambia de país: montarlo con un valor
 * no dispara `onValueChange`, así que un teléfono que no se toca no se reescribe.
 *
 * Dentro de un `Field` recibe el `id` y el `aria-describedby` en el `<input>`.
 */

export interface PhoneInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type" | "prefix"> {
  /** Valor controlado en E.164, p. ej. «+573001234567». */
  value?: string
  /** Se llama con el número en E.164; cadena vacía si no hay dígitos. */
  onValueChange?: (value: string) => void
  /** País preseleccionado cuando no hay valor. */
  defaultCountry?: CountryCode
  /** Lista de países a ofrecer; por defecto LATAM + ES + US. */
  countries?: readonly Country[]
  placeholder?: string
}

export function PhoneInput({
  value,
  onValueChange,
  defaultCountry = DEFAULT_PHONE_COUNTRY,
  countries = PHONE_COUNTRIES,
  disabled,
  placeholder,
  className,
  id,
  ...props
}: PhoneInputProps) {
  const isControlled = value !== undefined
  const [countryCode, setCountryCode] = React.useState<CountryCode>(defaultCountry)
  const [uncontrolledDigits, setUncontrolledDigits] = React.useState("")

  const parsed = isControlled ? parseE164(value, countries, countryCode) : undefined
  const country = findCountry(parsed?.country?.code ?? countryCode, countries)
  const digits = (isControlled ? (parsed?.national ?? "") : uncontrolledDigits).slice(0, country.length)

  const emit = (nextCountry: Country, nextDigits: string) => {
    setCountryCode(nextCountry.code)
    if (!isControlled) setUncontrolledDigits(nextDigits)
    onValueChange?.(nextDigits ? `${nextCountry.dialCode}${nextDigits}` : "")
  }

  const handleCountryChange = (code: string | null) => {
    if (!code) return
    const next = findCountry(code as CountryCode, countries)
    emit(next, digits.slice(0, next.length))
  }

  const handleDigitsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    emit(country, event.target.value.replace(/\D/g, "").slice(0, country.length))
  }

  return (
    <div data-slot="phone-input" className={cn("flex w-full items-center gap-2", className)}>
      <Select value={country.code} onValueChange={handleCountryChange} disabled={disabled}>
        <SelectTrigger aria-label="Prefijo de país" className="w-28 shrink-0">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">{country.flag}</span>
            <span className="tabular-nums">{country.dialCode}</span>
          </span>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className="max-h-72 !w-auto min-w-(--anchor-width)">
          {countries.map((option) => (
            <SelectItem key={option.code} value={option.code}>
              <span className="flex items-center gap-2">
                <span aria-hidden="true">{option.flag}</span>
                <span>{option.name}</span>
                <span className="text-text-muted tabular-nums">{option.dialCode}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <input
        {...props}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        disabled={disabled}
        value={formatNational(digits, country.groups)}
        onChange={handleDigitsChange}
        placeholder={placeholder ?? formatNational("0".repeat(country.length), country.groups)}
        className={cn(
          "h-10 w-full min-w-0 flex-1 rounded-md border border-input bg-card px-3.5 text-sm text-foreground tabular-nums transition-all outline-none dark:bg-muted",
          "placeholder:text-muted-foreground",
          "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      />
    </div>
  )
}
