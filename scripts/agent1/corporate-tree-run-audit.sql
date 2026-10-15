-- ============================================================
-- Agente 1 · Árbol de una empresa — revisor de corridas (SÓLO LECTURA)
-- ============================================================
--
-- Una consulta, todas las corridas del árbol desde `since`, todos los problemas
-- a la vez: así se arreglan juntos en un PR en lugar de uno por corrida.
--
-- Uso: cambiar `since` (y, si se quiere, `only_batch`) y correrla en Producción
-- por el MCP de Supabase. No escribe nada.
--
-- Columnas: batch · root · severity (error | warn | info) · check · item · detail
--   error = algo salió mal (gasto de más, empresa repetida en el lote, corrida trabada, sin web de partida)
--   warn  = sospechoso, mirar a mano
--   info  = resumen de la corrida (costo, Apollo, escritas)
-- ============================================================

WITH params AS (
  SELECT
    timestamptz '2026-10-15 16:00:00+00' AS since,
    NULL::uuid AS only_batch
),
batches AS (
  SELECT b.id, b.status, b.created_at, b.updated_at, b.metadata -> 'corporate_tree' AS t
  FROM prospect_batches b, params p
  WHERE b.metadata ->> 'search_mode' = 'corporate_tree'
    AND b.created_at >= p.since
    AND (p.only_batch IS NULL OR b.id = p.only_batch)
),
-- Nombre base para comparar: minúsculas, sin tildes ni signos, sin forma societaria,
-- conectores ni nombres de país (heurística de revisión, no la del código).
cand AS (
  SELECT c.*, trim(regexp_replace(regexp_replace(
           ' ' || regexp_replace(lower(translate(c.name, 'áéíóúüñÁÉÍÓÚÜÑ.,', 'aeiouunaeiouun  ')), '[^a-z0-9 ]', ' ', 'g') || ' ',
           ' (s|a|sa|sas|saa|sac|sau|sl|slu|srl|de|del|do|da|cv|rl|ltda|limitada|inc|llc|corp|sociedad|anonima|bic|cia|y|argentina|bolivia|brasil|brazil|chile|colombia|costa|rica|dominicana|ecuador|espana|guatemala|honduras|mexico|nicaragua|panama|paraguay|peru|salvador|el|uruguay|venezuela|usa|us)(?= )', ' ', 'g'),
           '\s+', ' ', 'g')) AS core
  FROM prospect_candidates c
),
live AS (
  SELECT * FROM cand WHERE status IN ('generated', 'normalized', 'needs_review', 'approved')
),
usage AS (
  SELECT u.batch_id,
         round(sum(u.estimated_cost_usd)::numeric, 3) AS usd,
         sum(u.credits_used) FILTER (WHERE u.provider_key = 'apollo') AS apollo_credits,
         count(*) FILTER (WHERE u.operation_key = 'company_domain_search') AS domain_searches,
         count(*) FILTER (WHERE u.status <> 'success') AS failed_calls
  FROM provider_usage_logs u JOIN batches b ON b.id = u.batch_id
  GROUP BY u.batch_id
),
disp AS (
  SELECT d.*, nullif(substring(d.provider_identifier FROM '^tax:(.+)$'), '') AS tax_id
  FROM prospect_discarded_dispositions d JOIN batches b ON b.id = d.batch_id
),
rels AS (
  SELECT r.* FROM agent1_company_relationships r JOIN batches b ON b.id = r.batch_id
),
findings AS (
  -- ── Resumen ───────────────────────────────────────────────
  SELECT b.id, 'info' AS severity, 'summary' AS chk, NULL::text AS item,
         format('estado=%s · filas=%s · escritas=%s · sin web=%s · Apollo pedido=%s filiales=%s agregadas=%s · US$%s · créditos Apollo=%s',
                b.status, b.t ->> 'rows', b.t ->> 'written', b.t ->> 'without_website',
                b.t -> 'apollo' ->> 'asked', b.t -> 'apollo' ->> 'subsidiaries', b.t -> 'apollo' ->> 'added',
                coalesce(u.usd, 0), coalesce(u.apollo_credits, 0)) AS detail
  FROM batches b LEFT JOIN usage u ON u.batch_id = b.id

  -- ── La empresa de partida sin web ⇒ Apollo no se consulta ─
  UNION ALL
  SELECT b.id, 'error', 'root_without_domain', b.t ->> 'root_name', 'La empresa de partida quedó sin web: Apollo no se consultó.'
  FROM batches b WHERE coalesce(b.t ->> 'root_domain', '') = ''

  UNION ALL
  SELECT b.id, 'warn', 'apollo_not_asked', b.t ->> 'root_domain', 'Había web de la empresa de partida pero Apollo no se consultó (¿bandera, cupo o tiempo?).'
  FROM batches b WHERE coalesce(b.t ->> 'root_domain', '') <> '' AND coalesce((b.t -> 'apollo' ->> 'asked')::boolean, false) = false

  -- ── La web de partida no lleva su nombre (¿es la de su matriz?) ─
  -- Prod 15-10, Monsanto: quedó bayer.com y Apollo enriqueció a Bayer.
  UNION ALL
  SELECT b.id, 'warn', 'root_domain_other_name', b.t ->> 'root_domain',
         format('La web de «%s» no lleva su nombre: ¿es la de su matriz?', b.t ->> 'root_name')
  FROM batches b
  WHERE coalesce(b.t ->> 'root_domain', '') <> ''
    AND NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(translate(b.t ->> 'root_name', 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')), '[^a-z0-9]+') tok
      WHERE length(tok) >= 4 AND tok NOT IN ('grupo', 'group', 'holding', 'holdings', 'corporacion', 'corporation')
        AND position(tok IN replace(b.t ->> 'root_domain', '-', '')) > 0
    )

  -- ── Errores registrados por la corrida ────────────────────
  UNION ALL
  SELECT b.id, 'error', 'write_error', e.value #>> '{}', 'Error al escribir.'
  FROM batches b, jsonb_array_elements(coalesce(b.t -> 'write_errors', '[]')) e
  UNION ALL
  SELECT b.id, 'error', 'claude_error', e.value #>> '{}', 'Error de Claude en una rama.'
  FROM batches b, jsonb_array_elements(coalesce(b.t -> 'claude' -> 'errors', '[]')) e
  UNION ALL
  SELECT u.batch_id, 'warn', 'provider_call_failed', NULL, format('%s llamadas a proveedores no terminaron en «success».', u.failed_calls)
  FROM usage u WHERE u.failed_calls > 0

  -- ── Corrida trabada ───────────────────────────────────────
  UNION ALL
  SELECT b.id, 'error', 'stuck', b.status, 'Lleva más de 10 minutos sin cerrar.'
  FROM batches b WHERE b.status NOT IN ('ready_for_review', 'completed', 'failed') AND b.created_at < now() - interval '10 minutes'

  -- ── Gasto de más: buscó la web de una con número fiscal ya conocido ─
  UNION ALL
  SELECT d.batch_id, 'error', 'paid_search_known_tax', d.name,
         format('Buscó su web (pagado) aunque «%s» ya tiene ese número fiscal (%s).', l.name, d.tax_id)
  FROM disp d JOIN live l ON l.tax_identifier = d.tax_id AND l.batch_id <> d.batch_id
  WHERE d.tax_id IS NOT NULL
    AND d.evidence -> 'claude_domain_search' ->> 'searched_at' IS NOT NULL
    AND coalesce(d.evidence -> 'claude_domain_search' ->> 'skipped', '') = ''

  -- ── Repetida: entró a revisión y ya había otra viva parecida en su país ─
  UNION ALL
  SELECT c.batch_id, 'warn', 'possible_duplicate_other_batch', c.name,
         format('Ya está «%s» (%s, número fiscal %s, otra búsqueda). Este: número fiscal %s, web %s.',
                o.name, o.status, coalesce(o.tax_identifier, '—'), coalesce(c.tax_identifier, '—'), coalesce(c.domain, '—'))
  FROM live c JOIN batches b ON b.id = c.batch_id
  JOIN live o ON o.country_code = c.country_code AND o.core = c.core AND o.batch_id <> c.batch_id AND o.created_at < c.created_at
  WHERE length(c.core) >= 4

  -- ── Repetida dentro del mismo lote ────────────────────────
  UNION ALL
  SELECT c.batch_id, 'error', 'duplicate_in_batch', c.name, format('Misma empresa dos veces en el lote: «%s».', o.name)
  FROM cand c JOIN batches b ON b.id = c.batch_id
  JOIN cand o ON o.batch_id = c.batch_id AND o.id > c.id AND o.country_code = c.country_code
             AND (o.core = c.core OR (o.domain IS NOT NULL AND o.domain = c.domain))
  WHERE length(c.core) >= 4 AND c.status <> 'duplicate' AND o.status <> 'duplicate'

  -- ── Sin rastro: tiene web propia y no quedó en ninguna parte ─
  -- El escritor común la frenó (identidad, propiedad, novedad…) sin guardar el motivo por
  -- fila. Puede estar bien (Prod 15-10: «Bakery Donuts Iberia», panrico.com, es la misma
  -- que «BIMBO DONUTS IBERIA», bimbo.es), pero hay que mirarla.
  -- Desde el 15-10 la corrida guarda el motivo en `corporate_tree.not_written`: con
  -- motivo es «info»; sin motivo, «warn».
  UNION ALL
  SELECT r.batch_id,
         CASE WHEN nw.reason IS NULL THEN 'warn' ELSE 'info' END,
         CASE WHEN nw.reason IS NULL THEN 'not_written_no_trace' ELSE 'not_written' END,
         r.related_name,
         CASE WHEN nw.reason IS NULL
              THEN format('Web %s: no es candidata del lote, ni está en Descartadas, ni existe en SellUp (el escritor la frenó sin motivo guardado).', r.related_domain)
              ELSE format('Web %s: el escritor no la escribió (%s).', r.related_domain, nw.reason) END
  FROM rels r
  JOIN batches b ON b.id = r.batch_id
  LEFT JOIN LATERAL (
    SELECT e ->> 'reason' AS reason
    FROM jsonb_array_elements(coalesce(b.t -> 'not_written', '[]')) e
    WHERE lower(e ->> 'domain') = lower(r.related_domain)
    LIMIT 1
  ) nw ON true
  WHERE r.related_candidate_id IS NULL AND r.related_domain IS NOT NULL AND r.relation_type <> 'root'
    AND r.related_domain <> coalesce(r.root_domain, '')
    AND r.matched_hubspot_company_id IS NULL
    AND (SELECT count(*) FROM rels x WHERE x.batch_id = r.batch_id AND x.related_domain = r.related_domain) = 1
    AND NOT EXISTS (SELECT 1 FROM disp d WHERE d.batch_id = r.batch_id AND lower(d.name) = lower(r.related_name))
    AND NOT EXISTS (SELECT 1 FROM prospect_candidates c WHERE c.domain = r.related_domain)
    AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.domain = r.related_domain)

  -- ── El rescate no terminó ─────────────────────────────────
  UNION ALL
  SELECT d.batch_id, 'warn', 'rescue_pending', d.name,
         format('El rescate quedó en «%s» (%s).', coalesce(d.evidence -> 'claude_rescue' ->> 'decision', 'sin decisión'),
                coalesce(d.evidence -> 'claude_domain_search' ->> 'reason', d.evidence -> 'claude_domain_search' ->> 'error_code', '—'))
  FROM disp d
  WHERE d.candidate_id IS NULL AND d.updated_at < now() - interval '15 minutes'
    AND coalesce(d.evidence -> 'claude_rescue' ->> 'decision', '') IN ('', 'retryable', 'in_progress')

  -- ── En revisión sin web ni número fiscal (nadie la puede identificar) ─
  UNION ALL
  SELECT c.batch_id, 'warn', 'review_without_identity', c.name, 'En revisión sin web propia y sin número fiscal.'
  FROM cand c JOIN batches b ON b.id = c.batch_id
  WHERE c.status = 'needs_review' AND c.domain IS NULL AND c.tax_identifier IS NULL

  -- ── Costo por empresa nueva ───────────────────────────────
  UNION ALL
  SELECT b.id, 'warn', 'cost_per_new', NULL,
         format('US$%s por %s nuevas en revisión.', u.usd, n.new_count)
  FROM batches b JOIN usage u ON u.batch_id = b.id
  CROSS JOIN LATERAL (SELECT count(*) AS new_count FROM cand c WHERE c.batch_id = b.id AND c.status = 'needs_review') n
  WHERE u.usd > 0.5 AND (n.new_count = 0 OR u.usd / n.new_count > 0.5)
)
SELECT left(f.id::text, 8) AS batch, b.t ->> 'root_name' AS root, f.severity, f.chk AS "check", f.item, f.detail
FROM findings f JOIN batches b ON b.id = f.id
ORDER BY b.created_at DESC, CASE f.severity WHEN 'error' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, f.chk, f.item;
