// src/services/database.service.ts
import { Database } from "sqlite";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { UserProfile } from "./types";

export class DatabaseService {
  private db: Database | null = null;

  async initialize(): Promise<void> {
    this.db = await open({
      filename:
        process.env.NODE_ENV === "production"
          ? "/usr/src/app/data/motivation_bot.db"
          : "motivation_bot.db",
      driver: sqlite3.Database,
    });
    const db = this.ensureConnection();

    // Create or update users table
    await db.run(`
      CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        goals TEXT,
        motivation_frequency INTEGER,
        timezone TEXT DEFAULT 'UTC',
        check_in_enabled INTEGER DEFAULT 1,
        last_message_date TEXT,
        custom_motivation_messages TEXT DEFAULT '[]'
      )
    `);

    // Add any missing columns (safe to run multiple times)
    const columns = await db.all("PRAGMA table_info(users)");
    const columnNames = columns.map((col) => col.name);

    if (!columnNames.includes("custom_motivation_messages")) {
      await db.run(
        "ALTER TABLE users ADD COLUMN custom_motivation_messages TEXT DEFAULT '[]'"
      );
    }

    if (!columnNames.includes("timezone")) {
      await db.run("ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'UTC'");
    }

    if (!columnNames.includes("check_in_enabled")) {
      await db.run(
        "ALTER TABLE users ADD COLUMN check_in_enabled INTEGER DEFAULT 1"
      );
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

    // Get a random message from the array
    const randomIndex = Math.floor(
      Math.random() * user.customMotivationMessages.length
    );
    return user.customMotivationMessages[randomIndex];
  }

  async updateMotivationMessages(
    userId: number,
    messages: string[]
  ): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    user.customMotivationMessages = messages;
    await this.saveUser(user);
  }

  async saveUser(profile: UserProfile): Promise<void> {
    const db = this.ensureConnection();
    const serializedMessages = JSON.stringify(
      profile.customMotivationMessages || []
    );

    await db.run(
      `INSERT OR REPLACE INTO users (
        user_id, 
        username, 
        goals, 
        motivation_frequency,
        timezone,
        check_in_enabled,
        last_message_date,
        custom_motivation_messages
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.userId,
        profile.username,
        JSON.stringify(profile.goals),
        profile.motivationFrequency,
        profile.timezone,
        profile.checkInEnabled ? 1 : 0,
        profile.lastMessageDate.toISOString(),
        serializedMessages,
      ]
    );
  }

  async getUser(userId: number): Promise<UserProfile | null> {
    const db = this.ensureConnection();

    const user = await db.get("SELECT * FROM users WHERE user_id = ?", [
      userId,
    ]);

    if (!user) return null;

    return {
      userId: user.user_id,
      username: user.username,
      goals: JSON.parse(user.goals || "[]"),
      motivationFrequency: user.motivation_frequency,
      checkInEnabled: user.check_in_enabled,
      timezone: user.timezone,
      lastMessageDate: new Date(user.last_message_date),
      customMotivationMessages: JSON.parse(
        user.custom_motivation_messages || "[]"
      ),
    };
  }

  async getAllUsers(): Promise<UserProfile[]> {
    const db = this.ensureConnection();

    const users = await db.all("SELECT * FROM users");

    return users.map((user) => ({
      userId: user.user_id,
      username: user.username,
      goals: JSON.parse(user.goals || "[]"),
      motivationFrequency: user.motivation_frequency,
      checkInEnabled: user.check_in_enabled,
      timezone: user.timezone,
      lastMessageDate: new Date(user.last_message_date),
      customMotivationMessages: user.custom_motivation_messages
        ? JSON.parse(user.custom_motivation_messages)
        : [],
    }));
  }

  async getUsersForMotivation(): Promise<UserProfile[]> {
    const db = this.ensureConnection();

    const users = await db.all(`
            SELECT * FROM users 
            WHERE datetime(last_message_date) <= datetime('now', '-' || motivation_frequency || ' days')
        `);

    return users.map((user) => ({
      userId: user.user_id,
      username: user.username,
      goals: JSON.parse(user.goals || "[]"),
      motivationFrequency: user.motivation_frequency,
      checkInEnabled: user.check_in_enabled,
      timezone: user.timezone,
      lastMessageDate: new Date(user.last_message_date),
      customMotivationMessages: user.custom_motivation_messages
        ? JSON.parse(user.custom_motivation_messages)
        : [],
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

    await db.run(
      "INSERT INTO message_history (user_id, message_text, message_type) VALUES (?, ?, ?)",
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

    await db.run(
      `INSERT INTO goal_progress (
                user_id, goal, status, start_date, completion_date, notes
            ) VALUES (?, ?, ?, datetime('now'), CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END, ?)`,
      [userId, goal, status, status, notes]
    );
  }

  async getGoalProgress(userId: number): Promise<any[]> {
    const db = this.ensureConnection();

    return db.all(
      "SELECT * FROM goal_progress WHERE user_id = ? ORDER BY start_date DESC",
      [userId]
    );
  }

  async updateGoalStatus(
    goalId: number,
    status: "active" | "completed" | "abandoned",
    notes?: string
  ): Promise<void> {
    const db = this.ensureConnection();

    await db.run(
      `UPDATE goal_progress 
             SET status = ?, 
                 completion_date = CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END,
                 notes = COALESCE(?, notes)
             WHERE id = ?`,
      [status, status, notes, goalId]
    );
  }

  async getRecentMessages(userId: number, limit: number): Promise<any[]> {
    const db = this.ensureConnection();

    return db.all(
      `SELECT message_text, message_type, sent_at 
         FROM message_history 
         WHERE user_id = ? 
         ORDER BY sent_at DESC 
         LIMIT ?`,
      [userId, limit]
    );
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}
