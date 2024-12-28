import { PoolClient } from "pg";

// Extend PoolClient type to include lastQuery
declare module "pg" {
  interface PoolClient {
    lastQuery?: any[];
  }
}

export type MessageType = "motivation" | "progress_update" | "goal_completion" | "check_in";
export type GoalStatus = "active" | "completed" | "abandoned";
