// Shared organization-group hierarchy logic.
//
// Single source of truth for how `organization_groups` is ordered and nested
// across the app: the "Usuarios y grupos" screen (groups-view) and the
// /ai-usage "Grupo" filter both consume this so the tree always looks the same.
//
// The hierarchy is a forest built from `parent_group_id`. Roots and children are
// sorted by name (locale-aware) at every level, then flattened in pre-order so a
// parent is always immediately followed by its own subtree:
//
//   Colombia (QA)
//     Manufactura (QA)
//       Textiles (QA)
//     Tecnología (QA)
//   México (QA)
//     Enterprise (QA)
//
// `depth` is derived from the tree level (root = 0), not from any stored column,
// so indentation always matches the real nesting.

/** Minimal shape needed to build the hierarchy. */
export interface OrgGroupLike {
  id: string;
  name: string;
  parent_group_id: string | null;
}

export interface OrgGroupNode<G extends OrgGroupLike> {
  group: G;
  children: OrgGroupNode<G>[];
  /** 0 = root, 1 = child, 2 = grandchild … (computed from tree level). */
  depth: number;
}

function sortByName<G extends OrgGroupLike>(nodes: OrgGroupNode<G>[]): void {
  nodes.sort((a, b) => a.group.name.localeCompare(b.group.name));
  for (const node of nodes) sortByName(node.children);
}

/**
 * Build the group forest from a flat list. A group is a root when it has no
 * parent or its parent is missing from the list. Roots and children are sorted
 * by name at every level. Cycles are guarded against via a visited set.
 */
export function buildOrgGroupForest<G extends OrgGroupLike>(
  groups: G[],
): OrgGroupNode<G>[] {
  const nodeMap = new Map<string, OrgGroupNode<G>>(
    groups.map((g) => [g.id, { group: g, children: [], depth: 0 }]),
  );

  const roots: OrgGroupNode<G>[] = [];
  for (const node of nodeMap.values()) {
    const parentId = node.group.parent_group_id;
    const parent = parentId ? nodeMap.get(parentId) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Stamp depth from the tree level so indentation reflects real nesting.
  const stampDepth = (node: OrgGroupNode<G>, depth: number): void => {
    node.depth = depth;
    for (const child of node.children) stampDepth(child, depth + 1);
  };
  for (const root of roots) stampDepth(root, 0);

  sortByName(roots);
  return roots;
}

/**
 * Pre-order flatten of the group forest: each group followed by its descendants,
 * with the tree-derived depth. Drives ordered, indented dropdowns/lists.
 */
export function flattenOrgGroups<G extends OrgGroupLike>(
  groups: G[],
): Array<{ group: G; depth: number }> {
  const out: Array<{ group: G; depth: number }> = [];
  const walk = (node: OrgGroupNode<G>): void => {
    out.push({ group: node.group, depth: node.depth });
    for (const child of node.children) walk(child);
  };
  for (const root of buildOrgGroupForest(groups)) walk(root);
  return out;
}
