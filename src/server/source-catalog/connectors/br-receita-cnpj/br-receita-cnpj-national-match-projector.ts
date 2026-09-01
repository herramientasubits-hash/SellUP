import { countBrReceitaCnpjDelimitedColumns } from './br-receita-cnpj-file-reader';
import {
  readBrazilReceitaFullJoinFieldAt,
  type BrazilReceitaFullJoinReaderFileSystem,
} from './br-receita-cnpj-full-join-streaming-reader';
import {
  validateBrazilReceitaFullJoinRowReference,
  type BrazilReceitaFullJoinRowReference,
} from './br-receita-cnpj-full-join-partition-workspace';
import type {
  BrazilReceitaFullJoinBoundedJoinedRecord,
  BrazilReceitaFullJoinSink,
  BrazilReceitaFullJoinSourceFileDescriptor,
} from './br-receita-cnpj-full-join-engine-contract';
import { buildBrReceitaCnpjSnapshotRows } from './br-receita-cnpj-snapshot-builder';
import { toBrReceitaPersistedSnapshot } from './br-receita-cnpj-monthly-snapshot-identity';
import type { BrReceitaExistingRunChunkWriter } from './br-receita-cnpj-existing-run-chunk-writer';
import type {
  BrReceitaEmpresaRow,
  BrReceitaEstabelecimentoRow,
  BrReceitaLookupRow,
  BrReceitaCnpjRejectionReason,
} from './br-receita-cnpj-types';

const OFFICIAL_DELIMITER = ';';
const EMPRESA_COLUMNS = 7;
const ESTABELECIMENTO_COLUMNS = 30;
const PROJECTOR_BATCH_ROWS = 500;

const EMP_CNPJ_BASICO = 0;
const EMP_RAZAO_SOCIAL = 1;
const EMP_NATUREZA = 2;
const EMP_CAPITAL = 4;
const EMP_PORTE = 5;

const EST_CNPJ_BASICO = 0;
const EST_CNPJ_ORDEM = 1;
const EST_CNPJ_DV = 2;
const EST_MATRIZ_FILIAL = 3;
const EST_SITUACAO = 5;
const EST_DATA_INICIO = 10;
const EST_CNAE_PRINCIPAL = 11;
const EST_CNAE_SECUNDARIA = 12;
const EST_UF = 19;
const EST_MUNICIPIO = 20;

export type BrReceitaNationalMatchProjectorFailureReason =
  | 'reference_invalid'
  | 'descriptor_missing'
  | 'reference_family_mismatch'
  | 'row_too_large'
  | 'row_read_failed'
  | 'row_short_read'
  | 'row_close_failed'
  | 'empresa_layout_mismatch'
  | 'estabelecimento_layout_mismatch'
  | 'parser_returned_multiple_rows';

/** Fixed-code failure: never includes a path, CNPJ, legal name or raw row. */
export class BrReceitaNationalMatchProjectorError extends Error {
  readonly reason: BrReceitaNationalMatchProjectorFailureReason;

  constructor(reason: BrReceitaNationalMatchProjectorFailureReason) {
    super(`br receita national match projector refused (${reason})`);
    this.name = 'BrReceitaNationalMatchProjectorError';
    this.reason = reason;
  }
}

export interface BrReceitaNationalReferenceCatalogs {
  readonly cnaesRows: readonly BrReceitaLookupRow[];
  readonly municipiosRows: readonly BrReceitaLookupRow[];
  readonly naturezasRows: readonly BrReceitaLookupRow[];
}

export interface BrReceitaNationalProjectorStats {
  readonly matchesReceived: number;
  readonly parserAcceptedRows: number;
  readonly parserRejectedRows: number;
  readonly rejectionCounts: Readonly<Partial<Record<BrReceitaCnpjRejectionReason, number>>>;
  readonly batchesParsed: number;
  readonly finalized: boolean;
}

function field(line: string, index: number): string {
  const raw = readBrazilReceitaFullJoinFieldAt(line, OFFICIAL_DELIMITER, index);
  if (raw === null) return '';
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim();
  }
  return trimmed;
}

