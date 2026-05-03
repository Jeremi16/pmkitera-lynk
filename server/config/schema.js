const { getPool } = require("./database");

let schemaReady = false;

async function ensureSchema() {
  const db = getPool();

  if (!db) {
    return false;
  }

  if (schemaReady) {
    return true;
  }

  // Batch all DDL into a single multi-statement query to minimize round trips
  await db.query(`
    -- Tables
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    UPDATE users SET role = 'user' WHERE role IS DISTINCT FROM 'admin';
    ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

    CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS links (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      original_url TEXT NOT NULL,
      short_url TEXT NOT NULL,
      short_code TEXT,
      provider_link_id TEXT,
      custom_slug TEXT,
      provider TEXT NOT NULL DEFAULT 'shortio',
      requested_provider TEXT NOT NULL DEFAULT 'shortio',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      expires_at TIMESTAMPTZ,
      click_count INTEGER NOT NULL DEFAULT 0,
      last_clicked_at TIMESTAMPTZ,
      qr_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Column migrations for links
    ALTER TABLE links ADD COLUMN IF NOT EXISTS title TEXT;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS custom_slug TEXT;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS provider_link_id TEXT;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS requested_provider TEXT NOT NULL DEFAULT 'shortio';
    ALTER TABLE links ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS last_provider_sync_at TIMESTAMPTZ;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS provider_sync_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE links ADD COLUMN IF NOT EXISTS provider_sync_error TEXT;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS last_provider_total_clicks INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS last_provider_human_clicks INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS last_provider_period_key TEXT;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS last_provider_period_human_clicks INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE links ADD COLUMN IF NOT EXISTS qr_config JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS click_events (
      id BIGSERIAL PRIMARY KEY,
      link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      referrer TEXT,
      user_agent TEXT,
      ip_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS shortio_link_daily_stats (
      id BIGSERIAL PRIMARY KEY,
      link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      stat_date DATE NOT NULL,
      human_clicks INTEGER NOT NULL DEFAULT 0,
      total_clicks INTEGER NOT NULL DEFAULT 0,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shortio_link_breakdowns (
      id BIGSERIAL PRIMARY KEY,
      link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL DEFAULT 'last30',
      dimension TEXT NOT NULL,
      value_key TEXT NOT NULL,
      value_label TEXT,
      clicks INTEGER NOT NULL DEFAULT 0,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at DESC);
    ALTER TABLE links DROP CONSTRAINT IF EXISTS links_short_url_key;
    CREATE INDEX IF NOT EXISTS links_user_id_idx ON links (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS links_created_at_idx ON links (created_at DESC);
    CREATE INDEX IF NOT EXISTS links_provider_short_code_idx ON links (provider, short_code);
    CREATE INDEX IF NOT EXISTS click_events_link_id_idx ON click_events (link_id, clicked_at DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
  `);

  // Partial/unique indexes must be separate statements in some PG versions
  await Promise.all([
    db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS links_internal_code_unique_idx
      ON links (provider, short_code)
      WHERE short_code IS NOT NULL AND provider = 'internal';
    `),
    db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS links_shortio_provider_link_id_unique_idx
      ON links (provider, provider_link_id)
      WHERE provider = 'shortio' AND provider_link_id IS NOT NULL;
    `),
    db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS shortio_link_daily_stats_link_date_unique_idx
      ON shortio_link_daily_stats (link_id, stat_date);
    `),
    db.query(`
      CREATE INDEX IF NOT EXISTS shortio_link_daily_stats_date_idx
      ON shortio_link_daily_stats (stat_date DESC, link_id);
    `),
    db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS shortio_link_breakdowns_unique_idx
      ON shortio_link_breakdowns (link_id, period_key, dimension, value_key);
    `),
    db.query(`
      CREATE INDEX IF NOT EXISTS shortio_link_breakdowns_dim_idx
      ON shortio_link_breakdowns (dimension, period_key, clicks DESC);
    `),
  ]);

  schemaReady = true;
  return true;
}

module.exports = { ensureSchema };
