# Limpieza de pruebas del Agente 2 — 15-10-2026 (registro)

Autorización de la dueña en el chat del 15-10: limpiar «solo lo tuyo (egarcia) y QA». Las búsquedas de brcastro (310) y crisramirez (18), y los 69 contactos (todos de brcastro, 63 ya en HubSpot), NO se tocaron.

## Qué se hizo (SQL por el MCP, una transacción, Producción `lrdruowtadwbdulndlph`)
Alcance: `contact_enrichment_runs` cuyo `triggered_by` es egarcia@ubits.co o carlos.ruiz.qa@ubits.co (24 búsquedas, 18 candidatos, 2 solicitudes, 7 teléfonos).

Se BORRARON: 22 búsquedas (sus candidatos caen en cascada: 13 candidatos, 3 teléfonos, 1 corrida de waterfall), 1 solicitud sin otras búsquedas, 1 fila de `phone_reveal_cache`.

Se CONSERVARON a propósito: 2 búsquedas de egarcia (`639fb7c8…` y `2c09e354…`) con sus 5 candidatos, porque 4 candidatos tienen reservas de créditos en `phone_reveal_credit_reservations` (agosto/julio; Apollo 8 y Lusha 5 confirmados). Esa tabla cae en cascada con el candidato y es parte del libro de créditos: tocar el presupuesto está prohibido salvo autorización expresa y separada.

```sql
begin;
create temp table _sc on commit drop as select r.id, r.request_id from contact_enrichment_runs r join internal_users u on u.id=r.triggered_by where u.email in ('egarcia@ubits.co','carlos.ruiz.qa@ubits.co');
create temp table _keep on commit drop as select distinct c.enrichment_run_id id from contact_enrichment_candidates c where c.id in (select candidate_id from phone_reveal_credit_reservations) and c.enrichment_run_id in (select id from _sc);
create temp table _del on commit drop as select id, request_id from _sc where id not in (select id from _keep);
create temp table _delreq on commit drop as select distinct d.request_id id from _del d where d.request_id is not null and not exists (select 1 from contact_enrichment_runs o where o.request_id=d.request_id and o.id not in (select id from _del));
create temp table _delc on commit drop as select id from contact_enrichment_candidates where enrichment_run_id in (select id from _del);
delete from phone_reveal_cache where source_candidate_id in (select id from _delc);
delete from contact_enrichment_runs where id in (select id from _del);   -- cascada: candidatos, teléfonos, waterfall
delete from contact_enrichment_requests where id in (select id from _delreq);
commit;
```

## Resultado
Búsquedas 352 → 330 · candidatos 176 → 163 · solicitudes 210 → 209 · teléfonos 67 → 64 · waterfall 69 → 68 · reservas de créditos 4 → 4 · contactos 69 → 69 · HubSpot: 0 escrituras.

## Cómo restaurar
Respaldo en `~/Documents/SellUp-data/cleanup-2026-10-15/agent2/` (JSON por tabla: búsquedas, candidatos, solicitudes, teléfonos, waterfall, reservas, caché). Reinsertar en orden: solicitudes → búsquedas → candidatos → teléfonos → waterfall → caché.