function toEmpresaRow(line: string): BrReceitaEmpresaRow {
  if (countBrReceitaCnpjDelimitedColumns(line, OFFICIAL_DELIMITER) !== EMPRESA_COLUMNS) {
    throw new BrReceitaNationalMatchProjectorError('empresa_layout_mismatch');
  }
  return {
    cnpj_basico: field(line, EMP_CNPJ_BASICO),
    razao_social: field(line, EMP_RAZAO_SOCIAL),
    natureza_juridica: field(line, EMP_NATUREZA),
    capital_social: field(line, EMP_CAPITAL),
    porte_empresa: field(line, EMP_PORTE),
  };
}

function toEstabelecimentoRow(line: string): BrReceitaEstabelecimentoRow {
  if (countBrReceitaCnpjDelimitedColumns(line, OFFICIAL_DELIMITER) !== ESTABELECIMENTO_COLUMNS) {
    throw new BrReceitaNationalMatchProjectorError('estabelecimento_layout_mismatch');
  }
  return {
    cnpj_basico: field(line, EST_CNPJ_BASICO),
    cnpj_ordem: field(line, EST_CNPJ_ORDEM),
    cnpj_dv: field(line, EST_CNPJ_DV),
    identificador_matriz_filial: field(line, EST_MATRIZ_FILIAL) || null,
    situacao_cadastral: field(line, EST_SITUACAO) || null,
    data_inicio_atividade: field(line, EST_DATA_INICIO) || null,
    cnae_fiscal_principal: field(line, EST_CNAE_PRINCIPAL) || null,
    cnae_fiscal_secundaria: field(line, EST_CNAE_SECUNDARIA) || null,
    uf: field(line, EST_UF) || null,
    municipio: field(line, EST_MUNICIPIO) || null,
  };
}

interface ReferencedRowReader {
  read(reference: BrazilReceitaFullJoinRowReference): string;
}

/**
 * Rehydrates exactly one opaque row reference. The returned text is bounded by `maxRowBytes`, lives
 * only until the caller projects it, and is never logged or retained by this module.
 */
export function createBrReceitaReferencedRowReader(args: {
  readonly descriptors: readonly BrazilReceitaFullJoinSourceFileDescriptor[];
  readonly fileSystem: BrazilReceitaFullJoinReaderFileSystem;
  readonly maxRowBytes: number;
}): ReferencedRowReader {
  const descriptorByOrdinal = new Map(
    args.descriptors.map((descriptor) => [descriptor.sourceFileOrdinal, descriptor] as const),
  );

  return {
    read(reference): string {
      const validation = validateBrazilReceitaFullJoinRowReference(reference);
      if (!validation.ok) {
        throw new BrReceitaNationalMatchProjectorError('reference_invalid');
      }
      if (reference.byteLength > args.maxRowBytes) {
        throw new BrReceitaNationalMatchProjectorError('row_too_large');
      }

      const descriptor = descriptorByOrdinal.get(reference.sourceFileOrdinal);
      if (descriptor === undefined) {
        throw new BrReceitaNationalMatchProjectorError('descriptor_missing');
      }
      if (descriptor.family !== reference.family) {
        throw new BrReceitaNationalMatchProjectorError('reference_family_mismatch');
      }

      let handle: number | null = null;
      try {
        handle = args.fileSystem.open(descriptor.filePath);
        const buffer = Buffer.allocUnsafe(reference.byteLength);
        const bytesRead = args.fileSystem.read(
          handle,
          buffer,
          0,
          reference.byteLength,
          reference.byteOffset,
        );
        if (bytesRead !== reference.byteLength) {
          throw new BrReceitaNationalMatchProjectorError('row_short_read');
        }
        return buffer.toString(descriptor.encoding === 'latin1' ? 'latin1' : 'utf8');
      } catch (error) {
        if (error instanceof BrReceitaNationalMatchProjectorError) throw error;
        throw new BrReceitaNationalMatchProjectorError('row_read_failed');
      } finally {
        if (handle !== null) {
          try {
            args.fileSystem.close(handle);
          } catch {
            throw new BrReceitaNationalMatchProjectorError('row_close_failed');
          }
        }
      }
    },
  };
}

