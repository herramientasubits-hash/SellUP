'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  createRecordComment,
  getRecordComments,
  resolveRecordComment,
} from '@/modules/record-comments/actions';
import type {
  CreateRecordCommentInput,
  RecordCommentInboxItem,
  RecordCommentTarget,
} from '@/modules/record-comments/types';

export interface RecordCommentsState {
  /** `false` mientras la migración 168 no esté aplicada: la ficha esconde todo. */
  available: boolean;
  loading: boolean;
  comments: readonly RecordCommentInboxItem[];
  reload: () => Promise<void>;
  /** Crea y devuelve si se guardó. Avisa con un toast. */
  add: (input: Omit<CreateRecordCommentInput, 'target' | 'targetId'>) => Promise<boolean>;
  resolve: (commentId: string, note: string | null) => Promise<boolean>;
}

/**
 * Comentarios de una ficha (empresa o contacto). Complementario: si la lectura
 * falla, la ficha sigue; la sección simplemente no aparece.
 */
export function useRecordComments(
  target: RecordCommentTarget,
  targetId: string | null,
): RecordCommentsState {
  const [available, setAvailable] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [comments, setComments] = React.useState<readonly RecordCommentInboxItem[]>([]);

  const reload = React.useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    try {
      const result = await getRecordComments(target, targetId);
      setAvailable(result.available);
      setComments(result.available ? result.comments : []);
    } catch {
      setAvailable(false);
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [target, targetId]);

  React.useEffect(() => {
    if (!targetId) {
      queueMicrotask(() => {
        setComments([]);
        setAvailable(false);
      });
      return;
    }
    // Fuera del cuerpo del efecto (la carga marca `loading` al empezar).
    queueMicrotask(() => {
      void reload();
    });
  }, [targetId, reload]);

  const add = React.useCallback(
    async (input: Omit<CreateRecordCommentInput, 'target' | 'targetId'>) => {
      if (!targetId) return false;
      try {
        const result = await createRecordComment({ ...input, target, targetId });
        if (!result.success) {
          toast.error(result.error);
          return false;
        }
        setComments((prev) => [result.comment, ...prev]);
        toast.success(result.comment.kind === 'alert' ? 'Alerta registrada' : 'Comentario guardado');
        return true;
      } catch {
        toast.error('No se pudo guardar el comentario. Inténtalo de nuevo.');
        return false;
      }
    },
    [target, targetId],
  );

  const resolve = React.useCallback(async (commentId: string, note: string | null) => {
    try {
      const result = await resolveRecordComment(commentId, note);
      if (!result.success) {
        toast.error(result.error);
        return false;
      }
      setComments((prev) => prev.map((c) => (c.id === commentId ? result.comment : c)));
      toast.success('Alerta resuelta');
      return true;
    } catch {
      toast.error('No se pudo marcar como resuelta. Inténtalo de nuevo.');
      return false;
    }
  }, []);

  return { available, loading, comments, reload, add, resolve };
}
