# Samu IA Integration

## Overview

This document describes the administrative configuration integration for Samu IA in SellUp. The current phase establishes the connection infrastructure (API Key storage, health check, audit trail, webhook receiver) to prepare for a future phase where meetings, transcriptions, and post-meeting insights will be imported and processed.

**Phase 1 scope (implemented):** Administrative connection, API Key in Vault, health check, system-status card.  
**Phase 1.1 scope (implemented):** Updated client types based on real API validation, webhook receiver endpoint.  
**Phase 2 scope (future):** Meeting import, transcription processing, post-meeting agent, HubSpot writes.

---

## Architecture

### Storage

API Keys are stored exclusively in **Supabase Vault** under the secret name `sellup_samu_api_key`. The key is never returned to the frontend, never logged, and never stored in plain text in any database column.

Connection state is tracked in the shared `external_integration_connections` table under `integration_key = 'samu_ia'`.

Inbound webhook payloads are stored in `integration_webhook_events` (inspection-only, no processing).

### Files

| File | Purpose |
|------|---------|
| `src/server/services/samu-connection.ts` | Vault operations + health check against `GET /api/users` |
| `src/server/integrations/samu-client.ts` | Typed API client + `normalizeSamuTranscript` helper |
| `src/modules/integrations/actions.ts` | Server Actions: connect, update, test, disconnect, get |
| `src/modules/integrations/types.ts` | `SamuMetadata` type |
| `src/modules/system-status/actions.ts` | `SamuHealth` included in `getConfigurationHealthDetails` |
| `src/modules/system-status/types.ts` | `SamuHealth` type in `ConfigurationHealthDetails` |
| `src/app/(sellup)/settings/integrations/samu/page.tsx` | Detail page (Server Component) |
| `src/app/(sellup)/settings/integrations/samu/samu-actions-client.tsx` | Modals + action buttons (Client Component) |
| `src/app/api/integrations/samu/webhook/route.ts` | POST webhook receiver |
| `supabase/migrations/034_samu_ia_integration.sql` | Activates `samu_ia` in `external_integrations` |
| `supabase/migrations/035_webhook_events.sql` | Creates `integration_webhook_events` table |

---

## API Details — Validated 2026-05-20

**Base URL:** `https://api.samu.ai`  
**Auth header:** `apiKey: <value>` (not `Authorization: Bearer`)  
**Health check endpoint:** `GET /api/users` — returns list of users in the environment

### Validated endpoints

| Endpoint | Notes |
|----------|-------|
| `GET /api/users` | Returns `SamuUser[]`. Used for health check. |
| `GET /api/meetings?dateFrom=...&dateTo=...` | Returns `SamuMeeting[]`. Ranges ≤ 2h are reliable; ≥ 7d produce 504. No documented pagination. |
| `GET /api/meeting/{id}` | Returns single `SamuMeeting` with `extractor` (19+ sub-fields), `score`, `stakeholders`, `deal`, `callType`. |
| `GET /api/meeting/{id}/transcription` | Returns `Array<{text, date}>`. See Transcription section. |

### Connection test logic

| HTTP Status | Outcome |
|-------------|---------|
| 200 | `connected` — `user_count` stored in metadata |
| 401 | `error` — `INVALID_API_KEY` |
| 403 | `error` — `PERMISSION_DENIED` |
| 429 | `connected` — rate limit proves key is valid |
| Other | `error` — `API_ERROR` |
| Network failure | `error` — `CONNECTION_ERROR` |

### Known API caveats

- `callType` is an **object** `{ _id, name }`, not a string as declared in the OpenAPI spec.
- `duration` is a **float in minutes** (e.g. `60.37`), not seconds.
- `stakeholders` is an array of **external participant emails**.
- Ranges ≥ 7 days on `GET /api/meetings` consistently return 504. Use ≤ 2h incremental ranges for reliable data retrieval.

---

## Extractor Fields (Validated 2026-05-20)

The `extractor` object inside a `SamuMeeting` contains IA-generated insights. All 19 confirmed fields are typed in `SamuExtractor`:

| Field | Type | Description |
|-------|------|-------------|
| `samu_summary` | `string` | Short meeting summary |
| `samu_longSummary` | `string` | Detailed meeting summary |
| `samu_actionItems` | `string[]` | Action items / commitments |
| `samu_objections` | `string[]` | Detected objections |
| `samu_nextStepDate` | `string` | Suggested next step date |
| `samu_probKey` | `number` | Probability score (numeric) |
| `samu_probDesc` | `string` | Probability description |
| `samu_competence` | `string` | Evaluated competencies |
| `punto_de_dolor` | `string` | Verbatim customer pain point quote |
| `voice_of_customer_verbal` | `string` | Verbatim customer quotes |
| `señales_de_churn_verbal` | `string` | Detected churn signals |
| `categoría_riesgo_de_churn` | `string` | Churn risk category |
| `tipos_de_reunión` | `string` | Meeting type |
| `modalidad_de_reunión` | `string` | Modality (Virtual / Presencial) |
| `categoría_de_conversación` | `string` | Conversation category |

