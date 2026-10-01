import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Text } from "@/components/typography";

import type { ChatCard } from "./types";

const TONE: Record<"positive" | "negative" | "neutral", string> = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-text-muted",
};

export interface ChatCardViewProps {
  card: ChatCard;
  className?: string;
  /** `data-testid` de la tarjeta. Por defecto `chat-card`. */
  "data-testid"?: string;
  /**
   * Prefijo de los `data-testid` de cada fila y de su valor en una tarjeta
   * `rows` (`<prefijo>-row-<key>` y `<prefijo>-value-<key>`). Por defecto, el
   * `data-testid` de la tarjeta.
   */
  rowTestIdPrefix?: string;
  /** Sufijo del `data-testid` del valor de cada fila. Por defecto `value`. */
  valueTestIdSuffix?: string;
}

/**
 * Una tarjeta con datos dentro de una respuesta (Thema · `ChatCardView`):
 * barras por categoría o unas cifras. El rótulo va en caja normal: SellUp no
 * usa versalitas con tracking.
 */
export function ChatCardView({
  card,
  className,
  rowTestIdPrefix,
  valueTestIdSuffix = "value",
  ...props
}: ChatCardViewProps) {
  const testId = props["data-testid"] ?? "chat-card";
  if (card.kind === "rows") {
    const prefix = rowTestIdPrefix ?? testId;
    return (
      <div
        className={cn("chat-rise rounded-2xl border border-border/70 bg-surface-muted p-4", className)}
        data-testid={testId}
        data-kind="rows"
      >
        {card.title && (
          <Text size="xs" weight="semibold" tone="muted" className="mb-3">
            {card.title}
          </Text>
        )}
        <dl className="flex flex-col gap-2.5">
          {card.rows.map((row) => (
            <div key={row.key} className="flex flex-col gap-0.5" data-testid={`${prefix}-row-${row.key}`}>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-xs text-muted-foreground">{row.label}</dt>
                <dd
                  className="shrink-0 text-sm font-semibold tabular-nums text-foreground"
                  data-testid={row.testId ?? `${prefix}-${valueTestIdSuffix}-${row.key}`}
                >
                  {row.value}
                </dd>
              </div>
              {row.hint != null && row.hint !== "" && (
                <p className="text-xs leading-snug text-text-muted">{row.hint}</p>
              )}
            </div>
          ))}
        </dl>
      </div>
    );
  }
  if (card.kind === "bars") {
    const max = Math.max(100, ...card.rows.map((row) => row.value));
    return (
      <div
        className={cn("chat-rise rounded-2xl border border-border/70 bg-surface-muted p-4", className)}
        data-testid={testId}
      >
        <Text size="xs" weight="semibold" tone="muted">
          {card.title}
        </Text>
        <dl className="mt-3 flex flex-col gap-2.5">
          {card.rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-3">
              <dt className="truncate text-sm text-foreground">{row.label}</dt>
              <Progress value={(row.value / max) * 100} className="h-1.5" />
              <dd className="text-right text-xs tabular-nums text-muted-foreground">
                {row.display ?? `${row.value}%`}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  return (
    <div
      className={cn("chat-rise rounded-2xl border border-border/70 bg-surface-muted p-4", className)}
      data-testid={testId}
    >
      {card.title && (
        <Text size="xs" weight="semibold" tone="muted" className="mb-3">
          {card.title}
        </Text>
      )}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {card.items.map((item) => (
          <div key={item.label} className="flex flex-col gap-0.5">
            <dt className="text-xs text-text-muted">{item.label}</dt>
            <dd className="text-xl font-semibold tabular-nums tracking-tight text-foreground">{item.value}</dd>
            {item.delta && <span className={cn("text-xs", TONE[item.tone ?? "neutral"])}>{item.delta}</span>}
          </div>
        ))}
      </dl>
    </div>
  );
}
