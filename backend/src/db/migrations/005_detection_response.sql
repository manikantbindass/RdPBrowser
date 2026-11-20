CREATE TABLE detection_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  user_id UUID,
  session_id UUID,
  event_type VARCHAR(64) NOT NULL,
  subject_key VARCHAR(64) NOT NULL,
  source_hash VARCHAR(64),
  device_hash VARCHAR(64),
  trust VARCHAR(24) NOT NULL CHECK(trust IN ('server_observed','client_report')),
  reason VARCHAR(80),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,event_type,request_id),
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
  FOREIGN KEY(organization_id,session_id) REFERENCES sessions(organization_id,id)
);
CREATE INDEX ON detection_signals(organization_id,event_type,created_at DESC,id);

ALTER TABLE anomaly_alerts ADD COLUMN rule_id VARCHAR(64),
  ADD COLUMN rule_version INTEGER,
  ADD COLUMN subject_key VARCHAR(64),
  ADD COLUMN confidence VARCHAR(12) NOT NULL DEFAULT 'low' CHECK(confidence IN ('low','medium','high')),
  ADD COLUMN explanation TEXT NOT NULL DEFAULT 'Legacy alert. Evidence was recorded by the prior worker.',
  ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','resolved','dismissed')),
  ADD COLUMN disposition VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK(disposition IN ('pending','confirmed','benign','insufficient_evidence')),
  ADD COLUMN assigned_to UUID,
  ADD COLUMN review_revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE anomaly_alerts ADD FOREIGN KEY(organization_id,assigned_to) REFERENCES users(organization_id,id);
ALTER TABLE anomaly_alerts NO FORCE ROW LEVEL SECURITY;
UPDATE anomaly_alerts SET status=CASE WHEN resolved THEN 'resolved' ELSE 'open' END,
  disposition=CASE WHEN resolved THEN 'insufficient_evidence' ELSE 'pending' END,
  first_seen=created_at,last_seen=created_at;
ALTER TABLE anomaly_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE anomaly_alerts ADD CHECK(resolved = (status IN ('resolved','dismissed')));
CREATE UNIQUE INDEX detection_open_incident ON anomaly_alerts(organization_id,rule_id,subject_key)
  WHERE rule_id IS NOT NULL AND status IN ('open','investigating');
CREATE INDEX ON anomaly_alerts(organization_id,status,last_seen DESC,id);

CREATE TABLE detection_evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization(),
  incident_id UUID NOT NULL,
  signal_id UUID NOT NULL,
  rule_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  trust VARCHAR(24) NOT NULL,
  reason VARCHAR(80),
  request_id UUID NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,rule_id,signal_id),
  FOREIGN KEY(organization_id,incident_id) REFERENCES anomaly_alerts(organization_id,id)
);
CREATE INDEX ON detection_evidence(organization_id,incident_id,observed_at DESC,id);

CREATE TABLE incident_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization(),
  incident_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  status VARCHAR(16) NOT NULL,
  disposition VARCHAR(24) NOT NULL,
  revision INTEGER NOT NULL,
  response VARCHAR(24),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(organization_id,incident_id) REFERENCES anomaly_alerts(organization_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES users(organization_id,id)
);
CREATE INDEX ON incident_reviews(organization_id,incident_id,created_at DESC,id);

CREATE TABLE detection_runs (
  organization_id UUID PRIMARY KEY DEFAULT current_organization() REFERENCES organizations(id),
  last_attempt TIMESTAMPTZ,
  last_success TIMESTAMPTZ,
  state VARCHAR(32) NOT NULL CHECK(state IN ('healthy','capacity_exceeded','failed')),
  incidents_opened INTEGER NOT NULL DEFAULT 0
);

DO $$ DECLARE relation TEXT; BEGIN
  FOREACH relation IN ARRAY ARRAY['detection_signals','detection_evidence','incident_reviews','detection_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',relation);
    EXECUTE format('CREATE POLICY tenant_boundary ON %I USING (organization_id=current_organization()) WITH CHECK (organization_id=current_organization())',relation);
  END LOOP;
END $$;
