/**
 * Benchmark Providers — Shared utilities (Hito 16AB.23)
 *
 * Normalización de candidatos raw de respuestas AI hacia BenchmarkCandidate.
 * Sin llamadas externas. Sin efectos secundarios.
 */

import type { BenchmarkCandidate } from '../types';

function normalizeConfidence(raw: unknown): 'Alta' | 'Media' | 'Baja' {
  const val = String(raw ?? '').toLowerCase().trim();
  if (val.includes('alta') || val === 'high') return 'Alta';
  if (val.includes('baja') || val === 'low') return 'Baja';
  return 'Media';
}

function cleanUrl(raw: unknown): string | null {
  if (!raw || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  // Reject placeholder text
  const PLACEHOLDERS = [
    'sitio oficial', 'linkedin', 'página corporativa', 'website',
    'n/a', 'na', 'no disponible', 'desconocido', 'pendiente',
  ];
  if (PLACEHOLDERS.some((p) => s.toLowerCase() === p)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : null;
  } catch {
    // Try adding https:// prefix
    if (!s.startsWith('http')) {
      try {
        new URL(`https://${s}`);
        return `https://${s}`;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function cleanText(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

/**
 * Normalizes a raw AI response candidate to the official BenchmarkCandidate contract.
 * Never invents data — replaces invalid/missing values with null.
 */
export function normalizeBenchmarkCandidate(raw: unknown): BenchmarkCandidate {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  return {
    name: cleanText(r['name'] ?? r['empresa'] ?? r['company']) ?? 'Desconocida',
    country: cleanText(r['country'] ?? r['país'] ?? r['pais']) ?? 'Colombia',
    sector: cleanText(r['sector'] ?? r['industry'] ?? r['industria']) ?? 'Tecnología',
    website: cleanUrl(r['website'] ?? r['sitio_web'] ?? r['sitio web'] ?? r['url']),
    linkedin: cleanUrl(r['linkedin'] ?? r['linkedin_url']),
    city: cleanText(r['city'] ?? r['ciudad']),
    estimated_size: cleanText(r['estimated_size'] ?? r['tamaño_estimado'] ?? r['tamaño estimado'] ?? r['employees']),
    description: cleanText(r['description'] ?? r['descripcion'] ?? r['descripción']),
    evidence_url: cleanUrl(r['evidence_url'] ?? r['url_evidencia'] ?? r['URL evidencia principal']),
    evidence_source: cleanText(r['evidence_source'] ?? r['fuente'] ?? r['Fuente / evidencia']),
    confidence: normalizeConfidence(r['confidence'] ?? r['confianza']),
    notes: cleanText(r['notes'] ?? r['notas']),
  };
}
