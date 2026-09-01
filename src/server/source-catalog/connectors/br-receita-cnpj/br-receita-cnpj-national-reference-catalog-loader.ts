import { countBrReceitaCnpjDelimitedColumns } from './br-receita-cnpj-file-reader';
import type { BrazilReceitaFullJoinLookupSource } from './br-receita-cnpj-full-join-manifest-source-bridge';
import {
  readBrazilReceitaFullJoinFieldAt,
  readBrazilReceitaFullJoinFileSequentially,
  type BrazilReceitaFullJoinReaderFileSystem,
  type BrazilReceitaFullJoinReaderResourceGuard,
} from './br-receita-cnpj-full-join-streaming-reader';
import type { BrReceitaNationalReferenceCatalogs } from './br-receita-cnpj-national-match-projector';
import type { BrReceitaLookupRow } from './br-receita-cnpj-types';

const REQUIRED_LOOKUPS = ['cnaes', 'municipios', 'naturezas'] as const;
type RequiredLookup = (typeof REQUIRED_LOOKUPS)[number];

export type BrReceitaNationalReferenceCatalogLoaderRefusalReason =
  | 'catalog_caps_invalid'
  | 'catalog_source_missing_or_duplicated'
  | 'catalog_encoding_invalid'
  | 'catalog_size_unavailable'
  | 'catalog_size_exceeded'
  | 'catalog_reader_refused'
  | 'catalog_layout_mismatch'
  | 'catalog_row_cap_exceeded';

export class BrReceitaNationalReferenceCatalogLoaderError extends Error {
  readonly reason: BrReceitaNationalReferenceCatalogLoaderRefusalReason;

  constructor(reason: BrReceitaNationalReferenceCatalogLoaderRefusalReason) {
    super(`br receita national reference catalog loader refused (${reason})`);
    this.name = 'BrReceitaNationalReferenceCatalogLoaderError';
    this.reason = reason;
  }
}

export interface BrReceitaNationalReferenceCatalogCaps {
  readonly maxBytesPerCatalog: number;
  readonly maxRowsPerCatalog: number;
  readonly maxChunkBytes: number;
  readonly maxRowBytes: number;
}

function assertPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function resolveCaps(caps: BrReceitaNationalReferenceCatalogCaps): BrReceitaNationalReferenceCatalogCaps {
  if (
    !assertPositiveSafeInteger(caps?.maxBytesPerCatalog) ||
    !assertPositiveSafeInteger(caps?.maxRowsPerCatalog) ||
    !assertPositiveSafeInteger(caps?.maxChunkBytes) ||
    !assertPositiveSafeInteger(caps?.maxRowBytes) ||
    caps.maxChunkBytes > caps.maxBytesPerCatalog ||
    caps.maxRowBytes > caps.maxBytesPerCatalog
  ) {
    throw new BrReceitaNationalReferenceCatalogLoaderError('catalog_caps_invalid');
  }
  return Object.freeze({ ...caps });
}

function unquote(value: string | null): string {
  if (value === null) return '';
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim();
  }
  return trimmed;
}

function sourceFor(
  lookupSources: readonly BrazilReceitaFullJoinLookupSource[],
  family: RequiredLookup,
): BrazilReceitaFullJoinLookupSource {
  const matches = lookupSources.filter((source) => source.family === family);
  if (matches.length !== 1) {
    throw new BrReceitaNationalReferenceCatalogLoaderError('catalog_source_missing_or_duplicated');
  }
  const source = matches[0]!;
  if (source.encoding !== 'latin1') {
    throw new BrReceitaNationalReferenceCatalogLoaderError('catalog_encoding_invalid');
  }
  return source;
}

