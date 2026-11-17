'use client';

import * as React from 'react';
import { AlertTriangle, MessageSquare, X } from '@/icons';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { DrawerSection } from '@/components/shared/drawer-section';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sortThread } from '@/modules/record-comments/record-comments-core';
import {
  RECORD_COMMENT_BODY_MAX,
  RECORD_COMMENT_FIELD_LABELS,
  RECORD_COMMENT_FIELDS_BY_TARGET,
  type RecordCommentFieldKey,
  type RecordCommentKind,
  type RecordCommentTarget,
} from '@/modules/record-comments/types';
import { RecordCommentItem } from './record-comment-item';
import type { RecordCommentsState } from './use-record-comments';

/** Lo que una marca junto a un dato pide al abrir el panel: ese dato ya elegido. */
export interface CommentComposerPreset {
  fieldKey: RecordCommentFieldKey;
  fieldValue?: string | null;
  /** Cambia en cada clic para volver a aplicar el mismo dato. */
  nonce: number;
}

interface RecordCommentsPanelProps {
  target: RecordCommentTarget;
  state: RecordCommentsState;
  preset?: CommentComposerPreset | null;
}

const KIND_HINT: Record<RecordCommentKind, string> = {
  note: 'Queda en la ficha para quien la abra.',
  alert: 'Queda abierta en «Comentarios y alertas» hasta que alguien la marque como resuelta.',
};

/**
 * Pestaña «Comentarios» de una ficha. En una empresa se ven también los
 * comentarios de sus contactos: todo junto en un solo hilo.
 */
export function RecordCommentsPanel({ target, state, preset }: RecordCommentsPanelProps) {
  const fieldOptions = RECORD_COMMENT_FIELDS_BY_TARGET[target];
  const [fieldKey, setFieldKey] = React.useState<RecordCommentFieldKey>('general');
  const [fieldValue, setFieldValue] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<RecordCommentKind>('note');
  const [body, setBody] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Una marca junto a un dato abre el panel con ese dato ya elegido (ajuste durante el render).
  const [appliedNonce, setAppliedNonce] = React.useState<number | null>(null);
  if (preset && preset.nonce !== appliedNonce) {
    setAppliedNonce(preset.nonce);
    setFieldKey(preset.fieldKey);
    setFieldValue(preset.fieldValue ?? null);
  }
  React.useEffect(() => {
    if (preset) textareaRef.current?.focus();
  }, [preset]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    const ok = await state.add({ fieldKey, fieldValue, kind, body });
    setSaving(false);
    if (ok) {
      setBody('');
      setFieldValue(null);
    }
  }

  const thread = sortThread(state.comments);
  const openCount = thread.filter((c) => c.kind === 'alert' && !c.resolvedAt).length;

  return (
    <div className="space-y-4">
      <DrawerSection title="Nuevo comentario" icon={MessageSquare}>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="sm:w-56">
              <Select
                value={fieldKey}
                onValueChange={(v) => {
                  setFieldKey((v as RecordCommentFieldKey) ?? 'general');
                  setFieldValue(null);
                }}
              >
                <SelectTrigger className="w-full" aria-label="Dato al que se refiere">
                  <SelectValue>{`Sobre: ${RECORD_COMMENT_FIELD_LABELS[fieldKey]}`}</SelectValue>
                </SelectTrigger>
                <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
                  {fieldOptions.map((key) => (
                    <SelectItem key={key} value={key}>
                      {RECORD_COMMENT_FIELD_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div role="group" aria-label="Tipo de comentario" className="inline-flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={kind === 'note' ? 'secondary' : 'ghost'}
                aria-pressed={kind === 'note'}
                onClick={() => setKind('note')}
              >
                <MessageSquare aria-hidden="true" />
                Nota
              </Button>
              <Button
                type="button"
                size="sm"
                variant={kind === 'alert' ? 'secondary' : 'ghost'}
                aria-pressed={kind === 'alert'}
                onClick={() => setKind('alert')}
              >
                <AlertTriangle aria-hidden="true" />
                Alerta
              </Button>
            </div>
          </div>

          {fieldValue && (
            <p className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-1 text-xs text-foreground">
              Dato: <span className="tabular-nums">{fieldValue}</span>
              <button
                type="button"
                className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                aria-label="Quitar el dato"
                onClick={() => setFieldValue(null)}
              >
                <X className="size-3" />
              </button>
            </p>
          )}

          <Textarea
            ref={textareaRef}
            aria-label="Comentario"
            placeholder={
              kind === 'alert'
                ? 'Qué pasa y qué hay que revisar. Ej.: llamé y el número no existe.'
                : 'Lo que quieras dejar registrado sobre esta ficha.'
            }
            value={body}
            maxLength={RECORD_COMMENT_BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
            <Button type="submit" size="sm" disabled={saving || !body.trim()}>
              {kind === 'alert' ? 'Registrar alerta' : 'Guardar nota'}
            </Button>
          </div>
        </form>
      </DrawerSection>

      <DrawerSection
        title="Comentarios"
        icon={MessageSquare}
        action={
          openCount > 0 ? (
            <span className="text-xs tabular-nums text-warning">
              {openCount} {openCount === 1 ? 'alerta abierta' : 'alertas abiertas'}
            </span>
          ) : undefined
        }
      >
        {thread.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={MessageSquare}
            title="Sin comentarios todavía"
            description="Deja una nota o una alerta sobre un dato de esta ficha para que el equipo la vea."
          />
        ) : (
          <ul className="space-y-2">
            {thread.map((comment) => (
              <RecordCommentItem
                key={comment.id}
                comment={comment}
                showContact={target === 'account'}
                onResolve={state.resolve}
              />
            ))}
          </ul>
        )}
      </DrawerSection>
    </div>
  );
}
