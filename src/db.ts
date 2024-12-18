import { Client } from "pg";
import { UserProfile } from "./types";
import dotenv from "dotenv";
dotenv.config();

const connectionString = process.env.DATABASE_URL;
const sslEnabled = process.env.DATABASE_SSL !== "false";

export class DatabaseService {
  private db: Client | null = null;

  async initialize(): Promise<void> {
    console.log("Initializing database...");
    console.log("Database path:", connectionString);
    this.db = new Client({
      connectionString,
    });
    await this.db.connect();

    // Create users table if it doesn't exist
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        goals JSONB DEFAULT '[]'::jsonb,
        motivation_frequency INTEGER,
        timezone TEXT DEFAULT 'UTC',
        check_in_enabled BOOLEAN DEFAULT true,
        last_message_date TIMESTAMP WITH TIME ZONE,
        custom_motivation_messages JSONB DEFAULT '[]'::jsonb
      )
    `);

    // Create message_history table if it doesn't exist
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS message_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id),
        message_text TEXT,
        message_type TEXT,
        sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create goal_progress table if it doesn't exist
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS goal_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id),
        goal TEXT,
        status TEXT,
        start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        completion_date TIMESTAMP WITH TIME ZONE,
        notes TEXT
      )
    `);

    // Check for missing columns using information_schema
    const result = await this.db.query(`
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
      await this.db.query(update);
    }
  }

  private ensureConnection() {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.db;
  }

  async getNextMotivationMessage(userId: number): Promise<string | null> {
    const user = await this.getUser(userId);
    if (!user?.customMotivationMessages?.length) {
      return null;
    }

    if (!this.db) {
      throw new Error("Database connection is not established.");
    }

    if (this.db === null) {
      throw new Error("Database connection is not established.");
    }

    // Get a random message using PostgreSQL's random() function
    const result = await this.db.query(
      `
      SELECT jsonb_array_elements_text(custom_motivation_messages) as message
      FROM users
      WHERE user_id = $1
      OFFSET floor(random() * jsonb_array_length(custom_motivation_messages))
      LIMIT 1
    `,
      [userId]
    );

    return result.rows[0]?.message || null;
  }

  async updateMotivationMessages(
    userId: number,
    messages: string[]
  ): Promise<void> {
    const db = this.ensureConnection();
    await db.query(
      "UPDATE users SET custom_motivation_messages = $1::jsonb WHERE user_id = $2",
      [JSON.stringify(messages), userId]
    );
  }

  async saveUser(profile: UserProfile): Promise<void> {
    const db = this.ensureConnection();

    await db.query(
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
  }

  async getUser(userId: number): Promise<UserProfile | null> {
    const db = this.ensureConnection();

    const result = await db.query("SELECT * FROM users WHERE user_id = $1", [
      userId,
    ]);
    const user = result.rows[0];

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
    const db = this.ensureConnection();

    const result = await db.query("SELECT * FROM users");

    return result.rows.map((user) => ({
      userId: user.user_id,
      username: user.username,
      goals: user.goals,
      motivationFrequency: user.motivation_frequency,
      checkInEnabled: user.check_in_enabled,
      timezone: user.timezone,
      lastMessageDate: new Date(user.last_message_date),
      customMotivationMessages: user.custom_motivation_messages,
    }));
  }

  async getUsersForMotivation(): Promise<UserProfile[]> {
    const db = this.ensureConnection();

    const result = await db.query(`
      SELECT * FROM users 
      WHERE last_message_date <= CURRENT_TIMESTAMP - (motivation_frequency || ' days')::interval
    `);

    return result.rows.map((user) => ({
      userId: user.user_id,
      username: user.username,
      goals: user.goals,
      motivationFrequency: user.motivation_frequency,
      checkInEnabled: user.check_in_enabled,
      timezone: user.timezone,
      lastMessageDate: new Date(user.last_message_date),
      customMotivationMessages: user.custom_motivation_messages,
    }));
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
    const db = this.ensureConnection();

    await db.query(
      "INSERT INTO message_history (user_id, message_text, message_type) VALUES ($1, $2, $3)",
      [userId, messageText, messageType]
    );
  }

  async saveGoalProgress(
    userId: number,
    goal: string,
    status: "active" | "completed" | "abandoned",
    notes?: string
  ): Promise<void> {
    const db = this.ensureConnection();

    await db.query(
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
  }

  async getGoalProgress(userId: number): Promise<any[]> {
    const db = this.ensureConnection();

    const result = await db.query(
      "SELECT * FROM goal_progress WHERE user_id = $1 ORDER BY start_date DESC",
      [userId]
    );
    return result.rows;
  }

  async updateGoalStatus(
    goalId: number,
    status: "active" | "completed" | "abandoned",
    notes?: string
  ): Promise<void> {
    const db = this.ensureConnection();

    await db.query(
      `
      UPDATE goal_progress 
      SET status = $1,
          completion_date = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
          notes = COALESCE($2, notes)
      WHERE id = $3
    `,
      [status, notes, goalId]
    );
  }

  async getRecentMessages(userId: number, limit: number): Promise<any[]> {
    const db = this.ensureConnection();

    const result = await db.query(
      `
      SELECT message_text, message_type, sent_at 
      FROM message_history 
      WHERE user_id = $1 
      ORDER BY sent_at DESC 
      LIMIT $2
    `,
      [userId, limit]
    );

    return result.rows;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.end();
      this.db = null;
    }
  }
}
