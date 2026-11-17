'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, CheckCircle2, MessageSquare, Inbox } from '@/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterChips } from '@/components/filters/filter-chips';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RecordCommentItem } from '@/components/record-comments/record-comment-item';
import { AccountDetailSheet } from '@/components/accounts/account-detail-sheet';
import { ContactDetailSheet } from '@/components/contacts/contact-detail-sheet';
import { getRecordCommentsInbox, resolveRecordComment } from '@/modules/record-comments/actions';
import {
  RECORD_COMMENT_FIELD_KEYS,
  RECORD_COMMENT_FIELD_LABELS,
  type InboxPeopleFilter,
  type InboxStatusFilter,
  type RecordCommentFieldKey,
  type RecordCommentInboxItem,
  type RecordCommentsInboxFilters,
} from '@/modules/record-comments/types';

interface CommentsInboxViewProps {
  initialItems: RecordCommentInboxItem[];
  initialOpenAlerts: number;
  initialTruncated: boolean;
  initialFilters: RecordCommentsInboxFilters;
}

const PEOPLE_LABELS: Record<InboxPeopleFilter, string> = {
  everyone: 'Todo lo que puedo ver',
  my_accounts: 'Empresas a mi cargo',
  authored: 'Escritos por mí',
};

const STATUS_HINT: Record<InboxStatusFilter, string> = {
  open: 'Lo que alguien reportó y nadie ha marcado como resuelto',
  resolved: 'Alertas que ya alguien revisó',
  notes: 'Notas que quedaron como constancia',
  all: 'Todo lo comentado, lo más reciente primero',
};

type OpenRecord = { kind: 'account' | 'contact'; id: string } | null;

/** La bandeja de «Comentarios y alertas»: todo en un solo sitio, con filtros. */
export function CommentsInboxView({
  initialItems,
  initialOpenAlerts,
  initialTruncated,
  initialFilters,
}: CommentsInboxViewProps) {
  const [filters, setFilters] = React.useState(initialFilters);
  const [items, setItems] = React.useState(initialItems);
  const [openAlerts, setOpenAlerts] = React.useState(initialOpenAlerts);
  const [truncated, setTruncated] = React.useState(initialTruncated);
  const [loading, setLoading] = React.useState(false);
  const [record, setRecord] = React.useState<OpenRecord>(null);
  const requestRef = React.useRef(0);

  const load = React.useCallback(async (next: RecordCommentsInboxFilters) => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const result = await getRecordCommentsInbox(next);
      if (request !== requestRef.current) return;
      if (!result.available) {
        setItems([]);
        return;
      }
      setItems(result.items);
      setOpenAlerts(result.openAlerts);
      setTruncated(result.truncated);
    } catch {
      if (request === requestRef.current) toast.error('No se pudieron cargar los comentarios. Inténtalo de nuevo.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  function update(patch: Partial<RecordCommentsInboxFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next);
  }

  async function resolve(commentId: string, note: string | null): Promise<boolean> {
    try {
      const result = await resolveRecordComment(commentId, note);
      if (!result.success) {
        toast.error(result.error);
        return false;
      }
      toast.success('Alerta resuelta');
      // En «Abiertas» la alerta resuelta sale de la lista; en el resto se actualiza.
      setItems((prev) =>
        filters.status === 'open'
          ? prev.filter((c) => c.id !== commentId)
          : prev.map((c) => (c.id === commentId ? result.comment : c)),
      );
      setOpenAlerts((n) => Math.max(0, n - 1));
      return true;
    } catch {
      toast.error('No se pudo marcar como resuelta. Inténtalo de nuevo.');
      return false;
    }
  }

  function closeRecord() {
    setRecord(null);
    // Lo que se resolvió o comentó dentro de la ficha se ve al volver.
    void load(filters);
  }

  return (
    <div className="space-y-5">
      <FilterChips
        ariaLabel="Filtrar por estado"
        title="Estado"
        hint={STATUS_HINT[filters.status]}
        value={filters.status}
        onChange={(v) => update({ status: v as InboxStatusFilter })}
        wrap
        options={[
          { value: 'open', label: 'Alertas abiertas', count: openAlerts, icon: AlertTriangle },
          { value: 'resolved', label: 'Resueltas', icon: CheckCircle2 },
          { value: 'notes', label: 'Notas', icon: MessageSquare },
          { value: 'all', label: 'Todo', icon: Inbox },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-60">
          <Select value={filters.people} onValueChange={(v) => update({ people: (v as InboxPeopleFilter) ?? 'everyone' })}>
            <SelectTrigger className="w-full" aria-label="De quién">
              <SelectValue>{PEOPLE_LABELS[filters.people]}</SelectValue>
            </SelectTrigger>
            <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
              {(Object.keys(PEOPLE_LABELS) as InboxPeopleFilter[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {PEOPLE_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:w-60">
          <Select
            value={filters.fieldKey}
            onValueChange={(v) => update({ fieldKey: (v as RecordCommentFieldKey | 'any') ?? 'any' })}
          >
            <SelectTrigger className="w-full" aria-label="Dato">
              <SelectValue>
                {filters.fieldKey === 'any' ? 'Cualquier dato' : RECORD_COMMENT_FIELD_LABELS[filters.fieldKey]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
              <SelectItem value="any">Cualquier dato</SelectItem>
              {RECORD_COMMENT_FIELD_KEYS.map((key) => (
                <SelectItem key={key} value={key}>
                  {RECORD_COMMENT_FIELD_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <section aria-label="Comentarios" aria-busy={loading} className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {items.length === 0 ? (
          <EmptyState
            icon={filters.status === 'open' ? CheckCircle2 : MessageSquare}
            title={filters.status === 'open' ? 'No hay alertas abiertas' : 'Nada por aquí'}
            description={
              filters.status === 'open'
                ? 'Cuando alguien reporte algo en una empresa o un contacto (por ejemplo, un número que no existe), aparecerá aquí.'
                : 'No hay comentarios con estos filtros.'
            }
          />
        ) : (
          <ul className="space-y-2">
            {items.map((comment) => (
              <RecordCommentItem
                key={comment.id}
                comment={comment}
                showAccount
                showContact
                onResolve={resolve}
                recordLink={
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setRecord(
                        comment.contactId
                          ? { kind: 'contact', id: comment.contactId }
                          : { kind: 'account', id: comment.accountId },
                      )
                    }
                  >
                    {comment.contactId ? 'Abrir contacto' : 'Abrir empresa'}
                    <ArrowRight aria-hidden="true" />
                  </Button>
                }
              />
            ))}
          </ul>
        )}
        {truncated && (
          <p className="mt-3 text-xs text-muted-foreground">
            Se muestran los 300 más recientes. Usa los filtros para acotar.
          </p>
        )}
      </section>

      <AccountDetailSheet
        accountId={record?.kind === 'account' ? record.id : null}
        open={record?.kind === 'account'}
        onClose={closeRecord}
      />
      <ContactDetailSheet
        contactId={record?.kind === 'contact' ? record.id : null}
        open={record?.kind === 'contact'}
        onClose={closeRecord}
      />
    </div>
  );
}
