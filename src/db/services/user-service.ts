import { DatabaseClient } from "../client";
import { UserProfile } from "../../types";

export class UserService {
  constructor(private dbClient: DatabaseClient) {}

  async saveUser(profile: UserProfile): Promise<void> {
    const client = await this.dbClient.getClient();

    try {
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
    } finally {
      client.release();
    }
  }

  async getUser(userId: number): Promise<UserProfile | null> {
    const client = await this.dbClient.getClient();

    try {
      const result = await client.query(
        "SELECT * FROM users WHERE user_id = $1",
        [userId]
      );
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
    } finally {
      client.release();
    }
  }

  async getAllUsers(): Promise<UserProfile[]> {
    const client = await this.dbClient.getClient();

    try {
      const result = await client.query("SELECT * FROM users");

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
    } finally {
      client.release();
    }
  }

  async getUsersForMotivation(): Promise<UserProfile[]> {
    const client = await this.dbClient.getClient();

    try {
      const result = await client.query(`
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
    } finally {
      client.release();
    }
  }
}