**Phase 2 strategy:** `samu_summary`, `samu_longSummary`, `samu_actionItems`, and `punto_de_dolor` are the primary source for the post-meeting agent. Raw transcript `[{text,date}]` serves as chronological backup without speaker attribution.

---

## Transcription Format (Validated 2026-05-20)

### Critical finding

The real API returns a **flat array**, not the diarized JSON object described in the OpenAPI spec (v1.0.1):

```json
[
  { "text": "Buenos días...", "date": "2026-05-20T21:32:03.949Z" },
  { "text": "Hola, gracias por...", "date": "2026-05-20T21:32:18.211Z" }
]
```

- **No `participantId`** — diarization ("who said what") is not available in the raw transcript endpoint.
- **No `messages` / `participants` envelope** — the spec object format was not observed.
- `date` is an ISO datetime string for each segment.

### normalizeSamuTranscript()

`samu-client.ts` handles three cases defensively:

| Case | Input | Behavior |
|------|-------|---------|
| A — Real format | `Array<{text, date}>` | `speakerName: null`, `diarizationAvailable: false`, `startAt` = epoch ms from ISO date |
| B — Spec fallback | `{ messages, participants }` | Speaker resolution, `diarizationAvailable: true` |
| C — Plain text | `string` | `rawText` stored, `segments: []`, `diarizationAvailable: false` |

---

## Webhook

### Endpoint

```
POST https://sell-up-sage.vercel.app/api/integrations/samu/webhook
```

### Configuration in Samu IA dashboard

1. Navigate to Samu IA admin → Integraciones → Webhook
2. Set URL to the endpoint above
3. Set `x-sellup-webhook-secret` header to the value of `SAMU_WEBHOOK_SECRET` env var (if configured)

### Secret validation

If the environment variable `SAMU_WEBHOOK_SECRET` is set, the endpoint requires that the inbound request includes the matching header:

```
x-sellup-webhook-secret: <secret>
```

Requests missing or with incorrect header return `401`. If `SAMU_WEBHOOK_SECRET` is not set, the endpoint accepts all requests (logged as no-secret mode).

### Stored data

Each call stores a row in `integration_webhook_events`:

| Column | Value |
|--------|-------|
| `integration_key` | `samu_ia` |
| `event_source` | `samu` |
| `event_type` | Value of `x-samu-event` header (if present) |
| `headers` | Subset of non-sensitive headers |
| `payload` | Parsed JSON body (if `application/json`) |
| `raw_body` | Raw body string (max 50 KB) |
| `processed_status` | `received` (no further processing in Phase 1.1) |

### Current limitation

The webhook receiver is **inspection-only**. No meeting import, no IA processing, no HubSpot writes. Phase 2 will add queue-based processing from this table.

---

## Audit Events

All events are written to `integration_audit` with `integration_key = 'samu_ia'`.

| Event | Trigger |
|-------|---------|
| `samu_api_key_stored` | `connectSamu()` — first time API Key is saved |
| `samu_api_key_updated` | `updateSamuApiKey()` — key replaced |
| `samu_connection_tested` | `testSamuConnectionAction()` — test initiated |
| `samu_connection_succeeded` | Connection test returned 200/429 |
| `samu_connection_failed` | Connection test returned error |
| `samu_disconnected` | `disconnectSamu()` — key deleted from Vault |

---

## Security Constraints

- API Key is **never** returned to the frontend from any Server Action.
- API Key is **never** logged at any severity level.
- API Key is stored only in Supabase Vault; the `external_integration_connections` row holds no credential data.
- All mutating actions require `isAdmin` check via `getAdminInternalUserId()`.
- Webhook secret is read from `SAMU_WEBHOOK_SECRET` environment variable only — never from DB, never exposed to frontend.

---

## UI

**Route:** `/settings/integrations/samu` (admin only)

The page shows:
1. Integration status card (credential stored, connection status, last tested, last error)
2. Account info card (user count from metadata once connected)
3. Actions panel (connect / test / update API Key / disconnect)
4. Scope card (what is and isn't available in Phase 1)
5. Security note (Vault storage explanation)

The integration also appears in:
- `/settings/integrations` grid card (status badge, link to detail page)
- `/settings/system-status` connections grid (Samu IA card with live health data)

---

## Migrations

### 034 — `supabase/migrations/034_samu_ia_integration.sql`

Sets `is_available = true` on the pre-seeded `samu_ia` row in `external_integrations` and ensures a `not_tested` connection row exists.

### 035 — `supabase/migrations/035_webhook_events.sql`

Creates `integration_webhook_events` table with RLS:
- `service_role` INSERT only (webhook handler runs with service role)
- Admin SELECT only (via `profiles.role = 'admin'`)

Apply with:
```bash
supabase db push
```
