import { DatabaseClient } from "../client";
import { GoalStatus } from "../types";

export class GoalService {
  constructor(private dbClient: DatabaseClient) {}

  async saveGoalProgress(
    userId: number,
    goal: string,
    status: GoalStatus,
    notes?: string
  ): Promise<void> {
    const client = await this.dbClient.getClient();

    try {
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
    } finally {
      client.release();
    }
  }

  async getGoalProgress(userId: number): Promise<any[]> {
    const client = await this.dbClient.getClient();

    try {
      const result = await client.query(
        "SELECT * FROM goal_progress WHERE user_id = $1 ORDER BY start_date DESC",
        [userId]
      );

      return result.rows;
    } finally {
      client.release();
    }
  }

  async updateGoalStatus(
    goalId: number,
    status: GoalStatus,
    notes?: string
  ): Promise<void> {
    const client = await this.dbClient.getClient();

    try {
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
    } finally {
      client.release();
    }
  }
}
