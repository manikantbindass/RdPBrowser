'use strict';
const { query,transaction }=require('../db/db');
const { change }=require('./governance-change');
const { fail }=require('./validation');
async function lockDirectory(directoryId) {
  const row=(await query('SELECT * FROM directory_connections WHERE id=$1 FOR UPDATE',[directoryId])).rows[0];
  if (!row) fail(404,'Directory not found');
  return row;
}
async function provisionMutation(req,fn) {
  return transaction(async () => {
    const directory=await lockDirectory(req.provisioning.directoryId);
    const credential=await query('SELECT id FROM provisioning_credentials WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[req.provisioning.credentialId]);
    if (!directory.is_active || !credential.rowCount) fail(401,'Provisioning credential unavailable');
    return fn(directory);
  });
}
async function applyRoles(userIds) {
  if (!userIds.length) return;
  await query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[userIds]);
  await query(`UPDATE users u SET role=CASE WHEN EXISTS(
      SELECT 1 FROM directory_members m JOIN directory_groups g ON g.id=m.group_id AND g.organization_id=m.organization_id
      WHERE m.user_id=u.id AND NOT g.is_deleted AND g.mapped_role='admin') THEN 'admin' ELSE 'user' END
    ,scim_version=scim_version+1,updated_at=NOW() WHERE u.id=ANY($1::uuid[]) AND u.directory_id IS NOT NULL`,[userIds]);
  // Membership changes can change URL restrictions even if the role stays equal.
  await query('UPDATE sessions SET is_active=FALSE,ended_at=NOW(),refresh_hash=NULL WHERE user_id=ANY($1::uuid[]) AND is_active',[userIds]);
}
async function members(groupId) { return (await query('SELECT user_id FROM directory_members WHERE group_id=$1 ORDER BY user_id',[groupId])).rows.map(row=>row.user_id); }
async function replaceMembers(req,group,value) {
  const ids=[...new Set(value.map(member=>member.value))].sort();
  const old=await members(group.id);
  if (old.join(',')===ids.join(',')) return;
  if (ids.length && (await query('SELECT id FROM users WHERE id=ANY($1::uuid[]) AND directory_id=$2 AND scim_deleted_at IS NULL',[ids,group.directory_id])).rowCount!==ids.length) fail(400,'A member is unavailable in this directory','invalidValue');
  if (ids.length && (await query(`SELECT user_id FROM directory_members WHERE user_id=ANY($1::uuid[]) AND group_id<>$2
    GROUP BY user_id HAVING COUNT(*)>=200 LIMIT 1`,[ids,group.id])).rowCount) fail(400,'A user cannot belong to more than 200 groups','invalidValue');
  await query('DELETE FROM directory_members WHERE group_id=$1',[group.id]);
  if (ids.length) await query('INSERT INTO directory_members(directory_id,group_id,user_id) SELECT $1,$2,unnest($3::uuid[])',[group.directory_id,group.id,ids]);
  await applyRoles([...new Set([...old,...ids])]);
  await change(req,'directory.membership',group.id,{ userIds:old },{ userIds:ids });
}
module.exports={ lockDirectory,provisionMutation,applyRoles,members,replaceMembers };
