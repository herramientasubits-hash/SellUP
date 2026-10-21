# Teléfonos ya guardados en Apollo (APOLLO-SAVED-CONTACT-PHONES-1)

**Fecha:** 2026-10-21 · **Track:** AGENT2A · **Estado:** sólo ensayo (`--plan`). La escritura NO existe.

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

## Diseño propuesto para escribir (NO implementado; requiere aprobación)

Ningún camino de escritura existente sirve tal cual:

- `persist_candidate_apollo_phone_reveal_result` (110/113/120) exige un reveal en vuelo y deja el candidato como «revelado con costo».
- `append_candidate_search_more_phones` (122) rotula `search_more_reveal` y es de Lusha.
- Ninguna función escribe teléfonos en un contacto oficial sin candidato aprobado detrás.
- **Privacidad:** el par `(apollo, search)` → `apollo_search` **sobrevive** al borrado por DSAR (`official-contact-phone-suppression-core.ts`). Reusarlo dejaría números imborrables.

Propuesta (una migración, número a fijar contra `origin/main` y PRs abiertos en el turno de integración):

1. Vocabulario: `acquisition_mode` += `saved_contact` (candidatos y contactos); `contacts.phone_source` += `apollo_saved_contact`. En TS: `deriveLegacyPhoneSource('apollo','saved_contact') = 'apollo_saved_contact'`, agregarlo a `SUPPRESSIBLE_CONTACT_PHONE_SOURCES` y a la etiqueta del drawer.
2. RPC de candidato: bloqueo de fila, re-chequeo `phone_reveal_candidate_suppression_exists`, salta tombstones, inserta colección + procedencia (`provider='apollo'`, `acquisition_mode='saved_contact'`, `source_event_key='apollo_saved_contact:<id contacto Apollo>'`, idempotente), fija `phone` sólo si sigue vacío. **No** toca `phone_reveal_*` (no hubo reveal) ni usage logs, reservas o presupuesto. Si el candidato está aprobado con contacto, proyecta con la 128.
3. RPC de contacto oficial: bloqueo, `provider_suppression_exists('apollo', person_id)`, tombstones de `contact_phones`, inserta `contact_phones` + `contact_phone_sources`, escalar sólo si vacío con `phone_source='apollo_saved_contact'`.
4. `--execute --confirm APOLLO-SAVED-CONTACT-PHONES-1`: vuelve a calcular el plan en el momento (lectura fresca), escribe objetivo por objetivo, se detiene en el primer error.

Decisión pendiente de la dueña: **base de tratamiento** (`phone_processing_basis`) que se registra para estos números.

## Lo que este PR NO hace

0 escrituras en Prod, 0 migraciones, 0 flags, 0 créditos, 0 HubSpot.
