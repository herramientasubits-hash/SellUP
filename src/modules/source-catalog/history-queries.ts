import { createClient } from '@/lib/supabase/server';
import type {
  SourceConnectionTestStatus,
  SourceConnectionTestStrategy,
  SourceConnectionTestErrorCode,
} from '@/server/source-catalog/connection-test/types';

export type SourceConnectionTestHistoryItem = {
  id: string;
  sourceKey: string;
  strategy: SourceConnectionTestStrategy;
  status: SourceConnectionTestStatus;
  httpStatus: number | null;
  responseTimeMs: number | null;
  testedUrl: string | null;
  contentType: string | null;
  contentLength: number | null;
  errorCode: SourceConnectionTestErrorCode;
  errorMessageSanitized: string | null;
  recommendation: string | null;
  testedByEmailSnapshot: string | null;
  checkedAt: string;
  createdAt: string;
};

export type SourceConnectionTestHistoryViewModel = {
  latest: SourceConnectionTestHistoryItem | null;
  items: SourceConnectionTestHistoryItem[];
  totalShown: number;
};

const HISTORY_LIMIT = 20;

const SELECTED_COLUMNS = [
  'id',
  'source_key',
  'strategy',
  'status',
  'http_status',
  'response_time_ms',
  'tested_url',
  'content_type',
  'content_length',
  'error_code',
  'error_message_sanitized',
  'recommendation',
  'tested_by_email_snapshot',
  'checked_at',
  'created_at',
].join(', ');

type DbRow = {
  id: string;
  source_key: string;
  strategy: string;
  status: string;
  http_status: number | null;
  response_time_ms: number | null;
  tested_url: string | null;
  content_type: string | null;
  content_length: number | bigint | null;
  error_code: string;
  error_message_sanitized: string | null;
  recommendation: string | null;
  tested_by_email_snapshot: string | null;
  checked_at: string;
  created_at: string;
};

function mapRow(row: DbRow): SourceConnectionTestHistoryItem {
  return {
    id: row.id,
    sourceKey: row.source_key,
    strategy: row.strategy as SourceConnectionTestStrategy,
    status: row.status as SourceConnectionTestStatus,
    httpStatus: row.http_status,
    responseTimeMs: row.response_time_ms,
    testedUrl: row.tested_url,
    contentType: row.content_type,
    contentLength: row.content_length != null ? Number(row.content_length) : null,
    errorCode: row.error_code as SourceConnectionTestErrorCode,
    errorMessageSanitized: row.error_message_sanitized,
    recommendation: row.recommendation,
    testedByEmailSnapshot: row.tested_by_email_snapshot,
    checkedAt: row.checked_at,
    createdAt: row.created_at,
  };
}

const EMPTY: SourceConnectionTestHistoryViewModel = {
  latest: null,
  items: [],
  totalShown: 0,
};

export async function getSourceConnectionTestHistory(
  sourceKey: string,
): Promise<SourceConnectionTestHistoryViewModel> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('source_connection_tests')
      .select(SELECTED_COLUMNS)
      .eq('source_key', sourceKey)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);

    if (error || !data || data.length === 0) return EMPTY;

    const items = (data as unknown as DbRow[]).map(mapRow);
    return {
      latest: items[0] ?? null,
      items,
      totalShown: items.length,
    };
  } catch {
    return EMPTY;
  }
}
