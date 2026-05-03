const { Pool } = require("pg");

let pool;

function getPool() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 8,
      idleTimeoutMillis: 30000,
    });

    pool.on("error", (err) => {
      console.error("Unexpected error on idle client:", err.message);
    });
  }

  return pool;
}

module.exports = { getPool };
