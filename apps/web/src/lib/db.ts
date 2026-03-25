import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Missing DATABASE_URL in environment.");
}

// Single pool for the entire Next.js server process.
const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  maxUses: 5000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});

function isRetryableConnectionError(error: unknown) {
  return error instanceof Error
    && /connection terminated unexpectedly|connection terminated due to connection timeout|timeout|econnreset|econnrefused|connection ended unexpectedly/i.test(error.message);
}

async function connectClient() {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await pool.connect();
    } catch (error) {
      lastError = error;
      if (attempt < 2 && isRetryableConnectionError(error)) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

export async function withDbUser<T>(
  userId: string,
  fn: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const client = await connectClient();
  let destroyClient = false;
  try {
    await client.query("BEGIN");
    // Used by Postgres RLS policies in apps/web/db/001_init.sql.
    // `SET LOCAL ... = $1` fails to parse in some Postgres builds, so we use set_config().
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      destroyClient = true;
    }
    throw err;
  } finally {
    client.release(destroyClient);
  }
}

export async function withDbLoginEmail<T>(
  email: string,
  fn: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const client = await connectClient();
  let destroyClient = false;
  try {
    await client.query("BEGIN");
    // Used by the `users_login_lookup` RLS policy during login.
    await client.query("SELECT set_config('app.user_email', $1, true)", [email]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      destroyClient = true;
    }
    throw err;
  } finally {
    client.release(destroyClient);
  }
}

export async function withDb<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await connectClient();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
