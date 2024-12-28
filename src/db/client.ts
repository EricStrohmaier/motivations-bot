import { Pool, PoolClient } from "pg";
import { config } from "./config";

export class DatabaseClient {
  private pool: Pool | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5 seconds

  async initialize(): Promise<void> {
    console.log("Initializing database pool...");
    try {
      this.pool = new Pool({
        connectionString: config.connectionString,
        ssl: config.sslEnabled
          ? {
              rejectUnauthorized: false,
            }
          : undefined,
        ...config.poolConfig,
      });

      // Test the connection
      await this.ensureConnection();
      console.log("Database pool initialized successfully");

      // Handle pool errors
      this.pool.on("error", (err) => {
        console.error("Unexpected error on idle client", err);
      });
    } catch (error) {
      console.error("Failed to initialize database pool:", error);
      throw error;
    }
  }

  async ensureConnection(): Promise<void> {
    if (!this.pool) {
      throw new Error("Database pool not initialized");
    }

    try {
      const client = await this.pool.connect();
      try {
        await client.query("SELECT NOW()");
      } finally {
        client.release();
      }
    } catch (error) {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`Retrying connection (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
        return this.ensureConnection();
      }
      throw new Error(`Failed to connect to database after ${this.maxReconnectAttempts} attempts`);
    }
  }

  async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error(
        "Database pool not initialized. Call initialize() first."
      );
    }

    try {
      const client = await this.pool.connect();
      const query = client.query;
      const release = client.release;

      // Monkey patch the query method to keep track of last query
      client.query = function (
        this: PoolClient,
        ...args: Parameters<typeof query>
      ) {
        this.lastQuery = args;
        return query.apply(this, args);
      } as typeof query;

      // Monkey patch the release method to catch errors
      client.release = () => {
        client.query = query;
        client.release = release;
        return release.apply(client);
      };

      return client;
    } catch (error) {
      console.error("Error getting client from pool:", error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
