/**
 * Robust JSON Extractor — Hotfix 16AB.23.9
 *
 * Four strategies for extracting JSON from Anthropic responses that may embed
 * structured output in various formats:
 *   1. Direct JSON.parse (plain JSON string)
 *   2. Markdown code fence (```json ... ``` or ``` ... ```)
 *   3. XML tags (<json_output>...</json_output>)
 *   4. Balanced bracket scanner (first well-formed object/array in arbitrary text)
 *
 * Strategy 4 respects strings and escape sequences; it does NOT use a greedy
 * regex from first { to last }.
 *
 * Truncation detection:
 *   - stop_reason === 'max_tokens' signals model output was cut at token limit
 *   - looksLikeIncompleteJson heuristic catches scanner-level incomplete JSON
 *
 * Nothing in this file calls external APIs or writes to disk.
 */

export type JsonExtractionStrategy =
  | 'direct'
  | 'code_fence'
  | 'xml_tag'
  | 'balanced_scanner';

export type JsonExtractionResult =
  | { success: true; data: unknown; strategy: JsonExtractionStrategy; truncated: false }
  | { success: false; error: 'empty_text' | 'no_json_candidate' | 'truncated_output'; strategy: null; truncated: boolean };

// ─── Truncation helpers ───────────────────────────────────────────────────────

/** True when stop_reason indicates the model was cut at the token limit. */
export function isTruncatedByTokenLimit(stopReason: string | null | undefined): boolean {
  return stopReason === 'max_tokens';
}

/**
 * Heuristic: text looks like an incomplete JSON object/array.
 * True when the text ends in a character incompatible with a closed JSON value.
 */
export function looksLikeIncompleteJson(text: string): boolean {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return false;
  const last = trimmed[trimmed.length - 1];
  // Valid JSON closings: } ] " digits true/false/null (e l e)
  return last !== '}' && last !== ']' && last !== '"' &&
         !/[0-9eE]/.test(last) && last !== 'e' && last !== 'l';
}

// ─── Strategy 1: direct JSON.parse ───────────────────────────────────────────

function tryDirect(text: string): unknown | null {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

// ─── Strategy 2: markdown code fence ─────────────────────────────────────────

function tryCodeFence(text: string): unknown | null {
  // Match ```json\n...\n``` or ```\n...\n```
  const m = text.match(/```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```/);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

// ─── Strategy 3: XML tag ──────────────────────────────────────────────────────

function tryXmlTag(text: string): unknown | null {
  const m = text.match(/<json_output>([\s\S]*?)<\/json_output>/);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

// ─── Strategy 4: balanced bracket scanner ────────────────────────────────────

/**
 * Finds the first well-formed JSON object ({...}) or array ([...]) in the text.
 * Correctly handles:
 *   - Quoted strings (respects \" escape sequences)
 *   - Nested objects and arrays
 *   - Any leading/trailing text around the JSON value
 *
 * Does NOT use a greedy regex — respects string boundaries so inner braces
 * inside string values are not counted as object boundaries.
 */
function tryBalancedScanner(text: string): unknown | null {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;

    const closeChar = ch === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < text.length; j++) {
      const c = text[j];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (inString) {
        if (c === '\\') { escaped = true; continue; }
        if (c === '"') inString = false;
        continue;
      }

      if (c === '"') { inString = true; continue; }
      if (c === ch) { depth++; }
      else if (c === closeChar) {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(i, j + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            // This start position did not yield valid JSON — try next opening
            break;
          }
        }
      }
    }
  }
  return null;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Attempt all four extraction strategies in order.
 * Returns the first successful extraction, or a typed failure descriptor.
 *
 * @param text - The model's text output to search for JSON
 * @param stopReason - Anthropic stop_reason for truncation detection
 */
export function extractJsonRobust(
  text: string,
  stopReason?: string | null
): JsonExtractionResult {
  if (!text || text.trim().length === 0) {
    return { success: false, error: 'empty_text', strategy: null, truncated: false };
  }

  // Strategy 1
  const direct = tryDirect(text);
  if (direct !== null) {
    return { success: true, data: direct, strategy: 'direct', truncated: false };
  }

  // Strategy 2
  const fence = tryCodeFence(text);
  if (fence !== null) {
    return { success: true, data: fence, strategy: 'code_fence', truncated: false };
  }

  // Strategy 3
  const xml = tryXmlTag(text);
  if (xml !== null) {
    return { success: true, data: xml, strategy: 'xml_tag', truncated: false };
  }

  // Strategy 4
  const scanned = tryBalancedScanner(text);
  if (scanned !== null) {
    return { success: true, data: scanned, strategy: 'balanced_scanner', truncated: false };
  }

  const truncated = isTruncatedByTokenLimit(stopReason) || looksLikeIncompleteJson(text);
  return {
    success: false,
    error: truncated ? 'truncated_output' : 'no_json_candidate',
    strategy: null,
    truncated,
  };
}

// ─── Diagnostic helpers ───────────────────────────────────────────────────────

/**
 * Count the number of top-level JSON object/array candidates in the text.
 * Used for diagnostics only — does not parse them.
 */
export function countJsonCandidates(text: string): number {
  let count = 0;
  let inString = false;
  let escaped = false;
  let depth = 0;

  for (const c of text) {
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') {
      if (depth === 0) count++;
      depth++;
    } else if (c === '}' || c === ']') {
      depth = Math.max(0, depth - 1);
    }
  }
  return count;
}
