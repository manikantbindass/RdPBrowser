ALTER TABLE devices ADD COLUMN trust_state TEXT NOT NULL DEFAULT 'unknown'
  CHECK(trust_state IN ('unknown','approved','quarantined','revoked')),
  ADD COLUMN public_key JSONB,
  ADD COLUMN posture_valid_until TIMESTAMPTZ;
UPDATE devices SET trust_state='revoked' WHERE status='revoked';
ALTER TABLE sessions ADD COLUMN family_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  ADD COLUMN absolute_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '7 days',
  ADD COLUMN authentication_method TEXT NOT NULL DEFAULT 'password' CHECK(authentication_method IN ('password','oidc')),
  ADD COLUMN mfa_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN authenticated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN registered_device_id UUID,
  ADD COLUMN device_proved_at TIMESTAMPTZ,
  ADD FOREIGN KEY(organization_id,registered_device_id) REFERENCES devices(organization_id,id);
UPDATE sessions SET absolute_expires_at=COALESCE(refresh_expires_at,expires_at),authenticated_at=started_at;
CREATE INDEX ON sessions(organization_id,user_id,family_id);

CREATE TABLE access_policies (
  organization_id UUID PRIMARY KEY DEFAULT current_organization() REFERENCES organizations(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  configuration JSONB NOT NULL CHECK(jsonb_typeof(configuration)='object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE identity_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  user_id UUID NOT NULL,
  provider_id VARCHAR(64) NOT NULL,
  issuer TEXT NOT NULL,
  subject VARCHAR(255) NOT NULL,
  UNIQUE(organization_id,issuer,subject),
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id)
);
CREATE INDEX ON identity_links(organization_id,user_id);
CREATE TABLE oidc_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  provider_id VARCHAR(64) NOT NULL,
  state_hash TEXT NOT NULL,
  browser_hash TEXT NOT NULL,
  sealed_context TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(organization_id,state_hash)
);
CREATE INDEX ON oidc_transactions(organization_id,expires_at);
CREATE TABLE used_refresh_tokens (
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  user_id UUID NOT NULL,
  token_hash TEXT NOT NULL,
  family_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(organization_id,token_hash),
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id)
);
CREATE INDEX ON used_refresh_tokens(organization_id,expires_at);
CREATE TABLE device_challenges (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  user_id UUID NOT NULL,
  session_id UUID NOT NULL,
  device_id UUID NOT NULL,
  nonce_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
  FOREIGN KEY(organization_id,session_id) REFERENCES sessions(organization_id,id),
  FOREIGN KEY(organization_id,device_id) REFERENCES devices(organization_id,id)
);
CREATE INDEX ON device_challenges(organization_id,expires_at);
CREATE TABLE access_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  user_id UUID NOT NULL,
  session_id UUID,
  device_id UUID,
  resource VARCHAR(80) NOT NULL,
  sensitivity TEXT NOT NULL CHECK(sensitivity IN ('low','medium','high')),
  outcome TEXT NOT NULL CHECK(outcome IN ('allow','deny')),
  reason VARCHAR(80) NOT NULL,
  request_id UUID NOT NULL,
  policy_revision INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
  FOREIGN KEY(organization_id,session_id) REFERENCES sessions(organization_id,id),
  FOREIGN KEY(organization_id,device_id) REFERENCES devices(organization_id,id)
);
CREATE INDEX ON access_decisions(organization_id,created_at DESC,id);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['access_policies','identity_links','oidc_transactions','used_refresh_tokens','device_challenges','access_decisions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_boundary ON %I USING (organization_id=current_organization()) WITH CHECK (organization_id=current_organization())',t);
  END LOOP;
END $$;
