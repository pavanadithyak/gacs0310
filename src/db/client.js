import pg from 'pg';

const { Pool } = pg;

/**
 * PostgreSQL connection pool
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => console.error('[Postgres] Unexpected error on idle client', err.message));

export default pool;