interface RawPair {
  readonly empresa: BrReceitaEmpresaRow;
  readonly estabelecimento: BrReceitaEstabelecimentoRow;
}

/**
 * Sink used by Stage 3 of the national join.
 *
 * It buffers at most 500 matched pairs, runs the existing approved parser over that bounded set,
 * projects accepted rows to the persisted shape, and forwards them to the existing-run writer.
 * Rejections are counted only by category; no rejected value or identifier is retained.
 */
export function createBrReceitaNationalMatchProjectorSink(args: {
  readonly sourcePeriod: string;
  readonly sourceYear: number;
  readonly descriptors: readonly BrazilReceitaFullJoinSourceFileDescriptor[];
  readonly fileSystem: BrazilReceitaFullJoinReaderFileSystem;
  readonly maxRowBytes: number;
  readonly catalogs: BrReceitaNationalReferenceCatalogs;
  readonly writer: BrReceitaExistingRunChunkWriter;
}): BrazilReceitaFullJoinSink & {
  readonly stats: () => BrReceitaNationalProjectorStats;
} {
  const rowReader = createBrReceitaReferencedRowReader({
    descriptors: args.descriptors,
    fileSystem: args.fileSystem,
    maxRowBytes: args.maxRowBytes,
  });

  let pairs: RawPair[] = [];
  let matchesReceived = 0;
  let parserAcceptedRows = 0;
  let parserRejectedRows = 0;
  let batchesParsed = 0;
  let finalized = false;
  const rejectionCounts: Partial<Record<BrReceitaCnpjRejectionReason, number>> = {};

  const stats = (): BrReceitaNationalProjectorStats => ({
    matchesReceived,
    parserAcceptedRows,
    parserRejectedRows,
    rejectionCounts: { ...rejectionCounts },
    batchesParsed,
    finalized,
  });

  const flush = async (): Promise<void> => {
    if (pairs.length === 0) return;

    const parsed = buildBrReceitaCnpjSnapshotRows({
      sourceYear: args.sourceYear,
      sourcePeriod: args.sourcePeriod,
      empresasRows: pairs.map((pair) => pair.empresa),
      estabelecimentosRows: pairs.map((pair) => pair.estabelecimento),
      cnaesRows: [...args.catalogs.cnaesRows],
      municipiosRows: [...args.catalogs.municipiosRows],
      naturezasRows: [...args.catalogs.naturezasRows],
    });

    if (parsed.snapshots.length > pairs.length) {
      throw new BrReceitaNationalMatchProjectorError('parser_returned_multiple_rows');
    }

    parserAcceptedRows += parsed.snapshots.length;
    parserRejectedRows += parsed.rejected.length;
    batchesParsed += 1;
    for (const rejection of parsed.rejected) {
      rejectionCounts[rejection.reasonCode] = (rejectionCounts[rejection.reasonCode] ?? 0) + 1;
    }
    for (const snapshot of parsed.snapshots) {
      await args.writer.push(toBrReceitaPersistedSnapshot(snapshot));
    }

    pairs = [];
  };

  return {
    async onMatch(match: BrazilReceitaFullJoinBoundedJoinedRecord): Promise<void> {
      if (finalized) {
        throw new BrReceitaNationalMatchProjectorError('parser_returned_multiple_rows');
      }
      matchesReceived += 1;
      const empresaLine = rowReader.read(match.empresaReference);
      const estabelecimentoLine = rowReader.read(match.estabelecimentoReference);
      pairs.push({
        empresa: toEmpresaRow(empresaLine),
        estabelecimento: toEstabelecimentoRow(estabelecimentoLine),
      });
      if (pairs.length >= PROJECTOR_BATCH_ROWS) {
        await flush();
      }
    },
    async onPartitionComplete(): Promise<void> {
      await flush();
    },
    async finalize(): Promise<void> {
      await flush();
      finalized = true;
    },
    stats,
  };
}
