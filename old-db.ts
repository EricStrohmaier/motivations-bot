import { Pool, PoolClient } from "pg";
import { UserProfile } from "./types";
import dotenv from "dotenv";
dotenv.config();

const connectionString = process.env.DATABASE_URL;
const sslEnabled = process.env.DATABASE_SSL !== "false";

// Extend PoolClient type to include lastQuery
declare module "pg" {
  interface PoolClient {
    lastQuery?: any[];
  }
}

export class DatabaseService {
  private pool: Pool | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5 seconds

  async initialize(): Promise<void> {
    console.log("Initializing database pool...");
    try {
      this.pool = new Pool({
        connectionString,
        ssl: sslEnabled
          ? {
              rejectUnauthorized: false,
            }
          : undefined,
        max: 20, // Maximum number of clients in the pool
        idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
        connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
      });

      // Test the connection
      const clientPool = await this.pool.connect();
      try {
        await clientPool.query("SELECT NOW()");
        console.log("Database pool initialized successfully");
      } finally {
        clientPool.release();
      }

      // Handle pool errors
      this.pool.on("error", (err) => {
        console.error("Unexpected error on idle client", err);
      });

      await this.initializeTables();

      // Check for missing columns using information_schema
      const client = await this.getClient();
      try {
        const result = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'users'
        `);
        const columnNames = result.rows.map((row: any) => row.column_name);

        const columnUpdates = [];
        if (!columnNames.includes("custom_motivation_messages")) {
          columnUpdates.push(
            "ALTER TABLE users ADD COLUMN custom_motivation_messages JSONB DEFAULT '[]'::jsonb"
          );
        }
        if (!columnNames.includes("timezone")) {
          columnUpdates.push(
            "ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'UTC'"
          );
        }
        if (!columnNames.includes("check_in_enabled")) {
          columnUpdates.push(
            "ALTER TABLE users ADD COLUMN check_in_enabled BOOLEAN DEFAULT true"
          );
        }

        for (const update of columnUpdates) {
          await client.query(update);
        }
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Failed to initialize database pool:", error);
      throw error;
    }
  }

  private async initializeTables(): Promise<void> {
    const client = await this.getClient();

    try {
      // First, check if tables exist
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'users'
        );
      `);

      if (!tableExists.rows[0].exists) {
        // Create users table if it doesn't exist with BIGINT for user_id
        await client.query(`
          CREATE TABLE users (
            user_id BIGINT PRIMARY KEY,
            username TEXT,
            goals JSONB DEFAULT '[]'::jsonb,
            motivation_frequency INTEGER DEFAULT 24,
            timezone TEXT DEFAULT 'UTC',
            check_in_enabled BOOLEAN DEFAULT true,
            last_message_date TIMESTAMP WITH TIME ZONE,
            custom_motivation_messages JSONB DEFAULT '[]'::jsonb
          )
        `);

        // Create message_history table with BIGINT for user_id
        await client.query(`
          CREATE TABLE message_history (
            id SERIAL PRIMARY KEY,
            user_id BIGINT REFERENCES users(user_id),
            message_text TEXT,
            message_type TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Create goal_progress table with BIGINT for user_id
        await client.query(`
          CREATE TABLE goal_progress (
            id SERIAL PRIMARY KEY,
            user_id BIGINT REFERENCES users(user_id),
            goal TEXT,
            status TEXT CHECK (status IN ('active', 'completed', 'abandoned')),
            notes TEXT,
            start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            completion_date TIMESTAMP WITH TIME ZONE
          )
        `);
      } else {
        // If tables exist, alter the column type if needed
        await client.query(`
          DO $$ 
          BEGIN 
            -- Check and modify users table
            IF EXISTS (
              SELECT FROM information_schema.columns 
              WHERE table_name = 'users' 
              AND column_name = 'user_id' 
              AND data_type = 'integer'
            ) THEN 
              ALTER TABLE message_history DROP CONSTRAINT IF EXISTS message_history_user_id_fkey;
              ALTER TABLE goal_progress DROP CONSTRAINT IF EXISTS goal_progress_user_id_fkey;
              ALTER TABLE users ALTER COLUMN user_id TYPE BIGINT;
              ALTER TABLE message_history ALTER COLUMN user_id TYPE BIGINT;
              ALTER TABLE goal_progress ALTER COLUMN user_id TYPE BIGINT;
              ALTER TABLE message_history ADD CONSTRAINT message_history_user_id_fkey 
                FOREIGN KEY (user_id) REFERENCES users(user_id);
              ALTER TABLE goal_progress ADD CONSTRAINT goal_progress_user_id_fkey 
                FOREIGN KEY (user_id) REFERENCES users(user_id);
            END IF;
          END $$;
        `);
      }

      console.log("Database tables initialized successfully");
    } catch (error) {
      console.error("Error initializing tables:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error(
        "Database pool not initialized. Call initialize() first."
      );
    }

    try {
      const client = await this.pool.connect();
      const db = new DatabaseService();
      await db.initialize();

      // Use the services
      await db.users.saveUser(userProfile);
      await db.messages.logMessage(userId, message, "motivation");
      await db.goals.saveGoalProgress(userId, goal, "active");
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

  async getNextMotivationMessage(userId: number): Promise<string | null> {
    const user = await this.getUser(userId);
    if (!user?.customMotivationMessages?.length) {
      return null;
    }

    const client = await this.getClient();

    // Get a random message using a more reliable PostgreSQL random selection
    const result = await client.query(
      `
      WITH messages AS (
        SELECT m.value as message
        FROM users, jsonb_array_elements_text(custom_motivation_messages) m
        WHERE user_id = $1
      )
      SELECT message FROM messages
      ORDER BY random()
      LIMIT 1
    `,
      [userId]
    );

    const message = result.rows[0]?.message || null;
    client.release();
    return message;
  }

  async updateMotivationMessages(
    userId: number,
    messages: string[]
  ): Promise<void> {
    const client = await this.getClient();

    await client.query(
      "UPDATE users SET custom_motivation_messages = $1::jsonb WHERE user_id = $2",
      [JSON.stringify(messages), userId]
    );

    client.release();
  }

  async saveUser(profile: UserProfile): Promise<void> {
    const client = await this.getClient();

    await client.query(
      `
      INSERT INTO users (
        user_id,
        username,
        goals,
        motivation_frequency,
        timezone,
        check_in_enabled,
        last_message_date,
        custom_motivation_messages
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id) DO UPDATE SET
        username = EXCLUDED.username,
        goals = EXCLUDED.goals,
        motivation_frequency = EXCLUDED.motivation_frequency,
        timezone = EXCLUDED.timezone,
        check_in_enabled = EXCLUDED.check_in_enabled,
        last_message_date = EXCLUDED.last_message_date,
        custom_motivation_messages = EXCLUDED.custom_motivation_messages
    `,
      [
        profile.userId,
        profile.username,
        JSON.stringify(profile.goals),
        profile.motivationFrequency,
        profile.timezone,
        profile.checkInEnabled,
        profile.lastMessageDate.toISOString(),
        JSON.stringify(profile.customMotivationMessages || []),
      ]
    );

    client.release();
  }

  async getUser(userId: number): Promise<UserProfile | null> {
    const client = await this.getClient();

    const result = await client.query(
      "SELECT * FROM users WHERE user_id = $1",
      [userId]
    );
    const user = result.rows[0];

    client.release();

    if (!user) return null;

    return {
      userId: user.user_id,
      username: user.username,
      goals: user.goals,
      motivationFrequency: user.motivation_frequency,
      checkInEnabled: user.check_in_enabled,
      timezone: user.timezone,
      lastMessageDate: new Date(user.last_message_date),
      customMotivationMessages: user.custom_motivation_messages,
    };
  }

  async getAllUsers(): Promise<UserProfile[]> {
    const client = await this.getClient();

    const result = await client.query("SELECT * FROM users");

    const users = result.rows.map((user) => ({
      userId: user.user_id,
      username: user.username,
      goals: user.goals,
      motivationFrequency: user.motivation_frequency,
      checkInEnabled: user.check_in_enabled,
      timezone: user.timezone,
      lastMessageDate: new Date(user.last_message_date),
      customMotivationMessages: user.custom_motivation_messages,
    }));

    client.release();
    return users;
  }

  async getUsersForMotivation(): Promise<UserProfile[]> {
    const client = await this.getClient();

    const result = await client.query(`
      SELECT * FROM users 
      WHERE last_message_date <= CURRENT_TIMESTAMP - (motivation_frequency || ' days')::interval
    `);

    const users = result.rows.map((user) => ({
      userId: user.user_id,
      username: user.username,
      goals: user.goals,
      motivationFrequency: user.motivation_frequency,
      checkInEnabled: user.check_in_enabled,
      timezone: user.timezone,
      lastMessageDate: new Date(user.last_message_date),
      customMotivationMessages: user.custom_motivation_messages,
    }));

    client.release();
    return users;
  }

  async logMessage(
    userId: number,
    messageText: string,
    messageType:
      | "motivation"
      | "progress_update"
      | "goal_completion"
      | "check_in"
  ): Promise<void> {
    const client = await this.getClient();

    await client.query(
      "INSERT INTO message_history (user_id, message_text, message_type) VALUES ($1, $2, $3)",
      [userId, messageText, messageType]
    );

    client.release();
  }

  async saveGoalProgress(
    userId: number,
    goal: string,
    status: "active" | "completed" | "abandoned",
    notes?: string
  ): Promise<void> {
    const client = await this.getClient();

    await client.query(
      `
      INSERT INTO goal_progress (
        user_id, goal, status, start_date, completion_date, notes
      ) VALUES (
        $1, $2, $3, CURRENT_TIMESTAMP, 
        CASE WHEN $3 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
        $4
      )
    `,
      [userId, goal, status, notes]
    );

    client.release();
  }

  async getGoalProgress(userId: number): Promise<any[]> {
    const client = await this.getClient();

    const result = await client.query(
      "SELECT * FROM goal_progress WHERE user_id = $1 ORDER BY start_date DESC",
      [userId]
    );

    const progress = result.rows;
    client.release();
    return progress;
  }

  async updateGoalStatus(
    goalId: number,
    status: "active" | "completed" | "abandoned",
    notes?: string
  ): Promise<void> {
    const client = await this.getClient();

    await client.query(
      `
      UPDATE goal_progress 
      SET status = $1,
          completion_date = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
          notes = COALESCE($2, notes)
      WHERE id = $3
    `,
      [status, notes, goalId]
    );

    client.release();
  }

  async getRecentMessages(userId: number, limit: number): Promise<any[]> {
    const client = await this.getClient();

    const result = await client.query(
      `
      SELECT message_text, message_type, created_at 
      FROM message_history 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `,
      [userId, limit]
    );

    const messages = result.rows;
    client.release();
    return messages;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
