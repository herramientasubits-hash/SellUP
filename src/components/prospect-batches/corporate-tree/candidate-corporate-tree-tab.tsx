'use client';

import * as React from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DrawerSection } from '@/components/shared/drawer-section';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
import { ExternalLink } from '@/icons';
import {
  describeCorporateTreeItemStatus,
  type CorporateTreeAssociationsResponse,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-associations';
import { CORPORATE_TREE_RELATION_LABELS } from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; data: CorporateTreeAssociationsResponse };

/**
 * Agente 1 · Búsqueda en árbol — pestaña «Asociaciones» de la ficha
 * (AGENT1-CORPORATE-TREE-1): con qué empresas está relacionada y en qué quedó
 * cada una. Se carga al abrir la pestaña.
 */
export function CandidateCorporateTreeTab({ candidateId }: { candidateId: string }) {
  const [state, setState] = React.useState<LoadState>({ kind: 'loading' });

  React.useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    fetch(`/api/prospect-batches/corporate-tree-runs/associations?candidateId=${encodeURIComponent(candidateId)}`, { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<CorporateTreeAssociationsResponse>) : Promise.reject(new Error(String(response.status)))))
      .then((data) => alive && setState({ kind: 'ready', data }))
      .catch(() => alive && setState({ kind: 'error' }));
    return () => {
      alive = false;
    };
  }, [candidateId]);

  if (state.kind === 'loading') {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <Alert variant="destructive">
        <AlertDescription className="text-xs">No pudimos cargar las asociaciones. Cierra y vuelve a abrir la ficha.</AlertDescription>
      </Alert>
    );
  }
  if (!state.data.available) {
    return (
      <Alert variant="info">
        <AlertDescription className="text-xs">Las asociaciones todavía no están activadas en este entorno.</AlertDescription>
      </Alert>
    );
  }
  if (state.data.trees.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta empresa todavía no tiene empresas asociadas. Para buscarlas, usa «Buscar en árbol» en el menú de su fila.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {state.data.trees.map((tree) => (
        <div key={tree.batchId} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-semibold text-foreground">Árbol de {tree.rootName}</p>
            <Link href={`/prospect-batches/${tree.batchId}`} className="text-xs font-medium text-primary hover:underline">
              Ver el lote
            </Link>
          </div>
          {tree.selfRelation && tree.selfRelation !== 'root' && (
            <p className="text-xs text-muted-foreground">
              Esta empresa está en la rama «{CORPORATE_TREE_RELATION_LABELS[tree.selfRelation]}».
            </p>
          )}
          {tree.groups.map((group) => (
            <DrawerSection key={group.relation} title={`${group.label} (${group.items.length})`}>
              <ul className="flex flex-col divide-y divide-border/60">
                {group.items.map((item) => (
                  <li key={`${item.name}-${item.countryCode ?? ''}`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {item.countryCode ? `${getFlagEmoji(item.countryCode)} ` : ''}
                        {item.name}
                        {item.isSelf && <span className="font-normal text-muted-foreground"> · esta empresa</span>}
                      </p>
                      {item.relationDetail && <p className="text-xs text-muted-foreground">{item.relationDetail}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={item.hubspotCompanyId ? 'info' : item.status === 'needs_review' ? 'brand' : 'neutral'}>
                        {describeCorporateTreeItemStatus(item)}
                      </Badge>
                      {item.evidenceUrl && (
                        <a
                          href={item.evidenceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Fuente de la relación con ${item.name}`}
                          className="inline-flex items-center rounded-md p-1 text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          ))}
        </div>
      ))}
    </div>
  );
}
