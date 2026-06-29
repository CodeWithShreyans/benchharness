import { drizzle } from "drizzle-orm/libsql";

export function hasDatabase() {
  return Boolean(process.env.TURSO_DATABASE_URL);
}

export function getDb() {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error("TURSO_DATABASE_URL is not configured.");
  }

  return drizzle({
    connection: {
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    },
  });
}
