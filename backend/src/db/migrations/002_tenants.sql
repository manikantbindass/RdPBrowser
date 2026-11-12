-- Legacy installations adopt one explicit organization; never infer ownership from client input.
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(160) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO organizations(id,name) VALUES ('00000000-0000-4000-8000-000000000001','Legacy organization');

CREATE FUNCTION current_organization() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['users','sessions','ip_logs','blocked_urls','allowed_urls','anomaly_alerts','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN organization_id UUID NOT NULL DEFAULT ''00000000-0000-4000-8000-000000000001'' REFERENCES organizations(id)',t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT current_organization()',t);
    EXECUTE format('ALTER TABLE %I ADD UNIQUE(organization_id,id)',t);
    EXECUTE format('CREATE INDEX ON %I(organization_id,%I DESC,id)',t, CASE WHEN t='sessions' THEN 'started_at' ELSE 'created_at' END);
  END LOOP;
END $$;

ALTER TABLE users DROP CONSTRAINT users_username_key, DROP CONSTRAINT users_email_key;
ALTER TABLE users ADD UNIQUE(organization_id,username), ADD UNIQUE(organization_id,email);
ALTER TABLE blocked_urls DROP CONSTRAINT blocked_urls_pattern_key;
ALTER TABLE blocked_urls ADD UNIQUE(organization_id,pattern);
ALTER TABLE allowed_urls DROP CONSTRAINT allowed_urls_pattern_key;
ALTER TABLE allowed_urls ADD UNIQUE(organization_id,pattern);

ALTER TABLE sessions ADD COLUMN refresh_hash TEXT, ADD COLUMN refresh_expires_at TIMESTAMPTZ;
CREATE UNIQUE INDEX sessions_refresh_hash ON sessions(refresh_hash) WHERE refresh_hash IS NOT NULL;
CREATE INDEX sessions_live_token ON sessions(organization_id,token_hash) WHERE is_active;
CREATE INDEX sessions_live_user ON sessions(organization_id,user_id,started_at DESC) WHERE is_active;
ALTER TABLE sessions ADD FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id);
ALTER TABLE ip_logs ADD FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
  ADD FOREIGN KEY(organization_id,session_id) REFERENCES sessions(organization_id,id);
ALTER TABLE anomaly_alerts ADD FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
  ADD FOREIGN KEY(organization_id,session_id) REFERENCES sessions(organization_id,id);
ALTER TABLE blocked_urls ADD FOREIGN KEY(organization_id,blocked_by) REFERENCES users(organization_id,id);
ALTER TABLE allowed_urls ADD FOREIGN KEY(organization_id,added_by) REFERENCES users(organization_id,id);
ALTER TABLE audit_log ADD FOREIGN KEY(organization_id,actor_id) REFERENCES users(organization_id,id);

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  user_id UUID NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  name VARCHAR(160) NOT NULL,
  platform VARCHAR(20) NOT NULL CHECK(platform IN ('windows','linux','macos','android')),
  status VARCHAR(20) NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,external_id),
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id)
);
CREATE TABLE policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  name VARCHAR(160) NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  rules JSONB NOT NULL CHECK(jsonb_typeof(rules)='object'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,name)
);
CREATE TABLE security_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  user_id UUID NOT NULL,
  device_id UUID,
  event_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK(severity IN ('low','medium','high','critical')),
  -- Client fields are an allowlist; arbitrary payloads/secrets are not accepted.
  client_event_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,user_id,client_event_id),
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
  FOREIGN KEY(organization_id,device_id) REFERENCES devices(organization_id,id)
);
CREATE INDEX ON devices(organization_id,user_id,created_at DESC,id);
CREATE INDEX ON policies(organization_id,created_at DESC,id);
CREATE INDEX ON security_events(organization_id,severity,created_at DESC,id);
CREATE INDEX ON security_events(organization_id,user_id,created_at DESC,id);
ALTER TABLE audit_log ADD COLUMN request_id UUID;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','users','sessions','ip_logs','blocked_urls','allowed_urls','anomaly_alerts','audit_log','devices','policies','security_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_boundary ON %I USING (%I = current_organization()) WITH CHECK (%I = current_organization())',
      t, CASE WHEN t='organizations' THEN 'id' ELSE 'organization_id' END, CASE WHEN t='organizations' THEN 'id' ELSE 'organization_id' END);
  END LOOP;
END $$;
