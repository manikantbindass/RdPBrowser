'use strict';
const { query }=require('../db/db');
const { fail }=require('./validation');
async function entitlements(userIds) {
  const rows=(await query(`SELECT u.id,jsonb_build_object('userId',u.id,'role',u.role,'active',u.is_active,'locked',u.is_locked,'directoryId',u.directory_id,
    'groups',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'role',g.mapped_role) ORDER BY g.id)
      FROM directory_members m JOIN directory_groups g ON g.id=m.group_id AND g.organization_id=m.organization_id
      WHERE m.user_id=u.id AND NOT g.is_deleted),'[]'::jsonb),
    'policies',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'revision',p.revision) ORDER BY p.id) FROM policies p WHERE p.is_active AND
      (p.assignment_scope='organization' OR EXISTS(SELECT 1 FROM policy_user_assignments a WHERE a.policy_id=p.id AND a.user_id=u.id)
      OR EXISTS(SELECT 1 FROM policy_group_assignments a JOIN directory_members m ON m.group_id=a.group_id AND m.organization_id=a.organization_id
        JOIN directory_groups g ON g.id=m.group_id AND g.organization_id=m.organization_id WHERE a.policy_id=p.id AND m.user_id=u.id AND NOT g.is_deleted))),'[]'::jsonb)) AS snapshot
    FROM users u WHERE id=ANY($1::uuid[]) ORDER BY id`,[userIds])).rows;
  if (rows.some(row=>row.snapshot.groups.length>200 || row.snapshot.policies.length>100)) fail(503,'Access-review snapshot capacity exceeded');
  return rows;
}
module.exports={ entitlements };
