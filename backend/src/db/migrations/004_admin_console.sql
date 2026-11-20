ALTER TABLE policies ADD COLUMN assignment_scope TEXT NOT NULL DEFAULT 'organization'
  CHECK (assignment_scope IN ('organization','users'));

CREATE TABLE policy_user_assignments (
  organization_id UUID NOT NULL DEFAULT current_organization(),
  policy_id UUID NOT NULL,
  user_id UUID NOT NULL,
  PRIMARY KEY(organization_id,policy_id,user_id),
  FOREIGN KEY(organization_id,policy_id) REFERENCES policies(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX ON policy_user_assignments(organization_id,user_id,policy_id);

CREATE TABLE policy_versions (
  organization_id UUID NOT NULL DEFAULT current_organization(),
  policy_id UUID NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL,
  rules JSONB NOT NULL,
  is_active BOOLEAN NOT NULL,
  assignment JSONB NOT NULL,
  actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(organization_id,policy_id,revision),
  FOREIGN KEY(organization_id,policy_id) REFERENCES policies(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_id) REFERENCES users(organization_id,id)
);

-- Adopt the latest available revision. Earlier revisions were never persisted.
ALTER TABLE policies NO FORCE ROW LEVEL SECURITY;
INSERT INTO policy_versions(organization_id,policy_id,revision,name,rules,is_active,assignment,created_at)
SELECT organization_id,id,revision,name,rules,is_active,'{"scope":"organization","userIds":[]}',updated_at
FROM policies;
ALTER TABLE policies FORCE ROW LEVEL SECURITY;

DO $$ DECLARE relation TEXT; BEGIN
  FOREACH relation IN ARRAY ARRAY['policy_user_assignments','policy_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',relation);
    EXECUTE format('CREATE POLICY tenant_boundary ON %I USING (organization_id=current_organization()) WITH CHECK (organization_id=current_organization())',relation);
  END LOOP;
END $$;

CREATE INDEX ON audit_log(organization_id,created_at DESC,id);
CREATE INDEX ON access_decisions(organization_id,created_at) WHERE outcome='deny';
