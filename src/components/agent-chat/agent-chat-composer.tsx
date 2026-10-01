'use client';

import * as React from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ── Neutral conversational composer ───────────────────────────────────────────
// Two modes: 'text' (the user can type and send) and 'locked' (waiting for an
// in-conversation action / loading). Visual language matches the Agente 1
// composer, kept domain-agnostic for reuse.

export type AgentChatComposerMode = 'text' | 'locked';

export interface AgentChatComposerProps {
  mode: AgentChatComposerMode;
  value: string;
  placeholder: string;
  maxLength?: number;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
}

export function AgentChatComposer({
  mode,
  value,
  placeholder,
  maxLength = 200,
  onChange,
  onSubmit,
}: AgentChatComposerProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const isTextInput = mode === 'text';
  const isLocked = !isTextInput;

  const charCount = value.length;
  const overLimit = isTextInput && charCount > maxLength;
  const canSend = isTextInput && value.trim().length > 0 && !overLimit;

  // Auto-grow textarea height
  React.useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || isLocked) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [value, isLocked]);

  // Focus textarea as soon as the composer unlocks
  React.useEffect(() => {
    if (!isTextInput) return;
    const id = setTimeout(() => textareaRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [isTextInput]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSubmit?.();
    }
  }

  return (
    <div
      aria-label="Campo de respuesta al asistente"
      className={cn(
        'rounded-xl border transition-colors',
        isLocked
          ? 'border-border/60 bg-surface-subtle'
          : 'border-border bg-card focus-within:border-primary/40 focus-within:ring-3 focus-within:ring-ring/30',
      )}
    >
      <div className="flex items-end gap-2 px-3 py-2.5">
        <textarea
          ref={textareaRef}
          aria-label="Respuesta al asistente"
          aria-disabled={isLocked}
          disabled={isLocked}
          value={isTextInput ? value : ''}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className={cn(
            'min-w-0 flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground',
            isLocked ? 'cursor-default text-muted-foreground' : 'text-foreground',
          )}
          style={{ minHeight: '20px', maxHeight: '120px' }}
          tabIndex={isLocked ? -1 : 0}
        />
        <Button
          type="button"
          size="icon-xs"
          disabled={!canSend}
          onClick={canSend ? onSubmit : undefined}
          aria-label="Enviar respuesta"
          style={
            canSend
              ? {
                  background:
                    'linear-gradient(135deg, var(--su-ai-stop-1) 0%, var(--su-ai-stop-3) 100%)',
                  boxShadow: 'var(--su-ai-send-shadow)',
                }
              : undefined
          }
          className={cn(
            'shrink-0 rounded-full transition-all',
            canSend
              ? 'text-primary-foreground hover:opacity-90 active:scale-95'
              : 'bg-muted text-text-muted',
          )}
        >
          <ArrowUp aria-hidden />
        </Button>
      </div>

      {isTextInput && charCount > 0 && (
        <div className="flex items-center justify-between px-3 pb-2 pt-0">
          <span className="text-xs text-muted-foreground">
            Shift+Enter para nueva línea
          </span>
          <span
            aria-live="polite"
            aria-atomic="true"
            className={cn(
              'text-xs tabular-nums',
              overLimit ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {charCount}/{maxLength}
          </span>
        </div>
      )}
    </div>
  );
}
