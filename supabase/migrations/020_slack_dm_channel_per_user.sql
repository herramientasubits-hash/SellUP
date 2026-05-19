-- ============================================================
-- 020: Canal DM de Slack por usuario
-- ============================================================
-- Agrega slack_dm_channel_id a internal_users para que cada usuario
-- tenga su propio canal de mensajes directos con el bot de SellUp.
-- El bot abre el DM automáticamente cuando el usuario inicia sesión
-- por primera vez y el workspace de Slack está conectado.
-- ============================================================

ALTER TABLE internal_users
  ADD COLUMN IF NOT EXISTS slack_dm_channel_id TEXT;

COMMENT ON COLUMN internal_users.slack_dm_channel_id IS
  'ID del canal DM de Slack abierto por el bot de SellUp para este usuario. Null si Slack no está conectado o el usuario no tiene cuenta en el workspace.';