function boundedGuard(maxBytes: number, maxRows: number): BrazilReceitaFullJoinReaderResourceGuard {
  let bytesRead = 0;
  let rowsRead = 0;
  let breached = false;
  return {
    mayAccessData: () => !breached,
    noteFileOpened: () => ({ ok: !breached }),
    noteBytesRead(bytes) {
      bytesRead += bytes;
      if (bytesRead > maxBytes) breached = true;
      return { ok: !breached };
    },
    noteRowsRead(rows) {
      rowsRead += rows;
      if (rowsRead > maxRows) breached = true;
      return { ok: !breached };
    },
  };
}

function loadOne(args: {
  readonly source: BrazilReceitaFullJoinLookupSource;
  readonly fileSystem: BrazilReceitaFullJoinReaderFileSystem;
  readonly caps: BrReceitaNationalReferenceCatalogCaps;
}): readonly BrReceitaLookupRow[] {
  let declaredSize: number;
  try {
    declaredSize = args.fileSystem.size(args.source.filePath);
  } catch {
    throw new BrReceitaNationalReferenceCatalogLoaderError('catalog_size_unavailable');
  }
  if (
    !Number.isSafeInteger(declaredSize) ||
    declaredSize < 0 ||
    declaredSize > args.caps.maxBytesPerCatalog
  ) {
    throw new BrReceitaNationalReferenceCatalogLoaderError('catalog_size_exceeded');
  }

  const rows: BrReceitaLookupRow[] = [];
  const guard = boundedGuard(args.caps.maxBytesPerCatalog, args.caps.maxRowsPerCatalog);
  const outcome = readBrazilReceitaFullJoinFileSequentially({
    filePath: args.source.filePath,
    encoding: args.source.encoding,
    caps: {
      maxChunkBytes: args.caps.maxChunkBytes,
      maxCarryBytes: args.caps.maxRowBytes,
      maxRowBytes: args.caps.maxRowBytes,
      maxColumnsPerRow: 2,
    },
    fileSystem: args.fileSystem,
    resourceGuard: guard,
    onRow(row) {
      if (row.columnCount !== 2 || countBrReceitaCnpjDelimitedColumns(row.text, ';') !== 2) {
        throw new BrReceitaNationalReferenceCatalogLoaderError('catalog_layout_mismatch');
      }
      if (rows.length >= args.caps.maxRowsPerCatalog) {
        throw new BrReceitaNationalReferenceCatalogLoaderError('catalog_row_cap_exceeded');
      }
      rows.push({
        codigo: unquote(readBrazilReceitaFullJoinFieldAt(row.text, ';', 0)),
        descricao: unquote(readBrazilReceitaFullJoinFieldAt(row.text, ';', 1)),
      });
      return 'continue';
    },
  });

  if (!outcome.ok) {
    throw new BrReceitaNationalReferenceCatalogLoaderError('catalog_reader_refused');
  }
  if (!outcome.reachedEndOfFile || outcome.stoppedByVisitor) {
    throw new BrReceitaNationalReferenceCatalogLoaderError('catalog_reader_refused');
  }
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

/**
 * Reads only the three reference catalogs consumed by the national snapshot parser. `simples` may be
 * present in a manifest but is intentionally ignored here; SOCIOS/QSA/CPF cannot be represented by
 * the manifest bridge and therefore cannot reach this function.
 */
export function loadBrReceitaNationalReferenceCatalogs(args: {
  readonly lookupSources: readonly BrazilReceitaFullJoinLookupSource[];
  readonly fileSystem: BrazilReceitaFullJoinReaderFileSystem;
  readonly caps: BrReceitaNationalReferenceCatalogCaps;
}): BrReceitaNationalReferenceCatalogs {
  const caps = resolveCaps(args.caps);
  return Object.freeze({
    cnaesRows: loadOne({ source: sourceFor(args.lookupSources, 'cnaes'), fileSystem: args.fileSystem, caps }),
    municipiosRows: loadOne({
      source: sourceFor(args.lookupSources, 'municipios'),
      fileSystem: args.fileSystem,
      caps,
    }),
    naturezasRows: loadOne({
      source: sourceFor(args.lookupSources, 'naturezas'),
      fileSystem: args.fileSystem,
      caps,
    }),
  });
}
