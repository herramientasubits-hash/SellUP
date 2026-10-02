"use client";

import * as React from "react";

import { Check, ChevronDown, ChevronUp, Search } from "@/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

import type { ChatQuestionOption, ChatQuestionOptionDetail } from "./types";

/** Con más opciones que estas aparece el filtro de arriba. */
const FILTER_THRESHOLD = 8;
/** Las teclas de número llegan hasta aquí. */
const MAX_KEYED = 9;

export interface ChatQuestionPanelProps {
  /** La pregunta, en el encabezado de la tarjeta. */
  title: React.ReactNode;
  /** Una línea de ayuda bajo la pregunta. */
  description?: React.ReactNode;
  options: readonly ChatQuestionOption[];
  /**
   * `single`: tocar una opción (o pulsar su número) responde al instante.
   * `multiple`: las opciones se marcan y se envían con «Enviar».
   */
  mode?: "single" | "multiple";
  /** Lo que ya está elegido (al volver a editar, o lo marcado en `multiple`). */
  selected?: readonly string[];
  /** Tope de opciones marcadas en `multiple`. */
  max?: number;
  /** `single`: la opción elegida. */
  onAnswer?: (value: string) => void;
  /** `multiple`: cada cambio de lo marcado. */
  onSelectionChange?: (values: string[]) => void;
  /** `multiple`: «Enviar» con lo marcado. */
  onSubmitSelection?: (values: string[]) => void;
  /** Placeholder de «Otro»; sin él no hay campo libre. */
  otherPlaceholder?: string;
  onOther?: (text: string) => void;
  otherMaxLength?: number;
  /** Sin él no hay «Omitir». */
  onSkip?: () => void;
  skipLabel?: string;
  /** Avisos y errores de la pregunta, bajo las opciones. */
  footerNotice?: React.ReactNode;
  /** Ref al encabezado, para llevar el foco a la pregunta nueva. */
  titleRef?: React.Ref<HTMLHeadingElement>;
  filterPlaceholder?: string;
  className?: string;
  "aria-label"?: string;
}

function toDetail(option: ChatQuestionOption): ChatQuestionOptionDetail {
  return typeof option === "string" ? { value: option, label: option } : option;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Si lo que tiene el foco es un sitio donde se escribe: ahí los números son números. */
function isTyping(): boolean {
  const element = document.activeElement;
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    (element as HTMLElement).isContentEditable
  );
}

/**
 * La pregunta del agente, acoplada al pie del panel en el lugar de la caja de
 * escribir: la pregunta arriba, las opciones numeradas, «Otro» con su campo y,
 * abajo, «Omitir» y «Enviar». Es la misma forma para todo lo que el agente
 * pregunta —tipo de búsqueda, país, industria, subindustrias, criterios—, para
 * que contestar sea siempre el mismo gesto.
 *
 * Con muchas opciones aparece un filtro arriba (los números siguen a lo que se
 * ve). Se puede plegar para releer la conversación sin perder la pregunta.
 */
