import { createClient } from '@/lib/supabase/server';
import type { SourceConnectionTestResult } from './types';
import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import {
  sanitizeTestedUrl,
  sanitizeConnectionTestMetadata,
} from './persistence-sanitizers';

type PersistParams = {
  result: SourceConnectionTestResult;
  source: CatalogSource | null;
  internalUserId: string;
  userEmail: string | null;
};

export async function persistSourceConnectionTest(
  params: PersistParams,
): Promise<string | null> {
  const { result, source, internalUserId, userEmail } = params;

  try {
    const supabase = await createClient();

    const sanitizedUrl = sanitizeTestedUrl(result.testedUrl);
    const sanitizedMetadata = sanitizeConnectionTestMetadata(
      result.metadata as Record<string, unknown>,
    );

    const sanitizedErrorMessage =
      result.errorMessage !== null
        ? result.errorMessage.slice(0, 500)
        : null;

    const { data, error } = await supabase
      .from('source_connection_tests')
      .insert({
        source_key: result.sourceKey,
        source_name_snapshot: source?.name ?? null,
        source_country_codes_snapshot: source?.countryCodes ?? null,
        source_type_snapshot: source?.type ?? null,
        source_operational_status_snapshot: source?.operationalStatus ?? null,
        tested_by_user_id: internalUserId,
        tested_by_email_snapshot: userEmail,
        strategy: result.strategy,
        status: result.status,
        http_status: result.httpStatus,
        response_time_ms: result.responseTimeMs,
        tested_url: sanitizedUrl,
        content_type: result.contentType,
        content_length: result.contentLength,
        error_code: result.errorCode,
        error_message_sanitized: sanitizedErrorMessage,
        recommendation: result.recommendation,
        metadata: sanitizedMetadata,
        checked_at: result.checkedAt,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[persist-source-connection-test] insert failed:', error.message);
      return null;
    }

    return data?.id ?? null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[persist-source-connection-test] unexpected error:', message);
    return null;
  }
}
