/**
 * Samu IA API Client
 *
 * Capa de integración con la API de Samu IA.
 * Todos los métodos requieren que la API Key esté configurada en Vault.
 *
 * Autenticación oficial: header "apiKey: {value}"
 * Base URL: https://api.samu.ai
 *
 * Estado de implementación:
 *   ✅ testSamuHealth          — Activo. Valida la conexión con /api/users.
 *   🔜 listSamuMeetings        — Preparado. No conectado a UI todavía.
 *   🔜 getSamuMeetingDetail    — Preparado. No conectado a UI todavía.
 *   🔜 getSamuTranscript       — Preparado. No conectado a UI todavía.
 *   🔜 normalizeSamuTranscript — Preparado. Normalización defensiva (JSON + plain text).
 *
 * PENDIENTE DE VALIDAR con API Key real:
 *   - Estructura real del campo `extractor` en Meeting (completamente sin tipar en spec).
 *   - Content-type real de /api/meeting/{id}/transcription (spec dice text/plain, schema es JSON).
 *   - Webhooks: no documentados en el spec v1.0.1.
 *   - Paginación: no documentada — solo filtro por rango de fechas.
 */

import { getSamuApiKey } from '@/server/services/samu-connection';

const SAMU_BASE_URL = 'https://api.samu.ai';

// ============================================================
// Tipos base de la API de Samu
// ============================================================

export type SamuProvider = 'GOOGLE' | 'HUBSPOT' | 'MICROSOFT' | 'ZOOM' | 'AIRCALL' | 'IVR';

export interface SamuUser {
  id: string;
  name: string;
  email: string;
  enabled: boolean;
  image?: string | null;
  lang?: string | null;
}

export interface SamuDeal {
  id?: string;
  name?: string;
  amount?: number;
  stage?: string;
}

export interface SamuScore {
  evaluables?: Record<string, unknown>;
  score?: number;
  feedback?: string;
}

export interface SamuMeeting {
  id: string;
  name?: string;
  eventId?: string;
  provider?: SamuProvider;
  hostEmail?: string;
  conferenceId?: string;
  stakeholders?: string[];
  dateFrom?: string;
  dateTo?: string;
  media?: string;
  duration?: number;
  users?: string[];
  score?: SamuScore;
  extractor?: Record<string, unknown>;
  deal?: SamuDeal;
}

export interface SamuTranscriptionMessage {
  id: string;
  text: string;
  participantId: number;
  startAt?: number;
  endAt?: number;
}

export interface SamuTranscription {
  messages?: SamuTranscriptionMessage[];
  participants?: Record<string, string>;
}

// ============================================================
// Tipos normalizados (output para SellUp)
// ============================================================

export interface NormalizedSamuSegment {
  externalMessageId: string;
  speakerExternalId: string;
  speakerName: string;
  text: string;
  startAt: number;
  endAt: number;
  sequence: number;
}

export interface NormalizedSamuParticipant {
  externalId: string;
  name: string;
}

export interface NormalizedSamuTranscript {
  segments: NormalizedSamuSegment[];
  participants: NormalizedSamuParticipant[];
  diarizationAvailable: boolean;
  rawText?: string;
}

export interface SamuApiError {
  error: string;
  message: string;
  statusCode?: number;
}

export interface SamuResult<T> {
  success: boolean;
  data?: T;
  error?: SamuApiError;
}

// ============================================================
// Helper interno de fetch autenticado
// ============================================================

async function samuFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; data?: T; status: number; rawText?: string; errorBody?: string }> {
  const apiKey = await getSamuApiKey();

  if (!apiKey) {
    return { ok: false, status: 401, errorBody: 'No API key configured' };
  }

  const response = await fetch(`${SAMU_BASE_URL}${path}`, {
    ...options,
    headers: {
      apiKey: apiKey.trim(),
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const status = response.status;

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    return { ok: false, status, errorBody: errorBody.slice(0, 500) };
  }

  // Content-type detection: /api/meeting/{id}/transcription is declared as
  // text/plain in the spec but the schema is JSON — parse defensively.
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => undefined) as T;
    return { ok: true, data, status };
  }

  const rawText = await response.text().catch(() => '');
  try {
    const data = JSON.parse(rawText) as T;
    return { ok: true, data, status };
  } catch {
    return { ok: true, status, rawText };
  }
}

