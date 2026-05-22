'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { runAndWriteProspectingPipeline } from '@/server/agents/prospecting-toolkit/candidate-writer';
import type { BatchSearchDepth } from './types';

// ── Auth ──────────────────────────────────────────────────────

async function requireActiveUser(): Promise<{ internalUserId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');
  return { internalUserId: internalUser.id };
}

// ── Types ──────────────────────────────────────────────────────

export interface GenerateMockBatchInput {
  country: string;
  countryCode: string;
  industry: string;
  targetCount: number;
  searchDepth: BatchSearchDepth;
}

export interface GenerateMockBatchResult {
  batchId: string;
  candidatesCreated: number;
  status: string;
  warnings: string[];
  summary: {
    requested: number;
    returned: number;
    highQualityNew: number;
    needsReview: number;
    duplicates: number;
  };
}

// ── Action ─────────────────────────────────────────────────────

const MOCK_MAX_TARGET = 25;

/**
 * Genera un lote de prospección en modo mock seguro.
 *
 * Garantías:
 * - webSearchProvider forzado a "mock" — nunca llama Tavily real
 * - No llama Apollo, Lusha ni proveedor IA
 * - No crea accounts
 * - No escribe en HubSpot
 * - targetCount limitado a 25
 */
export async function generateMockProspectingBatch(
  input: GenerateMockBatchInput
): Promise<GenerateMockBatchResult> {
  const { internalUserId } = await requireActiveUser();

  if (!input.country || !input.countryCode) {
    throw new Error('País requerido para generar el lote de prueba');
  }
  if (!input.industry) {
    throw new Error('Industria requerida para generar el lote de prueba');
  }
  if (input.targetCount < 1 || input.targetCount > MOCK_MAX_TARGET) {
    throw new Error(`La cantidad debe estar entre 1 y ${MOCK_MAX_TARGET}`);
  }

  const { pipeline, writer } = await runAndWriteProspectingPipeline({
    country: input.country,
    countryCode: input.countryCode,
    industry: input.industry,
    targetCount: input.targetCount,
    searchDepth: input.searchDepth,
    webSearchProvider: 'mock',
    triggeredByUserId: internalUserId,
    ownerId: internalUserId,
  });

  if (writer.status === 'failed' || !writer.batchId) {
    const reason = writer.errors.length > 0 ? writer.errors[0] : 'El pipeline no pudo crear el lote';
    throw new Error(reason);
  }

  revalidatePath('/prospect-batches');
  revalidatePath(`/prospect-batches/${writer.batchId}`);

  return {
    batchId: writer.batchId,
    candidatesCreated: writer.candidatesCreated,
    status: writer.status,
    warnings: pipeline.warnings ?? [],
    summary: {
      requested: pipeline.summary.requested,
      returned: pipeline.summary.returned,
      highQualityNew: pipeline.summary.highQualityNew,
      needsReview: pipeline.summary.needsReview,
      duplicates: pipeline.summary.duplicates,
    },
  };
}
