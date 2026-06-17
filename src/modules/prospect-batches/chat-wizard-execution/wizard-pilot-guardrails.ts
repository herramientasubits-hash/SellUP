/**
 * wizard-pilot-guardrails.ts — Settings loader and participant checker.
 *
 * Server-only. Never import from client components.
 * Not connected to executeProspectWizardGenerationAction yet (16AB.43.17).
 *
 * Dependencies are injected so tests can run without a real Supabase client.
 */

import type { WizardPilotSettings, WizardPilotParticipant } from './wizard-pilot-types';

// ── Injectable DB client interface ───────────────────────────────────────────

export type PilotSettingsRow = {
  id: string;
  pilot_enabled: boolean;
  max_credits_per_execution: number;
  max_active_executions_per_user: number;
  budget_timezone: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

export type PilotParticipantRow = {
  user_id: string;
  is_enabled: boolean;
  enabled_at: string | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
  enabled_by: string | null;
};

export type DbSingleResult<T> = { data: T | null; error: { code?: string; message: string } | null };

export type PilotGuardrailsDbClient = {
  from(table: string): {
    select(columns: string): {
      limit(n: number): Promise<DbSingleResult<PilotSettingsRow[]>>;
      eq(column: string, value: string): {
        maybeSingle(): Promise<DbSingleResult<PilotParticipantRow>>;
      };
    };
  };
};

// ── Errors ───────────────────────────────────────────────────────────────────

export class PilotSettingsError extends Error {
  constructor(
    public readonly code: 'SETTINGS_NOT_FOUND' | 'SETTINGS_LOAD_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'PilotSettingsError';
  }
}

// ── Settings loader ──────────────────────────────────────────────────────────

export async function loadWizardPilotSettings(
  db: PilotGuardrailsDbClient,
): Promise<WizardPilotSettings> {
  const { data, error } = await db
    .from('wizard_pilot_settings')
    .select('id,pilot_enabled,max_credits_per_execution,max_active_executions_per_user,budget_timezone,created_at,updated_at,updated_by')
    .limit(1);

  if (error) {
    throw new PilotSettingsError('SETTINGS_LOAD_FAILED', error.message);
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    throw new PilotSettingsError('SETTINGS_NOT_FOUND', 'wizard_pilot_settings singleton row is missing');
  }

  const row = rows[0]!;
  return {
    id: row.id,
    pilotEnabled: row.pilot_enabled,
    maxCreditsPerExecution: row.max_credits_per_execution,
    maxActiveExecutionsPerUser: row.max_active_executions_per_user,
    budgetTimezone: row.budget_timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// ── Participant checker ──────────────────────────────────────────────────────

export type ParticipantCheckResult =
  | { allowed: true; participant: WizardPilotParticipant }
  | { allowed: false; reason: 'not_in_allowlist' | 'participant_disabled' };

export async function checkWizardPilotParticipant(
  userId: string,
  db: PilotGuardrailsDbClient,
): Promise<ParticipantCheckResult> {
  const { data, error } = await db
    .from('wizard_pilot_participants')
    .select('user_id,is_enabled,enabled_at,disabled_at,created_at,updated_at,enabled_by')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // Re-throw unexpected DB errors; let the caller decide how to handle them
    throw new Error(`participant_check_failed: ${error.message}`);
  }

  if (!data) {
    return { allowed: false, reason: 'not_in_allowlist' };
  }

  if (!data.is_enabled) {
    return { allowed: false, reason: 'participant_disabled' };
  }

  return {
    allowed: true,
    participant: {
      userId: data.user_id,
      isEnabled: data.is_enabled,
      enabledAt: data.enabled_at,
      disabledAt: data.disabled_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      enabledBy: data.enabled_by,
    },
  };
}