// ============================================================
// Listar meetings por rango de fechas
// GET /api/meetings?dateFrom=...&dateTo=...
//
// ESTADO: Preparado — no conectado a UI todavía.
// Requiere validación con API Key real antes de activar.
// ============================================================

export async function listSamuMeetings(params: {
  dateFrom: string;
  dateTo: string;
}): Promise<SamuResult<SamuMeeting[]>> {
  const qs = new URLSearchParams({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  const result = await samuFetch<SamuMeeting[]>(`/api/meetings?${qs.toString()}`);

  if (!result.ok) {
    return {
      success: false,
      error: {
        error: `HTTP_${result.status}`,
        message: result.errorBody ?? 'Error al listar reuniones de Samu IA',
        statusCode: result.status,
      },
    };
  }

  return { success: true, data: result.data ?? [] };
}

// ============================================================
// Detalle de una meeting
// GET /api/meeting/{id}
//
// ESTADO: Preparado — no conectado a UI todavía.
// Nota: el campo `extractor` retorna información de IA extraída
// (dolores, necesidades, compromisos, etc.) pero su estructura
// real no está documentada en el spec v1.0.1 y debe validarse
// con una reunión real antes de mapear sus campos.
// ============================================================

export async function getSamuMeetingDetail(
  samuMeetingId: string
): Promise<SamuResult<SamuMeeting>> {
  const result = await samuFetch<SamuMeeting>(`/api/meeting/${samuMeetingId}`);

  if (!result.ok) {
    return {
      success: false,
      error: {
        error: `HTTP_${result.status}`,
        message: result.errorBody ?? 'Error al obtener detalle de reunión',
        statusCode: result.status,
      },
    };
  }

  return { success: true, data: result.data };
}

// ============================================================
// Transcripción de una meeting
// GET /api/meeting/{id}/transcription
//
// ESTADO: Preparado — no conectado a UI todavía.
// IMPORTANTE: El spec declara content-type text/plain pero el
// schema de respuesta es JSON (Transcription). samuFetch maneja
// ambos casos defensivamente. Validar con API Key real.
// ============================================================

export async function getSamuTranscript(
  samuMeetingId: string
): Promise<SamuResult<NormalizedSamuTranscript>> {
  const result = await samuFetch<unknown>(`/api/meeting/${samuMeetingId}/transcription`);

  if (!result.ok) {
    return {
      success: false,
      error: {
        error: `HTTP_${result.status}`,
        message: result.errorBody ?? 'Error al obtener transcripción',
        statusCode: result.status,
      },
    };
  }

  const raw = result.data ?? result.rawText ?? '';
  const normalized = normalizeSamuTranscript(raw);
  return { success: true, data: normalized };
}

// ============================================================
// Normalización defensiva de transcripción
// ============================================================

/**
 * Normaliza el payload crudo de transcripción de Samu IA.
 *
 * Caso A — JSON diarizado (esperado):
 *   { messages: [{id, text, participantId, startAt, endAt}], participants: {"1": "Nombre"} }
 *   → Retorna segments con speakerName resuelto + participants array.
 *   → diarizationAvailable: true
 *
 * Caso B — Texto plano (fallback por inconsistencia del spec):
 *   → Retorna rawText, segments vacíos.
 *   → diarizationAvailable: false
 */
export function normalizeSamuTranscript(raw: unknown): NormalizedSamuTranscript {
  if (typeof raw === 'object' && raw !== null && 'messages' in raw) {
    const typed = raw as SamuTranscription;
    const participantsMap = typed.participants ?? {};

    const participants: NormalizedSamuParticipant[] = Object.entries(participantsMap).map(
      ([id, name]) => ({ externalId: id, name })
    );

    const lookup = new Map(participants.map((p) => [p.externalId, p.name]));

    const segments: NormalizedSamuSegment[] = (typed.messages ?? []).map((msg, idx) => ({
      externalMessageId: msg.id,
      speakerExternalId: String(msg.participantId),
      speakerName: lookup.get(String(msg.participantId)) ?? `Participante ${msg.participantId}`,
      text: msg.text,
      startAt: msg.startAt ?? 0,
      endAt: msg.endAt ?? 0,
      sequence: idx,
    }));

    return { segments, participants, diarizationAvailable: segments.length > 0 };
  }

  const rawText = typeof raw === 'string' ? raw : '';
  return { segments: [], participants: [], diarizationAvailable: false, rawText };
}
