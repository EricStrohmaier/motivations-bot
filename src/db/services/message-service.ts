import { DatabaseClient } from "../client";
import { MessageType } from "../types";

export class MessageService {
  constructor(private dbClient: DatabaseClient) {}

  async getNextMotivationMessage(userId: number): Promise<string | null> {
    const client = await this.dbClient.getClient();

    try {
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

      return result.rows[0]?.message || null;
    } finally {
      client.release();
    }
  }

  async updateMotivationMessages(
    userId: number,
    messages: string[]
  ): Promise<void> {
    const client = await this.dbClient.getClient();

    try {
      await client.query(
        "UPDATE users SET custom_motivation_messages = $1::jsonb WHERE user_id = $2",
        [JSON.stringify(messages), userId]
      );
    } finally {
      client.release();
    }
  }

  async logMessage(
    userId: number,
    messageText: string,
    messageType: MessageType
  ): Promise<void> {
    const client = await this.dbClient.getClient();

    try {
      await client.query(
        "INSERT INTO message_history (user_id, message_text, message_type) VALUES ($1, $2, $3)",
        [userId, messageText, messageType]
      );
    } finally {
      client.release();
    }
  }

  async getRecentMessages(userId: number, limit: number): Promise<any[]> {
    const client = await this.dbClient.getClient();

    try {
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

      return result.rows;
    } finally {
      client.release();
    }
  }
}
