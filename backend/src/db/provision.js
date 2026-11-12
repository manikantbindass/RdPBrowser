'use strict';
// Operator-only; HTTP handlers never import this module.
async function provision(pool,{ role='remoteshield_app',password,schema='public' }) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(role) || !/^[a-z][a-z0-9_]{2,62}$/.test(schema) || !password || password.length<32) throw new Error('Invalid runtime role provisioning settings');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(77002,2)');
    const exists=await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role]);
    const quoted="'"+password.replace(/'/g,"''")+"'";
    if (!exists.rows.length) await client.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${quoted}`);
    else {
      const result=await client.query('SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=$1',[role]);
      if (Object.values(result.rows[0]).some(Boolean)) throw new Error('Refusing to reuse a privileged runtime role');
      if ((await client.query('SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1)',[role])).rows.length) throw new Error('Runtime role must not inherit or assume other roles');
      await client.query(`ALTER ROLE "${role}" PASSWORD ${quoted}`);
    }
    await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`);
    await client.query(`REVOKE INSERT,UPDATE,DELETE ON "${schema}".schema_migrations FROM "${role}"`);
    await client.query(`REVOKE DELETE,UPDATE ON "${schema}".audit_log FROM "${role}"`);
    await client.query(`REVOKE INSERT,UPDATE,DELETE ON "${schema}".organizations FROM "${role}"`);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
module.exports={ provision };
