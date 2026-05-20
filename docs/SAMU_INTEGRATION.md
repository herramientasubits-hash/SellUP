# Samu IA Integration

## Overview

This document describes the administrative configuration integration for Samu IA in SellUp. The current phase establishes the connection infrastructure (API Key storage, health check, audit trail) to prepare for a future phase where meetings, transcriptions, and post-meeting insights will be imported and processed.

**Phase 1 scope (implemented):** Administrative connection only.  
**Phase 2 scope (future):** Meeting import, transcription processing, diarized speaker resolution.

---

## Architecture

### Storage

API Keys are stored exclusively in **Supabase Vault** under the secret name `sellup_samu_api_key`. The key is never returned to the frontend, never logged, and never stored in plain text in any database column.

Connection state is tracked in the shared `external_integration_connections` table under `integration_key = 'samu_ia'`.

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
| `supabase/migrations/034_samu_ia_integration.sql` | Activates `samu_ia` in `external_integrations` |

---

## API Details

**Base URL:** `https://api.samu.ai`  
**Auth header:** `apiKey: <value>` (not Bearer)  
**Health check endpoint:** `GET /api/users` — returns list of users in the environment

### Connection test logic

| HTTP Status | Outcome |
|-------------|---------|
| 200 | `connected` — `user_count` stored in metadata |
| 401 | `error` — `INVALID_API_KEY` |
| 403 | `error` — `PERMISSION_DENIED` |
| 429 | `connected` — rate limit proves key is valid |
| Other | `error` — `API_ERROR` |
| Network failure | `error` — `CONNECTION_ERROR` |

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

---

## Transcription Support (Future Phase)

Samu IA provides diarized transcriptions via `GET /api/meeting/{id}/transcription`.

### Diarization structure

```json
{
  "participants": {
    "p1": "Ana García",
    "p2": "Carlos Méndez"
  },
  "messages": [
    { "participantId": "p1", "text": "Buenos días...", "timestamp": 0 }
  ]
}
```

The `normalizeSamuTranscript()` function in `samu-client.ts` handles two cases:

- **Case A — JSON diarized:** Parses `participants` map and `messages` array, resolves `speakerName` from `participantId`, sets `diarizationAvailable: true`.
- **Case B — Plain text fallback:** Returns `rawText` with empty `segments`, sets `diarizationAvailable: false`.

### Known API caveats

- The `extractor` field in Meeting objects is untyped `object` in the spec. Validate with a real API Key before building import logic.
- `/api/meeting/{id}/transcription` is declared as `text/plain` in the OpenAPI spec but the schema is JSON. `samuFetch()` handles this defensively by attempting `JSON.parse` on text responses.

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

## Migration

`supabase/migrations/034_samu_ia_integration.sql`

Sets `is_available = true` on the pre-seeded `samu_ia` row in `external_integrations` (originally seeded in migration 015 as unavailable). Also ensures a `not_tested` connection row exists via idempotent INSERT.

```sql
UPDATE external_integrations SET is_available = true WHERE integration_key = 'samu_ia';
```

Apply with:
```bash
supabase db push
```
