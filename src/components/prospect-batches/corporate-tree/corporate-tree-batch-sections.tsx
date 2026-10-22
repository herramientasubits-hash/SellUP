import Link from 'next/link';
import { SurfaceCard } from '@/components/shared/surface-card';
import { GitBranch } from '@/icons';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import {
  buildCorporateTreeHierarchy,
  groupBatchCandidatesByTreeRelation,
  readCorporateTreeBatchSummary,
  type CorporateTreeBatchCandidateInput,
  type CorporateTreeBatchRelationship,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-batch-groups';
import {
  corporateTreeGroupOpportunity,
  corporateTreeGroupSentence,
  readCorporateTreeGroupSignal,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-group-signal';
import { CORPORATE_TREE_METADATA_KEY } from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
import type { CorporateTreeParentTree } from '@/modules/prospect-batches/corporate-tree/corporate-tree-relationships.server';
import { CorporateTreeHierarchyList } from './corporate-tree-hierarchy-list';

/**
 * Agente 1 · Búsqueda en árbol — el lote agrupado por rama (AGENT1-CORPORATE-TREE-1).
 *
 * Va sobre la tabla de siempre, que sigue mostrando todas las filas con sus
 * acciones: esto sólo cuenta a qué rama pertenece cada empresa y en qué quedó
 * (por revisar, ya en HubSpot, descartada…). No renderiza nada en lotes que no
 * vienen del árbol.
 */
export function CorporateTreeBatchSections({
  batchMetadata,
  candidates,
  relationships = [],
  parentTree = null,
}: {
  batchMetadata: unknown;
  candidates: readonly CorporateTreeBatchCandidateInput[];
  relationships?: readonly CorporateTreeBatchRelationship[];
  /** FASE C — el árbol de arriba, si este lote se buscó desde una de sus empresas. */
  parentTree?: CorporateTreeParentTree | null;
}) {
  const summary = readCorporateTreeBatchSummary(batchMetadata);
  if (!summary) return null;
  const groups = groupBatchCandidatesByTreeRelation(candidates, relationships);
  const treeMetadata =
    batchMetadata && typeof batchMetadata === 'object'
      ? (batchMetadata as Record<string, unknown>)[CORPORATE_TREE_METADATA_KEY]
      : null;
  const groupSignal = readCorporateTreeGroupSignal(
    treeMetadata && typeof treeMetadata === 'object' ? (treeMetadata as Record<string, unknown>).group_hubspot : null,
  );
  const groupOpportunity = corporateTreeGroupOpportunity(groupSignal);
  const countryNames = LATAM_COUNTRIES.filter((c) => summary.countryCodes.includes(c.code)).map((c) => c.name);

  return (
    <SurfaceCard>
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2">
          <GitBranch className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">Árbol de {summary.rootName}</p>
          <p className="text-xs text-muted-foreground">
            {countryNames.length === LATAM_COUNTRIES.length
              ? 'Buscado en todos los países.'
              : countryNames.length > 0
                ? `Buscado en ${countryNames.join(', ')}.`
                : null}{' '}
            Las que ya estaban en HubSpot o en SellUp quedan aquí como referencia: no entran a revisión. Las que
            no tienen web esperan en «Descartadas» mientras el rescate se la busca; las que sólo usan la web del grupo
            quedan como referencia.
          </p>
        </div>
      </div>

      {parentTree && (
        <p className="mb-3 text-sm text-muted-foreground">
          Rama de{' '}
          <Link href={`/prospect-batches/${parentTree.batchId}`} className="font-medium text-primary hover:underline">
            Árbol de {parentTree.rootName}
          </Link>{' '}
          (desde {parentTree.branchName}).
        </p>
      )}

      {groupOpportunity && (
        <p
          className={`mb-3 rounded-xl px-3 py-2 text-sm text-foreground ${
            groupOpportunity === 'customer_group' ? 'bg-success/10' : 'bg-warning/15'
          }`}
        >
          {corporateTreeGroupSentence(groupSignal)}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguna empresa de este lote quedó marcada con su rama.</p>
      ) : (
        <CorporateTreeHierarchyList nodes={buildCorporateTreeHierarchy(groups)} />
      )}
    </SurfaceCard>
  );
}
