# Teléfonos ya guardados en Apollo (APOLLO-SAVED-CONTACT-PHONES-1)

**Fecha:** 2026-10-21 · **Track:** AGENT2A · **Estado:** `--plan` probado por la dueña (30 importables, 35 números). `--execute` construido; requiere la migración **155** aplicada en Prod (NO aplicada) y autorización explícita para escribir.

## Por qué

- Soporte humano de Apollo (21-10): un teléfono que el equipo ya reveló **y guardó como Contact** en Apollo no se vuelve a cobrar. `POST /api/v1/contacts/search` busca en esos contactos guardados y la doc de Apollo lo marca con **0 créditos**.
- Prueba sin escritura del 21-10 (la corrió la dueña): de 116 personas de Apollo sin teléfono en SellUp (100 candidatos + 16 contactos oficiales), **33 ya tienen teléfono guardado en Apollo** (20 candidatos, 13 contactos oficiales). 151 llamadas, 0 errores, Apollo no reportó créditos.

## Qué hace `--plan`

1. Lee de SellUp (sólo lectura): candidatos `source='apollo'` sin teléfono en `pending_review`/`approved`, y contactos oficiales `source='apollo'` sin `phone` ni `mobile_phone`, no archivados.
2. Por persona, busca en los contactos guardados de Apollo: primero por correo, después por nombre.
3. Decide con el núcleo puro `src/modules/contact-enrichment/apollo-saved-contact-phone-import-core.ts`:
   - **identidad**: sólo person_id de Apollo, LinkedIn o correo, **nunca nombre**; person_id distinto ⇒ conflicto; dos contactos guardados distintos ⇒ ambiguo;
   - **no contactar**: `evaluatePhoneRevealSuppression` + `readPhoneRevealSuppression` (las mismas del reveal). `blocked_suppressed`, `check_unavailable` y `not_evaluable` descartan;
   - **«no llamar» de Apollo**: cualquier `dnc_status` que no sea `not_on_dnc`/`clear` descarta ese número;
   - **tombstones DSAR**: un número borrado antes no se re-escribe.
4. Escribe un informe local `--out` con la decisión por persona. **Nunca** lleva números completos (sólo `••••NN`) ni la API key.

```bash
/usr/local/bin/node --env-file=/Users/ub-col-pro-lf4/Documents/SellUp/.env.local --import tsx \
  scripts/ops/apollo-saved-contact-phones.mts --plan --out /tmp/apollo-saved-contact-phones-plan.json
```

## Escritura (`--execute`) — migración 155

```bash
/usr/local/bin/node --env-file=/Users/ub-col-pro-lf4/Documents/SellUp/.env.local --import tsx \
  scripts/ops/apollo-saved-contact-phones.mts --execute --confirm APOLLO-SAVED-CONTACT-PHONES-1 \
  --out /tmp/apollo-saved-contact-phones-execute.json
```

- Recalcula el plan con datos frescos y escribe objetivo por objetivo; se detiene en el primer resultado inesperado. Re-ejecutar es idempotente (`target_has_phone`).
- `supabase/migrations/155_import_apollo_saved_contact_phones.sql` agrega dos funciones (service_role, SECURITY INVOKER): `import_candidate_apollo_saved_phones` e `import_contact_apollo_saved_phones`. Bloquean la fila, re-chequean la supresión de la persona, respetan tombstones, **nunca pisan** un teléfono (ni `mobile_phone` en contactos) y no escriben `phone_reveal_*`, usage logs, reservas, presupuesto ni HubSpot.
- Base de tratamiento: `legitimate_interest_b2b` (decisión de la dueña, 21-10), sólo donde está vacía.

### Por qué `(apollo, reveal)` y no un origen nuevo

Las funciones de borrado DSAR de las migraciones 112, 115, 116, 117 y 128 traducen `(provider, acquisition_mode)` al `phone_source` heredado con un CASE escrito a mano, y sólo `apollo_reveal`, `apollo_cache` y `lusha_reveal` se borran. Un modo nuevo caería en `unknown` y `(apollo, search)` en `apollo_search`: **los dos sobreviven** a una DSAR de Apollo. Por eso los números se registran como `(apollo, reveal)` —son números revelados en Apollo por el equipo— y el origen exacto queda en la procedencia: `source_event_key = 'apollo_saved_contact:<id del contacto en Apollo>'` (la 155 lo exige) y `enrichment_metadata.phone.acquired_via = 'apollo_saved_contact'` en candidatos. El test de Postgres real comprueba que la DSAR de la 115 borra el número importado.

## Lo que esta rama NO hace

No aplica la 155 en Prod, no escribe en Prod, no toca flags, créditos ni HubSpot.
