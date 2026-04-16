-- RemoteShield X — PostgreSQL Schema
-- Run via: psql -U remoteshield -d remoteshield_db -f schema.sql

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      VARCHAR(80)  UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT         NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'superadmin')),
  device_id     VARCHAR(255),                         -- device binding
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  is_locked     BOOLEAN      NOT NULL DEFAULT FALSE,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Sessions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT         NOT NULL,                -- hashed JWT
  device_id     VARCHAR(255),
  device_os     VARCHAR(50),                          -- 'windows', 'linux', 'macos', 'android'
  vpn_ip        INET,                                 -- client VPN tunnel IP
  public_ip     INET,                                 -- original public IP (should match server)
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  started_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_activity TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ  NOT NULL,
  ended_at      TIMESTAMPTZ
);

-- ─── IP Logs ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ip_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id    UUID         REFERENCES sessions(id) ON DELETE CASCADE,
  user_id       UUID         REFERENCES users(id) ON DELETE CASCADE,
  request_ip    INET         NOT NULL,
  vpn_confirmed BOOLEAN      NOT NULL DEFAULT FALSE,
  url_requested TEXT,
  user_agent    TEXT,
  country_code  VARCHAR(2),
  flagged       BOOLEAN      NOT NULL DEFAULT FALSE,
  flag_reason   TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Blocked URLs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocked_urls (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern       TEXT         NOT NULL UNIQUE,         -- glob or regex pattern
  blocked_by    UUID         REFERENCES users(id),
  reason        TEXT,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Allowed URLs (Whitelist) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS allowed_urls (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern       TEXT         NOT NULL UNIQUE,
  added_by      UUID         REFERENCES users(id),
  reason        TEXT,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Anomaly Alerts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anomaly_alerts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID         REFERENCES users(id),
  session_id    UUID         REFERENCES sessions(id),
  alert_type    VARCHAR(50)  NOT NULL,               -- 'unusual_ip', 'high_frequency', 'geo_mismatch'
  severity      VARCHAR(20)  NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  details       JSONB,
  resolved      BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Audit Log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id      UUID         REFERENCES users(id),
  action        VARCHAR(100) NOT NULL,               -- 'force_logout', 'block_url', 'login', etc.
  target        TEXT,
  metadata      JSONB,
  ip_address    INET,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sessions_user_id       ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_is_active     ON sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_ip_logs_user_id        ON ip_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ip_logs_created        ON ip_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ip_logs_flagged        ON ip_logs(flagged) WHERE flagged = TRUE;
CREATE INDEX IF NOT EXISTS idx_anomaly_resolved       ON anomaly_alerts(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_blocked_urls_active    ON blocked_urls(is_active) WHERE is_active = TRUE;

-- ─── Updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_users_updated_at ON users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
