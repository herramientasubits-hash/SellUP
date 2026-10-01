"use client";

import * as React from "react";

import { Chip } from "@/components/ai/chip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Text } from "@/components/typography";

import { t, type ChatMessageKey } from "./messages";

export interface ChatFeedbackPayload {
  reasons: readonly string[];
  comment: string;
  share: boolean;
}

export interface ChatFeedbackFormProps {
  onSubmit: (payload: ChatFeedbackPayload) => void;
  onCancel: () => void;
}

const REASON_KEYS: readonly ChatMessageKey[] = [
  "chat.feedback.wrong",
  "chat.feedback.incomplete",
  "chat.feedback.offTopic",
  "chat.feedback.tone",
  "chat.feedback.other",
];

/** Después de «No útil» (Thema · `ChatFeedbackForm`): qué falló, en dos toques y con un comentario si se quiere. */
export function ChatFeedbackForm({ onSubmit, onCancel }: ChatFeedbackFormProps) {
  const [reasons, setReasons] = React.useState<readonly string[]>([]);
  const [comment, setComment] = React.useState("");
  const [share, setShare] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  if (sent) {
    return (
      <Text size="sm" tone="secondary" role="status" className="chat-rise">
        {t("chat.feedback.thanks")}
      </Text>
    );
  }

  return (
    <form
      className="chat-rise flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface-muted p-4"
      data-testid="chat-feedback"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ reasons, comment: comment.trim(), share });
        setSent(true);
      }}
    >
      <Text size="sm" weight="medium">
        {t("chat.feedback.title")}
      </Text>
      <div className="flex flex-wrap gap-2">
        {REASON_KEYS.map((key) => {
          const label = t(key);
          const selected = reasons.includes(label);
          return (
            <Chip
              key={key}
              label={label}
              size="sm"
              selected={selected}
              onClick={() =>
                setReasons((previous) => (selected ? previous.filter((item) => item !== label) : [...previous, label]))
              }
            />
          );
        })}
      </div>
      <textarea
        rows={2}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder={t("chat.feedback.comment")}
        aria-label={t("chat.feedback.comment")}
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-text-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={share} onCheckedChange={(value) => setShare(value === true)} />
        {t("chat.feedback.consent")}
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={reasons.length === 0 && !comment.trim()}>
          {t("chat.feedback.send")}
        </Button>
      </div>
    </form>
  );
}
