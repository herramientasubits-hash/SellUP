# Limpieza de las pruebas de egarcia — 14-10-2026 (registro)

Antes de entregar SellUp a stakeholders, las búsquedas de prueba del equipo de producto (usuaria egarcia@ubits.co) se pasaron al banco gratis y se borraron de la plataforma. Autorización explícita de la dueña en el chat del 14-10, incluido el vínculo de 97 reservas de presupuesto (montos sin tocar) y el borrado de reservas «una empresa, un vendedor» por encima de la protección de la tabla.

## Qué se hizo

| Paso | Cómo | Filas |
|---|---|---|
| Respaldo completo (lotes, empresas, reservas, Descartadas, auditoría, jobs, banco, vínculos de uso y presupuesto) | `egarcia-cleanup-2026-10-14.mts --export` | ver `manifest.json` |
| Plan del banco (mismas funciones que la app) | `--plan` | 1.414 empresas |
| 1. Liberar reservas de las empresas que van al banco | `--execute` | 2.080 |
| 2. Depositar en `agent1_company_bank` (RPC `agent1_bank_deposit`, 180 días) | `--execute` | 1.410 depositadas · 3 ya estaban · 1 reclamada |
| 3. Borrar reservas viejas | **falló con `service_role`**: la migración 140 no le da DELETE en `agent1_company_identity_claims` | — |
| 3–7. Resto, en UNA transacción por el MCP (rol `postgres`) | SQL más abajo | — |

El paso 6 del script (`lusha_prospecting_request_fence`) NO se ejecutó a propósito: son registros de cobro de créditos y se conservan (`execute-state.json` se sembró con `{"done":[6]}`).

SQL ejecutado en Producción (`lrdruowtadwbdulndlph`):

```sql
begin;
create temp table _scope on commit drop as
  select b.id from prospect_batches b join internal_users u on u.id = coalesce(b.owner_id, b.created_by)
  where u.email = 'egarcia@ubits.co' and b.source in ('agent_1', 'external_import');
create temp table _cands on commit drop as select id from prospect_candidates where batch_id in (select id from _scope);
create temp table _rp on commit drop as select client_request_id from prospect_batches where id in (select id from _scope) and client_request_id is not null;
-- El guardia del banco no deja tocar filas finales (assigned/expired/invalidated): el SET NULL del FK fallaba.
delete from agent1_company_bank where status in ('assigned','expired','invalidated')
  and (source_batch_id in (select id from _scope) or assigned_batch_id in (select id from _scope) or assigned_candidate_id in (select id from _cands));
delete from agent1_company_identity_claims where batch_id in (select id from _scope) or candidate_id in (select id from _cands);
update wizard_budget_reservations set batch_id = null where batch_id in (select id from _scope);
delete from agent1_run_progress where client_request_id in (select client_request_id from _rp);
delete from prospect_batches where id in (select id from _scope);  -- cascada: empresas, Descartadas, auditoría, jobs
commit;
```

## Resultado (recontado el 14-10)

- Lotes del Agente 1 + importación: 271 → 11 (2 de brcastro, 9 pruebas de junio sin dueño). Empresas 2.222 → 26. Descartadas 3.531 → 13.
- Banco activo: 1.577 (CO 340, CL 187, EC 179, PE 170, MX 120, AR 88, ES 73, SV 63, BO 60…).
- Se conservan: `provider_usage_logs` (gasto real, sin vínculo al lote), 11 filas de `lusha_prospecting_request_fence`, las 9 cuentas convertidas (SellUp y HubSpot).

## Cómo restaurar

Todo lo borrado está en `~/Documents/SellUp-data/cleanup-2026-10-14/export/` (JSON por tabla + `manifest.json`). Restaurar = reinsertar en orden: lotes → empresas → Descartadas / auditoría / jobs → reservas → filas del banco; luego volver a poner `batch_id` en `wizard_budget_reservations` y `provider_usage_logs` desde los archivos `*.batch_links.json`. Antes, invalidar en el banco las 1.410 filas depositadas (sin `source_batch_id`, `banked_at` 14-10) para no duplicar empresas.

## Correr el script

Node 20 no tiene `WebSocket` global y el cliente de Supabase falla al arrancar; se cargó un stub inerte:

```js
// ws-stub.mjs
if (typeof globalThis.WebSocket === 'undefined') { globalThis.WebSocket = class { constructor() { throw new Error('realtime not used'); } }; }
```

`node --env-file=.env.local --import ./ws-stub.mjs --import tsx scripts/ops/egarcia-cleanup-2026-10-14.mts --export | --plan | --execute --confirm EGARCIA-CLEANUP-2026-10-14`

No volver a correr `--execute`: el alcance ya no existe y el script se detiene si el alcance vivo difiere del plan.
