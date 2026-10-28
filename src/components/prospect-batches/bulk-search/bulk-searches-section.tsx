'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from '@/icons';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/typography';
import type { AssignableUser } from '@/components/assignment/assign-owner-drawer';
import {
  BULK_SEARCH_STARTED_EVENT,
  controlBulkSearchViaRoute,
} from '@/modules/prospect-batches/bulk-search/bulk-search-client';
import { bulkDisplayState } from '@/modules/prospect-batches/bulk-search/bulk-search-display';
import type { BulkSearchView } from '@/modules/prospect-batches/bulk-search/bulk-search-view';
import { BulkSearchAssignDrawer } from './bulk-search-assign-drawer';
import { BulkSearchRow, useNow } from './bulk-search-rows';

/**
 * Las búsquedas masivas en Prospección masiva (GROWTH-BULK-SEARCH-1 · PR 4):
 * su avance, pausar · continuar · cancelar, y «Asignar a…» para repartir lo que
 * encontraron. Las rondas las conduce el Centro de procesos; aquí, al continuar,
 * sólo se le avisa.
 */
export function BulkSearchesSection({
  searches,
  users,
  reviewHref,
}: {
  searches: BulkSearchView[];
  users: AssignableUser[];
  reviewHref: string;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState(searches);
  const [assignFor, setAssignFor] = React.useState<BulkSearchView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const now = useNow();
  // Cuando el servidor trae una lista nueva (router.refresh), manda la nueva.
  const [source, setSource] = React.useState(searches);
  if (source !== searches) {
    setSource(searches);
    setItems(searches);
  }

  const control = async (id: string, action: 'pause' | 'resume' | 'cancel') => {
    setError(null);
    const response = await controlBulkSearchViaRoute(id, action);
    if (!response.ok) {
      setError('message' in response ? response.message : 'No se pudo cambiar la búsqueda.');
      return;
    }
    setItems((current) => current.map((item) => (item.id === id ? response.search : item)));
    // El Centro de procesos es quien conduce: al continuar, que la retome ya.
    if (action === 'resume') window.dispatchEvent(new CustomEvent(BULK_SEARCH_STARTED_EVENT, { detail: { id } }));
  };

  if (items.length === 0) return null;
  return (
    <section aria-labelledby="growth-bulk-searches" className="mb-6 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="growth-bulk-searches" className="text-sm font-semibold text-foreground">
          Búsquedas masivas
        </h2>
        <Text size="xs" tone="muted">
          Avanzan por rondas mientras SellUp esté abierto
        </Text>
      </div>
      <ul className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
        {items.map((search) => (
          <BulkSearchRow
            key={search.id}
            search={search}
            state={bulkDisplayState(search, now)}
            onControl={(action) => void control(search.id, action)}
            viewHref={reviewHref}
            extraAction={
              search.deliveredCount > 0 ? (
                <Button size="xs" variant="outline" onClick={() => setAssignFor(search)}>
                  <UserPlus aria-hidden />
                  Asignar a…
                </Button>
              ) : null
            }
          />
        ))}
      </ul>
      {error && (
        <Text size="xs" tone="negative" role="status">
          {error}
        </Text>
      )}
      {assignFor && (
        <BulkSearchAssignDrawer
          open={assignFor !== null}
          onOpenChange={(open) => !open && setAssignFor(null)}
          bulkSearchId={assignFor.id}
          label={assignFor.label}
          users={users}
          onAssigned={() => router.refresh()}
        />
      )}
    </section>
  );
}
