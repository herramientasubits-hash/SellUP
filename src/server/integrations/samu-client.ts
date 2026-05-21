/**
 * Samu IA API Client
 *
 * Capa de integración con la API de Samu IA.
 * Todos los métodos requieren que la API Key esté configurada en Vault.
 *
 * Autenticación oficial: header "apiKey: {value}"
 * Base URL: https://api.samu.ai
 *
 * ── Validación real con API Key (2026-05-20) ──────────────────
 * Endpoint  GET /api/meetings  → funciona con rangos ≤ 2h (504 en ≥7d)
 * Endpoint  GET /api/meeting/{id}  → devuelve extractor (19 campos), score, stakeholders
 * Endpoint  GET /api/meeting/{id}/transcription  → Array<{text, date}> — SIN diarización
 *
 * HALLAZGO CRÍTICO — Transcripción real:
 *   La API devuelve un array plano [{text, date}], NO el objeto {messages, participants}
 *   documentado en el spec OpenAPI v1.0.1. No hay participantId ni speaker mapping.
 *   La diarización ("quién dijo qué") NO está disponible en la transcripción cruda.
 *
 * ESTRATEGIA Phase 2:
 *   extractor.samu_summary / samu_longSummary / samu_actionItems / punto_de_dolor
 *   → Fuente principal para el agente post-reunión.
 *   Raw transcript [{text, date}] → Respaldo cronológico sin speaker.
 *   IA SellUp → Fallback/híbrido para enriquecimiento adicional.
 *
 * Estado de implementación:
 *   ✅ testSamuHealth          — Activo. Valida con /api/users.
 *   🔜 listSamuMeetings        — Preparado. No conectado a UI.
 *   🔜 getSamuMeetingDetail    — Preparado. No conectado a UI.
 *   🔜 getSamuTranscript       — Preparado. No conectado a UI.
 *   ✅ normalizeSamuTranscript — Actualizado con formato real validado.
 */

import { getSamuApiKey } from '@/server/services/samu-connection';

const SAMU_BASE_URL = 'https://api.samu.ai';

// ============================================================
// Tipos base de la API de Samu
// ============================================================

export type SamuProvider = 'GOOGLE' | 'HUBSPOT' | 'MICROSOFT' | 'ZOOM' | 'AIRCALL' | 'IVR';

/** Categoría de reunión — la API devuelve objeto, no string */
export interface SamuCallType {
  _id: string;
  name: string;
}

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
  /** Puntuación numérica (ej: 10) */
  score?: number;
  feedback?: string;
}

/**
 * Extractor: campo IA de Samu con 19+ sub-campos validados.
 * Claves confirmadas en prueba real 2026-05-20.
 */
export interface SamuExtractor {
  /** Resumen corto de la reunión */
  samu_summary?: string;
  /** Resumen detallado / largo */
  samu_longSummary?: string;
  /** Compromisos y tareas identificadas */
  samu_actionItems?: string[];
  /** Objeciones detectadas */
  samu_objections?: string[];
  /** Fecha sugerida de próximo paso */
  samu_nextStepDate?: string;
  /** Clave de probabilidad (numérica) */
  samu_probKey?: number;
  /** Descripción de probabilidad */
  samu_probDesc?: string;
  /** Competencias evaluadas */
  samu_competence?: string;
  /** Punto de dolor del cliente (cita textual) */
  punto_de_dolor?: string;
  /** Citas textuales del cliente */
  voice_of_customer_verbal?: string;
  /** Señales de churn detectadas */
  señales_de_churn_verbal?: string;
  /** Categoría de riesgo de churn */
  categoría_riesgo_de_churn?: string;
  /** Tipo de reunión */
  tipos_de_reunión?: string;
  /** Modalidad (Virtual / Presencial) */
  modalidad_de_reunión?: string;
  /** Categoría de conversación */
  categoría_de_conversación?: string;
  [key: string]: unknown;
}

export interface SamuMeeting {
  id: string;
  name?: string;
  eventId?: string;
  provider?: SamuProvider;
  hostEmail?: string;
  conferenceId?: string;
  /** Emails de participantes externos */
  stakeholders?: string[];
  dateFrom?: string;
  dateTo?: string;
  media?: string;
  /** Duración en minutos (float, ej: 60.37) — no en segundos */
  duration?: number;
  /** IDs de usuarios internos de Samu */
  users?: string[];
  score?: SamuScore;
  /**
   * Extractor con insights IA de la reunión.
   * 19+ campos confirmados. Ver SamuExtractor para claves conocidas.
   */
  extractor?: SamuExtractor | Record<string, unknown>;
  deal?: SamuDeal;
  /** La API devuelve objeto {_id, name}, no string */
  callType?: SamuCallType | string | null;
}