export function ChatQuestionPanel({
  title,
  description,
  options,
  mode = "single",
  selected = [],
  max,
  onAnswer,
  onSelectionChange,
  onSubmitSelection,
  otherPlaceholder,
  onOther,
  otherMaxLength,
  onSkip,
  skipLabel = "Omitir",
  footerNotice,
  titleRef,
  filterPlaceholder = "Filtrar opciones",
  className,
  ...props
}: ChatQuestionPanelProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [other, setOther] = React.useState("");
  const otherRef = React.useRef<HTMLInputElement>(null);
  const panelId = React.useId();

  const all = React.useMemo(() => options.map(toDetail), [options]);
  const showFilter = all.length > FILTER_THRESHOLD;
  const visible = React.useMemo(() => {
    const query = normalize(filter.trim());
    if (!query) return all;
    return all.filter((option) =>
      normalize(`${option.label} ${option.description ?? ""}`).includes(query),
    );
  }, [all, filter]);

  const isMultiple = mode === "multiple";
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const atMax = isMultiple && typeof max === "number" && selected.length >= max;
  const canOther = Boolean(otherPlaceholder && onOther);
  const otherIndex = Math.min(visible.length, MAX_KEYED) + 1;

  const choose = React.useCallback(
    (value: string) => {
      if (!isMultiple) {
        onAnswer?.(value);
        return;
      }
      const next = selectedSet.has(value)
        ? selected.filter((item) => item !== value)
        : atMax
          ? [...selected]
          : [...selected, value];
      onSelectionChange?.(next);
    },
    [isMultiple, onAnswer, onSelectionChange, selected, selectedSet, atMax],
  );

  React.useEffect(() => {
    if (collapsed) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping()) return;
      const number = Number(event.key);
      if (!Number.isInteger(number) || number < 1) return;
      if (number <= Math.min(visible.length, MAX_KEYED)) {
        event.preventDefault();
        choose(visible[number - 1].value);
      } else if (canOther && number === otherIndex) {
        event.preventDefault();
        otherRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, visible, choose, canOther, otherIndex]);

  const otherText = other.trim();
  const canSubmit = otherText.length > 0 || (isMultiple && selected.length > 0);
  const submit = () => {
    if (otherText && onOther) {
      onOther(otherText);
      setOther("");
      return;
    }
    if (isMultiple && selected.length > 0) onSubmitSelection?.([...selected]);
  };

  return (
    <section
      aria-label={props["aria-label"]}
      className={cn(
        "chat-rise overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card",
        className,
      )}
      data-testid="chat-question-panel"
    >
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <h3
            ref={titleRef}
            tabIndex={-1}
            className="text-sm font-semibold leading-snug text-foreground focus:outline-none"
          >
            {title}
          </h3>
          {description && !collapsed && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-expanded={!collapsed}
          aria-controls={panelId}
          aria-label={
            collapsed ? "Mostrar las opciones" : "Plegar las opciones"
          }
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
        </Button>
      </header>

      <div id={panelId} hidden={collapsed}>
        {showFilter && (
          <div className="px-3 pb-2">
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={filterPlaceholder}
                aria-label={filterPlaceholder}
                className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-text-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
          </div>
        )}

        <ol
          role={isMultiple ? "group" : undefined}
          aria-label={
            isMultiple ? "Opciones; puedes marcar varias" : "Opciones"
          }
          className={cn(
            "flex flex-col gap-1.5 px-3",
            showFilter && "max-h-64 overflow-y-auto",
          )}
        >
          {visible.map((option, index) => {
            const chosen = selectedSet.has(option.value);
            const blockedByMax = isMultiple && atMax && !chosen;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => choose(option.value)}
                  disabled={blockedByMax}
                  aria-pressed={chosen}
                  aria-disabled={option.unavailable || undefined}
                  data-unavailable={option.unavailable || undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl bg-surface-subtle px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    !option.unavailable && "hover:bg-surface-muted",
                    chosen &&
                      "bg-primary/10 ring-1 ring-primary/40 hover:bg-primary/10",
                    blockedByMax && "opacity-50",
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          option.unavailable
                            ? "text-muted-foreground"
                            : "text-foreground",
                        )}
                      >
                        {option.label}
                      </span>
                      {option.hint && (
                        <span className="text-xs font-medium text-text-muted">
                          {option.hint}
                        </span>
                      )}
                    </span>
                    {option.description && (
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {chosen ? (
                    <span
                      role="img"
                      aria-label="Elegida"
                      className="shrink-0 text-primary"
                    >
                      <Check className="size-4" aria-hidden />
                    </span>
                  ) : index < MAX_KEYED ? (
                    <Kbd aria-hidden="true">{index + 1}</Kbd>
                  ) : null}
                </button>
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">
              Ninguna opción coincide.
            </li>
          )}

          {canOther && (
            <li className="flex flex-col gap-2 rounded-xl bg-surface-subtle px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  Otro
                </span>
                <Kbd aria-hidden="true">{otherIndex}</Kbd>
              </div>
              <input
                ref={otherRef}
                value={other}
                maxLength={otherMaxLength}
                onChange={(event) => setOther(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={otherPlaceholder}
                aria-label={otherPlaceholder}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-text-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </li>
          )}
        </ol>

        {footerNotice && <div className="px-4 pt-2">{footerNotice}</div>}

        {(onSkip || canOther || isMultiple) && (
          <footer className="flex items-center justify-between gap-2 px-4 pb-3 pt-3">
            {isMultiple && typeof max === "number" ? (
              <span
                className="text-xs tabular-nums text-muted-foreground"
                aria-live="polite"
              >
                {selected.length}/{max} seleccionadas
              </span>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {onSkip && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onSkip}
                >
                  {skipLabel}
                </Button>
              )}
              {(canOther || isMultiple) && (
                <Button
                  type="button"
                  size="sm"
                  disabled={!canSubmit}
                  onClick={submit}
                >
                  Enviar
                </Button>
              )}
            </div>
          </footer>
        )}
        {!(onSkip || canOther || isMultiple) && <div className="h-3" />}
      </div>
    </section>
  );
}
