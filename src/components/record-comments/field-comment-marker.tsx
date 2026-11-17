'use client';

import * as React from 'react';
import { AlertTriangle, MessageSquare, MoreHorizontal } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { openPhoneReport, summarizeField } from '@/modules/record-comments/record-comments-core';
import {
  RECORD_COMMENT_REASONS,
  RECORD_COMMENT_REASON_LABELS,
  RECORD_COMMENT_REASON_SHORT,
  type RecordComment,
  type RecordCommentFieldKey,
  type RecordCommentReason,
} from '@/modules/record-comments/types';
import { formatCommentDate } from './record-comment-item';

interface FieldCommentMarkerProps {
  comments: readonly RecordComment[];
  fieldKey: RecordCommentFieldKey;
  fieldValue?: string | null;
  /** Abre la pestaña «Comentarios» con este dato ya elegido. */
  onOpen: (fieldKey: RecordCommentFieldKey, fieldValue?: string | null) => void;
}

/**
 * La marca junto a un dato: cuántos comentarios tiene (en tono de alerta si
 * hay alguna abierta) y, al pasar el mouse, el último. Sin comentarios es un
 * botón discreto para comentar ese dato.
 */
export function FieldCommentMarker({ comments, fieldKey, fieldValue, onOpen }: FieldCommentMarkerProps) {
  const summary = summarizeField(comments, fieldKey, fieldValue);
  const hasAlerts = summary.openAlerts > 0;
  const Icon = hasAlerts ? AlertTriangle : MessageSquare;
  const label = summary.latest
    ? `${summary.latest.author?.name ?? 'Alguien'}, ${formatCommentDate(summary.latest.createdAt)}: ${summary.latest.body}`
    : 'Comentar este dato';

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={
              summary.total > 0
                ? `${summary.total} ${summary.total === 1 ? 'comentario' : 'comentarios'}${hasAlerts ? `, ${summary.openAlerts} alerta abierta` : ''}`
                : 'Comentar este dato'
            }
            className={
              hasAlerts
                ? 'text-warning hover:text-warning'
                : summary.total > 0
                  ? 'text-primary'
                  : 'text-text-muted opacity-70 hover:opacity-100'
            }
            onClick={() => onOpen(fieldKey, fieldValue)}
          >
            <Icon aria-hidden="true" />
            {summary.total > 0 && <span className="tabular-nums">{summary.total}</span>}
          </Button>
        }
      />
      <TooltipContent side="top" className="max-w-xs">
        <span className="line-clamp-3">{label}</span>
      </TooltipContent>
    </Tooltip>
  );
}

interface PhoneReportControlProps {
  comments: readonly RecordComment[];
  phone: string;
  onReport: (reason: RecordCommentReason, phone: string) => void;
  onOpen: (fieldKey: RecordCommentFieldKey, fieldValue?: string | null) => void;
  disabled?: boolean;
}

/**
 * Junto a un teléfono: la marca de lo reportado («No existe», «No contesta»…)
 * y el menú para reportarlo con un clic. Reportar crea una alerta sobre ese
 * número; no cambia el teléfono guardado.
 */
export function PhoneReportControl({ comments, phone, onReport, onOpen, disabled }: PhoneReportControlProps) {
  const report = openPhoneReport(comments, phone);

  return (
    <span className="inline-flex items-center gap-1">
      {report?.reason && (
        <Badge variant="warning" title={`Reportado por ${report.author?.name ?? 'alguien'} · ${formatCommentDate(report.createdAt)}`}>
          <AlertTriangle aria-hidden="true" />
          {RECORD_COMMENT_REASON_SHORT[report.reason]}
        </Badge>
      )}
      <FieldCommentMarker comments={comments} fieldKey="phone" fieldValue={phone} onOpen={onOpen} />
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={
            <Button type="button" size="icon-xs" variant="ghost" aria-label={`Reportar el número ${phone}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Reportar este número</DropdownMenuLabel>
            {RECORD_COMMENT_REASONS.map((reason) => (
              <DropdownMenuItem key={reason} onClick={() => onReport(reason, phone)}>
                {RECORD_COMMENT_REASON_LABELS[reason]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onOpen('phone', phone)}>Escribir un comentario…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
