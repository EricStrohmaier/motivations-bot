import { DatabaseClient } from "./client";
import { initializeTables } from "./schema";
import { UserService } from "./services/user-service";
import { MessageService } from "./services/message-service";
import { GoalService } from "./services/goal-service";

export class DatabaseService {
  private dbClient: DatabaseClient;
  public users: UserService;
  public messages: MessageService;
  public goals: GoalService;

  constructor() {
    this.dbClient = new DatabaseClient();
    this.users = new UserService(this.dbClient);
    this.messages = new MessageService(this.dbClient);
    this.goals = new GoalService(this.dbClient);
  }

  async initialize(): Promise<void> {
    await this.dbClient.initialize();
    const client = await this.dbClient.getClient();
    try {
      await initializeTables(client);
    } finally {
      client.release();
    }
  }

  async ensureConnection(): Promise<void> {
    await this.dbClient.ensureConnection();
  }

  async close(): Promise<void> {
    await this.dbClient.close();
  }
}

export * from "./types";
