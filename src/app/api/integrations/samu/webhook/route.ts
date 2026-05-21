import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lrdruowtadwbdulndlph.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ALLOWED_HEADER_KEYS = new Set([
  'content-type',
  'user-agent',
  'x-samu-event',
  'x-samu-delivery',
  'x-samu-signature',
  'x-samu-timestamp',
  'x-forwarded-for',
  'cf-connecting-ip',
]);

function sanitizeHeaders(raw: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  raw.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (ALLOWED_HEADER_KEYS.has(lower)) {
      out[lower] = value;
    }
  });
  return out;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const receivedAt = new Date().toISOString();

  // ── Secret validation ────────────────────────────────────────
  const expectedSecret = process.env.SAMU_WEBHOOK_SECRET;
  const providedSecret = request.headers.get('x-sellup-webhook-secret');

  if (expectedSecret) {
    if (!providedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  // ── Parse body ───────────────────────────────────────────────
  const contentType = request.headers.get('content-type') ?? '';
  let payload: unknown = null;
  let rawBody: string | null = null;

  try {
    const text = await request.text();
    rawBody = text.slice(0, 50_000);
    if (contentType.includes('application/json') && text) {
      payload = JSON.parse(text);
    }
  } catch {
    // keep payload null, rawBody has the text
  }

  const eventType = request.headers.get('x-samu-event') ?? null;
  const headers = sanitizeHeaders(request.headers);

  // ── Persist to DB ────────────────────────────────────────────
  if (!SERVICE_KEY) {
    return NextResponse.json(
      { ok: false, error: 'Service key not configured' },
      { status: 500 }
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { error: insertError } = await admin.from('integration_webhook_events').insert({
    integration_key: 'samu_ia',
    event_source: 'samu',
    event_type: eventType,
    headers,
    payload: payload ?? null,
    raw_body: rawBody,
    received_at: receivedAt,
    processed_status: 'received',
  });

  if (insertError) {
    console.error('[samu/webhook] DB insert error:', insertError.message);
    return NextResponse.json({ ok: false, error: 'Storage error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
