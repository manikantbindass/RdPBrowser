CREATE TABLE directory_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  name VARCHAR(160) NOT NULL,
  provider_id VARCHAR(64),
  sso_linking BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX directory_one_sso_source ON directory_connections(organization_id,provider_id) WHERE sso_linking AND is_active;
CREATE TABLE provisioning_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization(),
  directory_id UUID NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_by UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,directory_id) REFERENCES directory_connections(organization_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
);
ALTER TABLE users ADD COLUMN directory_id UUID,
  ADD COLUMN scim_external_id VARCHAR(255),
  ADD COLUMN scim_display_name VARCHAR(160),
  ADD COLUMN scim_name JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN scim_emails JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN scim_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN scim_deleted_at TIMESTAMPTZ,
  ADD COLUMN password_auth_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD UNIQUE(organization_id,directory_id,id),
  ADD UNIQUE(organization_id,directory_id,scim_external_id),
  ADD FOREIGN KEY(organization_id,directory_id) REFERENCES directory_connections(organization_id,id),
  ADD CHECK(directory_id IS NULL OR role<>'superadmin');
CREATE UNIQUE INDEX directory_username_ci ON users(organization_id,lower(username)) WHERE directory_id IS NOT NULL;
CREATE TABLE directory_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization(),
  directory_id UUID NOT NULL,
  external_id VARCHAR(255),
  display_name VARCHAR(160) NOT NULL,
  mapped_role TEXT NOT NULL DEFAULT 'user' CHECK(mapped_role IN ('user','admin')),
  revision INTEGER NOT NULL DEFAULT 1,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,directory_id,id),
  UNIQUE(organization_id,directory_id,external_id),
  FOREIGN KEY(organization_id,directory_id) REFERENCES directory_connections(organization_id,id)
);
CREATE TABLE directory_members (
  organization_id UUID NOT NULL DEFAULT current_organization(),
  directory_id UUID NOT NULL,
  group_id UUID NOT NULL,
  user_id UUID NOT NULL,
  PRIMARY KEY(organization_id,group_id,user_id),
  FOREIGN KEY(organization_id,directory_id,group_id) REFERENCES directory_groups(organization_id,directory_id,id),
  FOREIGN KEY(organization_id,directory_id,user_id) REFERENCES users(organization_id,directory_id,id)
);
CREATE UNIQUE INDEX directory_group_display_name ON directory_groups(organization_id,directory_id,lower(display_name)) WHERE NOT is_deleted;
CREATE INDEX ON directory_members(organization_id,user_id,group_id);
ALTER TABLE policies DROP CONSTRAINT policies_assignment_scope_check,
  ADD CHECK(assignment_scope IN ('organization','users','groups'));
CREATE TABLE policy_group_assignments (
  organization_id UUID NOT NULL DEFAULT current_organization(),
  policy_id UUID NOT NULL,
  group_id UUID NOT NULL,
  PRIMARY KEY(organization_id,policy_id,group_id),
  FOREIGN KEY(organization_id,policy_id) REFERENCES policies(organization_id,id),
  FOREIGN KEY(organization_id,group_id) REFERENCES directory_groups(organization_id,id)
);
CREATE TABLE oidc_settings (
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  provider_id VARCHAR(64) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  configuration_hash CHAR(64),
  validated_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(organization_id,provider_id)
);
ALTER TABLE sessions ADD COLUMN oidc_provider_id VARCHAR(64);
CREATE TABLE oidc_console_grants (
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  provider_id VARCHAR(64) NOT NULL,
  grant_hash CHAR(64) NOT NULL,
  sealed_session TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(organization_id,grant_hash)
);
CREATE INDEX ON oidc_console_grants(organization_id,expires_at);
ALTER TABLE audit_log ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'user' CHECK(actor_kind IN ('user','directory','operator')),
  ADD COLUMN provisioning_credential_id UUID,
  ADD FOREIGN KEY(organization_id,provisioning_credential_id) REFERENCES provisioning_credentials(organization_id,id);
CREATE TABLE governance_changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization() REFERENCES organizations(id),
  actor_id UUID,
  provisioning_credential_id UUID,
  action VARCHAR(100) NOT NULL,
  target UUID,
  before_state JSONB,
  after_state JSONB,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(organization_id,actor_id) REFERENCES users(organization_id,id),
  FOREIGN KEY(organization_id,provisioning_credential_id) REFERENCES provisioning_credentials(organization_id,id)
);
CREATE INDEX ON governance_changes(organization_id,created_at,id);
CREATE TABLE evidence_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization(),
  actor_id UUID NOT NULL,
  dataset VARCHAR(32) NOT NULL,
  digest CHAR(64) NOT NULL,
  row_count INTEGER NOT NULL,
  criteria JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(organization_id,actor_id) REFERENCES users(organization_id,id)
);
CREATE TABLE access_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization(),
  name VARCHAR(160) NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL,
  closed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
  FOREIGN KEY(organization_id,closed_by) REFERENCES users(organization_id,id)
);
CREATE TABLE access_review_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization(),
  review_id UUID NOT NULL,
  user_id UUID NOT NULL,
  snapshot JSONB NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision TEXT NOT NULL DEFAULT 'pending' CHECK(decision IN ('pending','retain','revoke')),
  reason TEXT CHECK(reason IN ('access_required','no_longer_needed','followup_required')),
  revision INTEGER NOT NULL DEFAULT 1,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,review_id,id),
  UNIQUE(organization_id,review_id,user_id),
  FOREIGN KEY(organization_id,review_id) REFERENCES access_reviews(organization_id,id),
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
  FOREIGN KEY(organization_id,reviewed_by) REFERENCES users(organization_id,id)
);
CREATE INDEX ON access_review_items(organization_id,review_id,id);
CREATE TABLE access_review_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL DEFAULT current_organization(),
  item_id UUID NOT NULL,
  review_id UUID NOT NULL,
  snapshot JSONB NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('retain','revoke')),
  reason TEXT NOT NULL,
  actor_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,item_id,revision),
  FOREIGN KEY(organization_id,review_id,item_id) REFERENCES access_review_items(organization_id,review_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES users(organization_id,id)
);
ALTER TABLE organizations ADD COLUMN onboarded_at TIMESTAMPTZ,
  ADD COLUMN offboarded_at TIMESTAMPTZ;

DO $$ DECLARE relation TEXT; BEGIN
  FOREACH relation IN ARRAY ARRAY['directory_connections','provisioning_credentials','directory_groups','directory_members',
    'policy_group_assignments','oidc_settings','oidc_console_grants','governance_changes','evidence_exports','access_reviews','access_review_items','access_review_decisions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',relation);
    EXECUTE format('CREATE POLICY tenant_boundary ON %I USING (organization_id=current_organization()) WITH CHECK (organization_id=current_organization())',relation);
  END LOOP;
END $$;
