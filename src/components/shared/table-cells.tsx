import type { ReactNode } from "react";
import { ExternalLink, type LucideIcon } from "@/icons";

import { cn } from "@/lib/utils";

/**
 * Celdas que se repiten en todas las listas, para que el mismo dato se lea
 * igual en todas: el vacío, el país y el enlace que sale de SellUp.
 */

/** Los países con los que trabaja SellUp, con el nombre que se muestra. */
const COUNTRY_NAMES: Record<string, string> = {
  AR: "Argentina",
  BO: "Bolivia",
  BR: "Brasil",
  CL: "Chile",
  CO: "Colombia",
  CR: "Costa Rica",
  DO: "Rep. Dominicana",
  EC: "Ecuador",
  ES: "España",
  GT: "Guatemala",
  HN: "Honduras",
  MX: "México",
  NI: "Nicaragua",
  PA: "Panamá",
  PE: "Perú",
  PY: "Paraguay",
  SV: "El Salvador",
  US: "Estados Unidos",
  UY: "Uruguay",
  VE: "Venezuela",
};

const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - "A".charCodeAt(0);

/** La bandera de un código ISO de dos letras; cadena vacía si no lo es. */
export function countryFlag(code: string | null | undefined): string {
  const normalized = code?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(normalized)) return "";
  return [...normalized]
    .map((letter) => String.fromCodePoint(letter.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET))
    .join("");
}

/** El nombre completo de un país; el propio código si no se conoce. */
export function countryName(code: string | null | undefined): string | null {
  const normalized = code?.trim().toUpperCase();
  if (!normalized) return null;
  return COUNTRY_NAMES[normalized] ?? normalized;
}

/** El dato que falta: siempre una raya apagada, nunca un texto distinto por tabla. */
export function EmptyCell({ label = "Sin dato", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("text-xs text-text-muted", className)}>
      <span aria-hidden>—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** El país: bandera y nombre completo, igual en todas las tablas. */
export function CountryCell({ code, className }: { code: string | null | undefined; className?: string }) {
  const name = countryName(code);
  if (!name) return <EmptyCell label="Sin país" />;
  const flag = countryFlag(code);

  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)}>
      {flag && (
        <span aria-hidden className="shrink-0 text-base leading-none">
          {flag}
        </span>
      )}
      <span className="truncate" title={name}>
        {name}
      </span>
    </span>
  );
}

/** Normaliza un dominio o una URL a algo que se puede abrir. */
export function toExternalHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

const LINK_FOCUS =
  "rounded-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40";

interface ExternalLinkCellProps {
  /** Dominio o URL. Sin protocolo se le pone `https://`. */
  href: string;
  /** Lo que se lee. Por defecto, el propio destino. */
  children?: ReactNode;
  /** Icono de qué es (un globo, LinkedIn…). */
  icon?: LucideIcon;
  /** Cómo se anuncia: «Abrir el sitio web de Acme». */
  label?: string;
  className?: string;
}

/**
 * Un enlace que sale de SellUp: icono de qué es, texto recortable y la flecha
 * de «se abre fuera». No dispara el clic de la fila.
 */
export function ExternalLinkCell({ href, children, icon: Icon, label, className }: ExternalLinkCellProps) {
  return (
    <a
      href={toExternalHref(href)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label ? `${label} (se abre en una pestaña nueva)` : undefined}
      title={typeof children === "string" ? children : undefined}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline",
        LINK_FOCUS,
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3 shrink-0" />}
      <span className="truncate">{children ?? href}</span>
      <ExternalLink aria-hidden className="size-2.5 shrink-0 text-text-muted" />
    </a>
  );
}

interface RowTitleButtonProps {
  children: ReactNode;
  onClick: () => void;
  /** Texto completo para el `title` cuando el nombre se recorta. */
  title?: string;
  className?: string;
}

/**
 * El nombre de la fila como botón que abre su detalle: una sola línea, se
 * recorta con su texto completo en el `title`. Sirve igual en la rejilla y en
 * la vista de lista, y no deja que el clic llegue además a la fila.
 */
export function RowTitleButton({ children, onClick, title, className }: RowTitleButtonProps) {
  return (
    <button
      type="button"
      title={title ?? (typeof children === "string" ? children : undefined)}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "block max-w-full min-w-0 truncate text-left text-sm font-semibold text-foreground hover:text-primary focus-visible:text-primary",
        LINK_FOCUS,
        className,
      )}
    >
      {children}
    </button>
  );
}

interface ExternalIconLinkProps {
  href: string;
  icon: LucideIcon;
  /** Obligatorio: un enlace de solo icono necesita nombre. */
  label: string;
  className?: string;
}

/** El mismo enlace, reducido a su icono, para ir junto al nombre de la fila. */
export function ExternalIconLink({ href, icon: Icon, label, className }: ExternalIconLinkProps) {
  return (
    <a
      href={toExternalHref(href)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (se abre en una pestaña nueva)`}
      title={label}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        // 20px: cabe en una fila de una línea sin hacerla más alta.
        "inline-flex size-5 shrink-0 items-center justify-center text-text-muted hover:bg-surface-muted hover:text-primary",
        LINK_FOCUS,
        "rounded-md",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
    </a>
  );
}
