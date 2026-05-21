'use server';

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type {
  AgentRun,
  AgentRunStep,
  CreateAgentRunInput,
  UpdateAgentRunInput,
  CreateAgentRunStepInput,
  FinishAgentRunStepInput,
  LogProviderUsageInput,
  LogResultQualityEventInput,
} from './types';

// ============================================================
// Admin client — inserts bypass RLS (service_role)
// ============================================================

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ============================================================
// Sanitize metadata: strip keys that may contain secrets
// ============================================================

const REDACTED_KEYS = new Set([
  'api_key', 'apiKey', 'token', 'access_token', 'secret', 'password',
  'authorization', 'auth', 'credential', 'bearer',
]);

function sanitizeMetadata(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      result[k] = '[REDACTED]';
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = sanitizeMetadata(v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ============================================================
// agent_runs
// ============================================================

export async function createAgentRun(input: CreateAgentRunInput): Promise<AgentRun | null> {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('agent_runs')
      .insert({
        agent_key: input.agent_key,
        agent_name: input.agent_name ?? null,
        triggered_by: input.triggered_by ?? null,
        status: 'running',
        input_params: input.input_params ?? {},
        results_requested: input.results_requested ?? null,
        metadata: sanitizeMetadata(input.metadata ?? {}),
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[usage-tracking] createAgentRun error:', error.message);
      return null;
    }
    return data as AgentRun;
  } catch (err) {
    console.error('[usage-tracking] createAgentRun unexpected error:', err);
    return null;
  }
}

export async function updateAgentRun(
  id: string,
  input: UpdateAgentRunInput
): Promise<boolean> {
  try {
    const admin = getAdminClient();
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.status !== undefined) payload.status = input.status;
    if (input.results_generated !== undefined) payload.results_generated = input.results_generated;
    if (input.results_unique !== undefined) payload.results_unique = input.results_unique;
    if (input.results_approved !== undefined) payload.results_approved = input.results_approved;
    if (input.results_discarded !== undefined) payload.results_discarded = input.results_discarded;
    if (input.estimated_cost_usd !== undefined) payload.estimated_cost_usd = input.estimated_cost_usd;
    if (input.real_cost_usd !== undefined) payload.real_cost_usd = input.real_cost_usd;
    if (input.finished_at !== undefined) payload.finished_at = input.finished_at;
    if (input.error_message !== undefined) payload.error_message = input.error_message;
    if (input.metadata !== undefined) payload.metadata = sanitizeMetadata(input.metadata);

    const { error } = await admin.from('agent_runs').update(payload).eq('id', id);
    if (error) {
      console.error('[usage-tracking] updateAgentRun error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[usage-tracking] updateAgentRun unexpected error:', err);
    return false;
  }
}

// ============================================================
// agent_run_steps
// ============================================================

export async function createAgentRunStep(
  input: CreateAgentRunStepInput
): Promise<AgentRunStep | null> {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('agent_run_steps')
      .insert({
        agent_run_id: input.agent_run_id,
        step_key: input.step_key,
        step_name: input.step_name ?? null,
        provider_key: input.provider_key ?? null,
        status: 'attempted',
        metadata: sanitizeMetadata(input.metadata ?? {}),
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[usage-tracking] createAgentRunStep error:', error.message);
      return null;
    }
    return data as AgentRunStep;
  } catch (err) {
    console.error('[usage-tracking] createAgentRunStep unexpected error:', err);
    return null;
  }
}

export async function finishAgentRunStep(
  stepId: string,
  input: FinishAgentRunStepInput
): Promise<boolean> {
  try {
    const admin = getAdminClient();
    const now = new Date().toISOString();

    const payload: Record<string, unknown> = {
      status: input.status,
      finished_at: now,
    };

    if (input.results_returned !== undefined) payload.results_returned = input.results_returned;
    if (input.results_useful !== undefined) payload.results_useful = input.results_useful;
    if (input.estimated_cost_usd !== undefined) payload.estimated_cost_usd = input.estimated_cost_usd;
    if (input.real_cost_usd !== undefined) payload.real_cost_usd = input.real_cost_usd;
    if (input.duration_ms !== undefined) payload.duration_ms = input.duration_ms;
    if (input.error_message !== undefined) payload.error_message = input.error_message;
    if (input.metadata !== undefined) payload.metadata = sanitizeMetadata(input.metadata);

    const { error } = await admin.from('agent_run_steps').update(payload).eq('id', stepId);
    if (error) {
      console.error('[usage-tracking] finishAgentRunStep error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[usage-tracking] finishAgentRunStep unexpected error:', err);
    return false;
  }
}

// ============================================================
// provider_usage_logs
// ============================================================

export async function logProviderUsage(input: LogProviderUsageInput): Promise<boolean> {
  try {
    const admin = getAdminClient();
    const { error } = await admin.from('provider_usage_logs').insert({
      agent_run_id: input.agent_run_id ?? null,
      agent_run_step_id: input.agent_run_step_id ?? null,
      provider_key: input.provider_key,
      operation_key: input.operation_key,
      model: input.model ?? null,
      input_tokens: input.input_tokens ?? 0,
      output_tokens: input.output_tokens ?? 0,
      credits_used: input.credits_used ?? null,
      results_returned: input.results_returned ?? 0,
      estimated_cost_usd: input.estimated_cost_usd ?? 0,
      real_cost_usd: input.real_cost_usd ?? null,
      status: input.status ?? 'success',
      error_code: input.error_code ?? null,
      error_message: input.error_message ? input.error_message.slice(0, 500) : null,
      duration_ms: input.duration_ms ?? null,
      triggered_by: input.triggered_by ?? null,
      metadata: sanitizeMetadata(input.metadata ?? {}),
    });

    if (error) {
      console.error('[usage-tracking] logProviderUsage error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[usage-tracking] logProviderUsage unexpected error:', err);
    return false;
  }
}

// ============================================================
// result_quality_events
// ============================================================

export async function logResultQualityEvent(
  input: LogResultQualityEventInput
): Promise<boolean> {
  try {
    const admin = getAdminClient();
    const { error } = await admin.from('result_quality_events').insert({
      agent_run_id: input.agent_run_id ?? null,
      result_type: input.result_type,
      result_id: input.result_id ?? null,
      external_id: input.external_id ?? null,
      event_type: input.event_type,
      source_key: input.source_key ?? null,
      performed_by: input.performed_by ?? null,
      notes: input.notes ?? null,
      metadata: sanitizeMetadata(input.metadata ?? {}),
    });

    if (error) {
      console.error('[usage-tracking] logResultQualityEvent error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[usage-tracking] logResultQualityEvent unexpected error:', err);
    return false;
  }
}
