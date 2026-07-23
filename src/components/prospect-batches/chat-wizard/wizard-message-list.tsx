'use client';

import * as React from 'react';
import { AlertTriangle, XCircle, Pencil, Loader2 } from 'lucide-react';
import { AIOrb } from './ai-orb';
import type {
  DerivedWizardMessage,
  EditableWizardStep,
} from '@/modules/prospect-batches/chat-wizard';

// ── Types ─────────────────────────────────────────────────────────────────────

type WizardMessageListProps = {
  messages: DerivedWizardMessage[];
  visibleCount?: number;
  isTyping?: boolean;
  currentStep: string;
  onEditStep: (step: EditableWizardStep) => void;
};

const EDITABLE_STEPS = new Set<string>([
  'search_type',
  'country',
  'industry',
  'subindustries',
  'additional_criteria',
  'requested_count',
]);

// Q3F-5BB.3F — Once the conversation reaches the review/final phase, the inline
// per-message "Editar" links clutter the transcript. Editing is offered instead
// by the summary rows and the single "Editar búsqueda" action in the final
// panel, so we suppress the inline links across all review-phase steps.
const REVIEW_PHASE_STEPS = new Set<string>([
  'summary',
  'validating',
  'validated',
  'submitting',
  'success',
  'blocked',
  'error',
]);

// ── Component ─────────────────────────────────────────────────────────────────

export function WizardMessageList({
  messages,
  visibleCount,
  isTyping = false,
  currentStep,
  onEditStep,
}: WizardMessageListProps) {
  const effectiveVisible = visibleCount ?? messages.length;
  const visibleMessages = messages.slice(0, effectiveVisible);

  return (
    <div
      role="log"
      aria-label="Historial de la conversación"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
      className="space-y-2"
    >
      {visibleMessages.map((msg) => {
        if (msg.role === 'assistant') {
          return <AssistantMessage key={msg.id} message={msg} />;
        }
        if (msg.role === 'user') {
          const canEdit =
            EDITABLE_STEPS.has(msg.step) &&
            msg.step !== currentStep &&
            !REVIEW_PHASE_STEPS.has(currentStep);
          return (
            <UserMessage
              key={msg.id}
              message={msg}
              canEdit={canEdit}
              onEdit={() => onEditStep(msg.step as EditableWizardStep)}
            />
          );
        }
        if (msg.messageType === 'warning') {
          return <WarningMessage key={msg.id} message={msg} />;
        }
        return <ErrorMessage key={msg.id} message={msg} />;
      })}

      {/* Typing indicator */}
      {isTyping && effectiveVisible < messages.length && (
        <div className="flex items-start gap-2.5 animate-su-fade-in">
          <AIOrb size="sm" className="mt-0.5" />
          <div className="flex items-center gap-1.5 rounded-xl rounded-tl-sm bg-muted/40 px-4 py-3">
            <Loader2 className="h-3 w-3 animate-spin text-su-brand" />
            <span className="text-sm text-muted-foreground/70 animate-pulse">
              escribiendo
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Message bubbles ───────────────────────────────────────────────────────────

function AssistantMessage({ message }: { message: DerivedWizardMessage }) {
  return (
    <div className="flex items-start gap-2.5">
      <AIOrb size="sm" className="mt-0.5" />
      <div className="max-w-[85%] rounded-xl rounded-tl-sm bg-muted/60 px-4 py-2.5 text-sm text-foreground">
        {message.content}
      </div>
    </div>
  );
}

type UserMessageProps = {
  message: DerivedWizardMessage;
  canEdit: boolean;
  onEdit: () => void;
};

function UserMessage({ message, canEdit, onEdit }: UserMessageProps) {
  return (
    <div className="flex items-end justify-end gap-2">
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar respuesta: ${message.content}`}
          className="mb-0.5 flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Pencil className="h-3 w-3" aria-hidden />
          Editar
        </button>
      )}
      <div className="max-w-[80%] rounded-xl rounded-tr-sm bg-su-brand/10 px-4 py-2.5 text-sm text-foreground">
        {message.content}
      </div>
    </div>
  );
}

function WarningMessage({ message }: { message: DerivedWizardMessage }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-400"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{message.content}</span>
    </div>
  );
}

function ErrorMessage({ message }: { message: DerivedWizardMessage }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
    >
      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{message.content}</span>
    </div>
  );
}
