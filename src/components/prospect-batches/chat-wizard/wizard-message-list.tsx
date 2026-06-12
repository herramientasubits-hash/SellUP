'use client';

import * as React from 'react';
import { Bot, AlertTriangle, XCircle, Pencil } from 'lucide-react';
import type {
  DerivedWizardMessage,
  EditableWizardStep,
} from '@/modules/prospect-batches/chat-wizard';

// ── Types ─────────────────────────────────────────────────────────────────────

type WizardMessageListProps = {
  messages: DerivedWizardMessage[];
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

// ── Component ─────────────────────────────────────────────────────────────────

export function WizardMessageList({
  messages,
  currentStep,
  onEditStep,
}: WizardMessageListProps) {
  return (
    <div
      role="log"
      aria-label="Historial de la conversación"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
      className="space-y-3"
    >
      {messages.map((msg) => {
        if (msg.role === 'assistant') {
          return <AssistantMessage key={msg.id} message={msg} />;
        }
        if (msg.role === 'user') {
          const canEdit =
            EDITABLE_STEPS.has(msg.step) && msg.step !== currentStep;
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
    </div>
  );
}

// ── Message bubbles ───────────────────────────────────────────────────────────

function AssistantMessage({ message }: { message: DerivedWizardMessage }) {
  return (
    <div className="flex items-start gap-2.5">
      <div
        aria-hidden
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-su-brand-soft"
      >
        <Bot className="h-3.5 w-3.5 text-su-brand" />
      </div>
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
