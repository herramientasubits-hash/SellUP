# Limpieza de las pruebas de egarcia — 15-10-2026 (registro)

Segunda limpieza, después de la del 14-10 (ver `egarcia-cleanup-2026-10-14.md`). Las pruebas de las formas nuevas de búsqueda (competidores, proveedores y árbol de empresa), más una importación y unas búsquedas por criterios, se pasaron al banco gratis y se borraron de la plataforma para entregar SellUp limpio. Autorización explícita de la dueña en el chat del 15-10: «pasemos todo al banco gratuito y limpiemos métricas y todo lo demás».

## Qué se hizo

| Paso | Cómo | Resultado |
|---|---|---|
| Respaldo | `egarcia-cleanup-2026-10-15.mts --export` (sólo lectura) | 55 lotes, 334 empresas, 297 reservas, 333 Descartadas, 270 historiales, 17 trabajos de enriquecimiento, banco completo |
| Respaldo de lo que el script no cubre | consultas por el MCP | 492 relaciones (`agent1_company_relationships`), 6 ejecuciones `candidate_enrichment`, 675 registros de uso de Claude |
| Plan | `--plan` (sólo lectura) | 90 empresas para el banco; 73 quedaban fuera por no tener industria (59 son del árbol) |
| Depósito, borrado y limpieza | **SQL directo por el MCP, en una sola transacción** (rol `postgres`) | ver abajo |

El script se usó sólo para el respaldo y el plan. **No se ejecutó `--execute`**: la cuenta de servicio no puede borrar en `agent1_company_identity_claims` (la migración 140 sólo le da SELECT, INSERT y UPDATE), y además el plan del script no cubría el árbol. Por eso el depósito y el borrado se hicieron por SQL.

## Regla nueva: el árbol hereda la industria del grupo

Las empresas del modo «Árbol de empresa» no traen industria propia (el lote se llama «Árbol de empresa»). El banco entrega por país e industria, así que cada una entra con la industria de su grupo raíz:

| Grupo raíz | Industria |
|---|---|
| Nestlé, Unilever, Bimbo, Coca Cola | Consumo Masivo |
| Volkswagen Group, General Electric | Industria / Manufactura / Químicos / Automotor |
| Walmart Stores, Walmart, Cencosud | Retail |
| Royal Dutch Shell, TotalEnergies, Chevron | Gas / Petróleo / Energía / Minería / Medio Ambiente |
| Citigroup, HSBC Holdings | Seguros y Servicios Financieros |
| Monsanto | Agroindustria |

Para el resto, la industria sale de la propia empresa (catálogo 2.0.0 y nombres viejos traducidos), o si no, de la industria del lote. Quien no resolvía ninguna se quedó fuera del banco.

## SQL ejecutado en Producción (`lrdruowtadwbdulndlph`)

Selección: empresas `needs_review`, `duplicate_status` en `no_match` o `unchecked`, con dominio y con industria resuelta. Una por una pasaron por `agent1_bank_deposit` (vigencia 180 días, `ready` si había número de empleados, `to_complete` con `company_size` faltante si no; reclamos tomados de los reclamos activos de la empresa, o su dominio si no tenía).

```sql
begin;
-- alcance: lotes agent_1 / external_import de egarcia
-- liberar los reclamos de lo que va al banco
update agent1_company_identity_claims set released_at = now() where candidate_id in (select id from _bankc) and released_at is null;
-- depositar con agent1_bank_deposit(...)   -- ver «Resultado»
-- el guardia del banco no deja tocar filas finales: se borran las que apuntaban a estos lotes
delete from agent1_company_bank where status in ('assigned','expired','invalidated')
  and (source_batch_id in (select id from _scope) or assigned_batch_id in (select id from _scope) or assigned_candidate_id in (select id from _cands));
delete from agent1_company_identity_claims where batch_id in (select id from _scope) or candidate_id in (select id from _cands);
delete from provider_usage_logs where agent_key = 'agent1' and provider_key = 'anthropic';
delete from agent_runs where agent_key = 'candidate_enrichment';
delete from prospect_batches where id in (select id from _scope);  -- cascada: empresas, Descartadas, historial, trabajos y relaciones
commit;
```

## Se conservan a propósito

- **59 registros de uso de Apollo (56) y Tavily (3)**, con 26 y 6 créditos. El presupuesto de créditos del mes los lee (`effective-consumption-core.ts`: créditos de `provider_usage_logs.credits_used`). Borrarlos haría parecer que hay más créditos disponibles de los reales, y tocar el presupuesto está prohibido salvo autorización expresa y separada.
- Todo lo del Agente 2 (`agent_2a_contact_enrichment`), HubSpot y los datos de otros usuarios.

## Resultado (recontado el 15-10)

- 131 empresas nuevas al banco (5 ya estaban, 1 reclamada por otro). Banco activo: **1.750** (1.749 en los 20 países y 1 de Alemania, sin uso).
- Lotes, empresas, Descartadas, relaciones y reservas del Agente 1: **0**.
- Registro de uso del Agente 1: 59 filas (Apollo y Tavily).

## Cómo restaurar

Respaldo en `~/Documents/SellUp-data/cleanup-2026-10-15/`: `export/` (JSON por tabla), `plan/` (empresas y reglas del banco) y `export-extra/` (relaciones, ejecuciones y uso de Claude). Restaurar = reinsertar lotes → empresas → Descartadas, historial, trabajos y relaciones → reclamos → registro de uso. Antes, invalidar en el banco las 131 filas depositadas (`reasons` contiene `banked_from_test_cleanup_2026_10_15`) para no duplicar empresas.

## Correr el script

No volver a correr `--execute`: el alcance ya no existe y el script se detiene solo si el alcance vivo difiere del plan. `--export` y `--plan` sirven de molde para una limpieza futura (cambiar la carpeta de salida primero, para no pisar este respaldo).

Node 20 no trae `WebSocket` global y el cliente de Supabase falla al arrancar. Se cargó un stub inerte:

```js
// ws-stub.mjs
if (typeof globalThis.WebSocket === 'undefined') { globalThis.WebSocket = class { constructor() { throw new Error('realtime not used'); } }; }
```

`node --env-file=.env.local --import ./ws-stub.mjs --import tsx scripts/ops/egarcia-cleanup-2026-10-15.mts --export | --plan`
