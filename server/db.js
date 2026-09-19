import pg from 'pg';
let pool;
export function getDb() {
 if (!process.env.DATABASE_URL) throw new Error('Database not configured');
 pool ||= new pg.Pool({connectionString:process.env.DATABASE_URL, max:3, connectionTimeoutMillis:5000, idleTimeoutMillis:10000});
 return pool;
}
export async function transaction(db, fn) {
 const c=await db.connect();
 try { await c.query('BEGIN'); const result=await fn(c); await c.query('COMMIT'); return result; }
 catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