// ============================================================
// Tipos de transcripción — REAL vs SPEC
// ============================================================

/**
 * Formato REAL validado 2026-05-20.
 * GET /api/meeting/{id}/transcription → Array<SamuTranscriptionSegmentReal>
 * Sin participantId, sin speaker mapping.
 */
export interface SamuTranscriptionSegmentReal {
  text: string;
  /** Timestamp ISO de la intervención: "2026-05-20T21:32:03.949Z" */
  date: string;
}

/**
 * Formato SPEC (OpenAPI v1.0.1) — mantenido para parsing defensivo.
 * No fue devuelto en la prueba real pero se parsea si llega.
 */
export interface SamuTranscriptionMessage {
  id: string;
  text: string;
  participantId: number;
  startAt?: number;
  endAt?: number;
}

/** Spec format — mantenido como fallback defensivo */
export interface SamuTranscriptionSpec {
  messages?: SamuTranscriptionMessage[];
  participants?: Record<string, string>;
}

/**
 * El raw payload puede ser cualquiera de los tres formatos.
 * normalizeSamuTranscript() detecta y normaliza.
 */
export type SamuTranscriptionRaw =
  | SamuTranscriptionSegmentReal[]
  | SamuTranscriptionSpec
  | string;

// ============================================================
// Tipos normalizados (output para SellUp)
// ============================================================

export interface NormalizedSamuSegment {
  externalMessageId: string;
  /** null cuando no hay diarización (formato real) */
  speakerExternalId: string | null;
  /** null cuando no hay diarización (formato real) */
  speakerName: string | null;
  text: string;
  /** ms desde epoch (ISO date convertido) o offset desde inicio */
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
  /**
   * false en el formato real validado (Array<{text,date}>).
   * true solo si llega el formato spec con messages+participants.
   */
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

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => undefined) as T;
    return { ok: true, data, status };
  }

  // Parsing defensivo: spec declara text/plain pero puede venir JSON
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
// IMPORTANTE: Usar rangos ≤ 2h. Rangos ≥ 7d producen 504.
// No hay paginación documentada — filtrar por rango incremental.
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
// Campos confirmados: extractor (19 sub-campos), score, stakeholders,
// hostEmail, deal, callType (objeto {_id, name}), duration (minutos float).
// No todos los meetings tienen extractor procesado — depende de Samu.
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
// Formato REAL validado 2026-05-20:
//   Array<{ text: string; date: string }>
//   — SIN participantId, SIN speaker mapping, SIN diarización.
//   — date es ISO datetime del segmento.
//
// Formato SPEC (OpenAPI v1.0.1) — soportado defensivamente:
//   { messages: [{id, text, participantId, startAt, endAt}], participants: {id: name} }
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
//
// Caso A — Array real [{text, date}] (formato validado 2026-05-20):
//   → segments con timestamp desde ISO date, speakerName=null, diarizationAvailable=false
//
// Caso B — Spec {messages, participants} (fallback defensivo):
//   → segments con speakerName resuelto, diarizationAvailable=true
//
// Caso C — String / texto plano:
//   → rawText, segments vacíos, diarizationAvailable=false
// ============================================================

export function normalizeSamuTranscript(raw: unknown): NormalizedSamuTranscript {
  // Caso A: Array<{text, date}> — formato real validado
  if (Array.isArray(raw)) {
    const segments: NormalizedSamuSegment[] = raw
      .filter((item): item is SamuTranscriptionSegmentReal =>
        typeof item === 'object' && item !== null && 'text' in item
      )
      .map((item, idx) => {
        const ts = item.date ? new Date(item.date).getTime() : 0;
        return {
          externalMessageId: `seg_${idx}`,
          speakerExternalId: null,
          speakerName: null,
          text: item.text,
          startAt: ts,
          endAt: ts,
          sequence: idx,
        };
      });

    return {
      segments,
      participants: [],
      diarizationAvailable: false,
    };
  }

  // Caso B: {messages, participants} — spec format (defensivo)
  if (typeof raw === 'object' && raw !== null && 'messages' in raw) {
    const typed = raw as SamuTranscriptionSpec;
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

  // Caso C: string / texto plano
  const rawText = typeof raw === 'string' ? raw : '';
  return { segments: [], participants: [], diarizationAvailable: false, rawText };
}
