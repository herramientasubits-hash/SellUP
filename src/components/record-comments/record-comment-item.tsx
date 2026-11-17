'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, MessageSquare } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatInAppZone } from '@/lib/format-date';
import { isOpenAlert } from '@/modules/record-comments/record-comments-core';
import {
  RECORD_COMMENT_FIELD_LABELS,
  RECORD_COMMENT_RESOLUTION_MAX,
  type RecordCommentInboxItem,
} from '@/modules/record-comments/types';

export function formatCommentDate(iso: string): string {
  return formatInAppZone(
    iso,
    { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    'es-CO',
  );
}

interface RecordCommentItemProps {
  comment: RecordCommentInboxItem;
  /** Muestra a qué contacto va (en la ficha de empresa y en la bandeja). */
  showContact?: boolean;
  /** Muestra la empresa (en la bandeja). */
  showAccount?: boolean;
  /** Algo clicable para abrir la ficha (en la bandeja). */
  recordLink?: React.ReactNode;
  onResolve?: (commentId: string, note: string | null) => Promise<boolean>;
}

/** Un comentario o una alerta: qué dato, quién, cuándo y, si aplica, su resolución. */
export function RecordCommentItem({
  comment,
  showContact = false,
  showAccount = false,
  recordLink,
  onResolve,
}: RecordCommentItemProps) {
  const open = isOpenAlert(comment);
  const [resolving, setResolving] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [pending, setPending] = React.useState(false);

  async function confirmResolve() {
    if (!onResolve) return;
    setPending(true);
    const ok = await onResolve(comment.id, note.trim() || null);
    setPending(false);
    if (ok) {
      setResolving(false);
      setNote('');
    }
  }

  const Icon = comment.kind === 'alert' ? (open ? AlertTriangle : CheckCircle2) : MessageSquare;
  const iconTone =
    comment.kind === 'alert' ? (open ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success') : 'bg-primary/10 text-primary';

  return (
    <li className="flex gap-3 rounded-xl border border-border/60 bg-card p-3">
      <span aria-hidden className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {comment.kind === 'alert' ? (
            <Badge variant={open ? 'warning' : 'success'}>{open ? 'Alerta abierta' : 'Alerta resuelta'}</Badge>
          ) : (
            <Badge variant="neutral">Nota</Badge>
          )}
          <Badge variant="outline">
            {RECORD_COMMENT_FIELD_LABELS[comment.fieldKey]}
            {comment.fieldValue ? `: ${comment.fieldValue}` : ''}
          </Badge>
          {showAccount && <span className="text-xs font-medium text-foreground">{comment.accountName}</span>}
          {showContact && comment.contactName && (
            <span className="text-xs text-muted-foreground">
              {showAccount ? '· ' : 'Contacto: '}
              {comment.contactName}
            </span>
          )}
        </div>

        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{comment.body}</p>

        <p className="text-xs text-muted-foreground">
          {comment.author?.name ?? 'Alguien'} · {formatCommentDate(comment.createdAt)}
        </p>

        {comment.resolvedAt && (
          <p className="rounded-md bg-success/10 px-2 py-1.5 text-xs text-foreground">
            Resuelta por {comment.resolvedBy?.name ?? 'alguien'} · {formatCommentDate(comment.resolvedAt)}
            {comment.resolutionNote ? ` — ${comment.resolutionNote}` : ''}
          </p>
        )}

        {(open && onResolve) || recordLink ? (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {recordLink}
            {open && onResolve && !resolving && (
              <Button type="button" size="xs" variant="outline" onClick={() => setResolving(true)}>
                <CheckCircle2 aria-hidden="true" />
                Ya lo vi / Resuelto
              </Button>
            )}
          </div>
        ) : null}

        {resolving && (
          <div className="space-y-2 pt-1">
            <Textarea
              aria-label="Qué se hizo (opcional)"
              placeholder="Qué se hizo (opcional), por ejemplo: actualicé el teléfono"
              value={note}
              maxLength={RECORD_COMMENT_RESOLUTION_MAX}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setResolving(false)}>
                Cancelar
              </Button>
              <Button type="button" size="sm" disabled={pending} onClick={confirmResolve}>
                Marcar como resuelta
              </Button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
