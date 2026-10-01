"use client";

import * as React from "react";

import { Check, SendHorizonal } from "@/icons";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";

import { t } from "./messages";
import type { ChatQuestion, ChatQuestionOption, ChatQuestionOptionDetail } from "./types";

export interface ChatQuestionCardProps {
  question: ChatQuestion;
  /** Se puede responder: es la última pregunta y no tiene respuesta. */
  active: boolean;
  onAnswer: (option: string) => void;
  /**
   * Extensión de SellUp: la opción que estaba elegida cuando la pregunta se
   * vuelve a hacer (la persona regresó a editar). Se marca, pero no cierra la
   * pregunta como hace `question.answer`: se puede elegir otra.
   */
  selected?: string;
  /** Nombre accesible del grupo. Por defecto «Pulsa el número de la opción». */
  "aria-label"?: string;
  className?: string;
}

const MAX_KEYED = 9;

/** Si lo que tiene el foco es un sitio donde se escribe: ahí los números son números. */
function isTyping(): boolean {
  const element = document.activeElement;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (element as HTMLElement).isContentEditable;
}

function toDetail(option: ChatQuestionOption): ChatQuestionOptionDetail {
  return typeof option === "string" ? { value: option, label: option } : option;
}

/**
 * Una pregunta del agente con opciones numeradas (Thema · `ChatQuestionCard`).
 * Se contesta tocando una, pulsando su número (si no se está escribiendo en
 * otro sitio) o con «Otro». Respondida, se queda mostrando lo que se eligió;
 * solo la última pregunta de la conversación se puede contestar.
 */
export function ChatQuestionCard({ question, active, onAnswer, selected, className, ...props }: ChatQuestionCardProps) {
  const [other, setOther] = React.useState("");
  const otherRef = React.useRef<HTMLInputElement>(null);
  const options = React.useMemo(() => question.options.slice(0, MAX_KEYED).map(toDetail), [question.options]);
  const otherIndex = options.length + 1;
  const answered = question.answer !== undefined;
  const canOther = Boolean(question.otherPlaceholder);

  React.useEffect(() => {
    if (!active || answered) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping()) return;
      const number = Number(event.key);
      if (!Number.isInteger(number) || number < 1) return;
      if (number <= options.length) {
        event.preventDefault();
        onAnswer(options[number - 1].value);
      } else if (canOther && number === otherIndex) {
        event.preventDefault();
        otherRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, answered, options, canOther, otherIndex, onAnswer]);

  const submitOther = () => {
    const value = other.trim();
    if (!value) return;
    onAnswer(value);
    setOther("");
  };

  const chosenIsOther = answered && !options.some((option) => option.value === question.answer);

  return (
    <div
      role="group"
      aria-label={props["aria-label"] ?? t("chat.questionKeyHint")}
      className={cn("chat-rise overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card", className)}
      data-testid="chat-question"
      data-answered={answered || undefined}
    >
      <ol className="divide-y divide-border/60">
        {options.map((option, index) => {
          const chosen = answered ? question.answer === option.value : selected === option.value;
          return (
            <li key={option.value}>
              <button
                type="button"
                disabled={!active || answered}
                onClick={() => onAnswer(option.value)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:bg-primary/5 focus-visible:outline-none",
                  active && !answered && !option.unavailable && "hover:bg-surface-muted",
                  answered && !chosen && "opacity-50",
                  chosen && "bg-primary/5",
                )}
                aria-pressed={chosen}
                aria-disabled={option.unavailable || undefined}
                data-unavailable={option.unavailable || undefined}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        option.unavailable ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {option.label}
                    </span>
                    {option.hint && <span className="text-xs font-medium text-text-muted">{option.hint}</span>}
                  </span>
                  {option.description && (
                    <span className="text-xs leading-relaxed text-muted-foreground">{option.description}</span>
                  )}
                </span>
                {chosen ? (
                  <span role="img" aria-label={t("chat.questionAnswered")} className="shrink-0 text-primary">
                    <Check className="size-4" aria-hidden />
                  </span>
                ) : (
                  // La tecla es una ayuda visual: el grupo ya dice «Pulsa el número de la opción».
                  <Kbd aria-hidden="true">{index + 1}</Kbd>
                )}
              </button>
            </li>
          );
        })}
        {canOther && (
          <li className={cn("flex flex-col gap-2 px-4 py-3", chosenIsOther && "bg-primary/5")}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t("chat.questionOther")}</span>
              {chosenIsOther ? (
                <span role="img" aria-label={t("chat.questionAnswered")} className="shrink-0 text-primary">
                  <Check className="size-4" aria-hidden />
                </span>
              ) : (
                <Kbd aria-hidden="true">{otherIndex}</Kbd>
              )}
            </div>
            {chosenIsOther ? (
              <span className="text-sm text-muted-foreground">{question.answer}</span>
            ) : (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitOther();
                }}
              >
                <input
                  ref={otherRef}
                  value={other}
                  disabled={!active || answered}
                  onChange={(event) => setOther(event.target.value)}
                  placeholder={question.otherPlaceholder}
                  aria-label={t("chat.questionOtherPlaceholder")}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-text-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!active || answered || !other.trim()}
                  aria-label={t("chat.send")}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ai-gradient text-primary-foreground transition-all hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
                >
                  <SendHorizonal className="size-4" aria-hidden />
                </button>
              </form>
            )}
          </li>
        )}
      </ol>
    </div>
  );
}
