// src/bot.ts
import { Telegraf, session } from "telegraf";
import { DatabaseService } from "./db/index";
import { ClaudeService } from "./claude-service";
import { CommandHandler } from "./bot/handlers/command-handler";
import { MessageHandler } from "./bot/handlers/message-handler";
import { ActionHandler } from "./bot/handlers/action-handler";
import { SchedulerService } from "./bot/services/scheduler-service";

export class MotivationBot {
  private bot: Telegraf;
  private db: DatabaseService;
  private claude: ClaudeService;
  private commandHandler: CommandHandler;
  private messageHandler: MessageHandler;
  private actionHandler: ActionHandler;
  private schedulerService: SchedulerService;

  constructor(
    telegramToken: string,
    claudeApiKey: string,
    dbService: DatabaseService
  ) {
    this.bot = new Telegraf(telegramToken);
    this.db = dbService;
    this.claude = new ClaudeService(claudeApiKey, dbService);

    // Initialize handlers
    this.commandHandler = new CommandHandler(this.db, this.claude);
    this.messageHandler = new MessageHandler(this.db, this.claude);
    this.actionHandler = new ActionHandler(this.db, this.claude);
    this.schedulerService = new SchedulerService(
      this.bot,
      this.db,
      this.claude
    );

    this.setupMiddleware();
    this.setupCommands();
    this.setupScheduler();
    this.setBotCommands().catch(console.error);
  }

  private setupMiddleware(): void {
    this.bot.use(session());
  }

  private async setBotCommands(): Promise<void> {
    await this.bot.telegram.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "setup", description: "Set up your profile" },
      { command: "goals", description: "Manage your goals" },
      { command: "messages", description: "Manage your motivation messages" },
      { command: "progress", description: "Track your progress" },
      {
        command: "motivate",
        description: "Get an immediate motivation message",
      },
      {
        command: "togglecheckins",
        description: "Toggle check-in reminders on/off",
      },
      { command: "help", description: "Show help message" },
    ]);
  }

  private setupCommands(): void {
    // Message management
    this.bot.command("messages", async (ctx) => {
      const keyboard = {
        inline_keyboard: [
          [{ text: "➕ Add New Message", callback_data: "add_message" }],
          [{ text: "📝 View Messages", callback_data: "view_messages" }],
          [{ text: "🔄 Reset to Defaults", callback_data: "reset_messages" }],
          [{ text: "🎲 Test Random Message", callback_data: "test_message" }],
          [{ text: "✅ Clear All Messages", callback_data: "clear_messages" }],
        ],
      };

      await ctx.reply(
        "Manage your motivation messages. These will be used for daily motivation instead of AI-generated ones:",
        { reply_markup: keyboard }
      );
    });

    // Command handlers
    this.bot.command(
      "start",
      this.commandHandler.handleStartCommand.bind(this.commandHandler)
    );
    this.bot.command(
      "setup",
      this.commandHandler.handleSetupCommand.bind(this.commandHandler)
    );
    this.bot.command(
      "goals",
      this.commandHandler.handleGoalsCommand.bind(this.commandHandler)
    );
    this.bot.command(
      "progress",
      this.commandHandler.handleProgressCommand.bind(this.commandHandler)
    );
    this.bot.command(
      "motivate",
      this.commandHandler.handleMotivateCommand.bind(this.commandHandler)
    );
    this.bot.command(
      "togglecheckins",
      this.commandHandler.handleToggleCheckinsCommand.bind(this.commandHandler)
    );

    // Action handlers
    this.bot.action(
      "add_message",
      this.actionHandler.handleAddMessage.bind(this.actionHandler)
    );
    this.bot.action(
      "view_messages",
      this.actionHandler.handleViewMessages.bind(this.actionHandler)
    );
    this.bot.action(
      "reset_messages",
      this.actionHandler.handleResetMessages.bind(this.actionHandler)
    );
    this.bot.action(
      "test_message",
      this.actionHandler.handleTestMessage.bind(this.actionHandler)
    );
    this.bot.action(
      "clear_messages",
      this.actionHandler.handleClearMessages.bind(this.actionHandler)
    );
    this.bot.action("add_goal", async (ctx: any) => {
      await ctx.reply(
        "What's your new goal? Please describe it (include deadline if any)"
      );

      ctx.session = { step: "adding_goal" };
      await ctx.answerCbQuery();
    });
    this.bot.action("view_goals", async (ctx) => {
      const user = await this.db.users.getUser(ctx.from!.id);
      if (!user || user.goals.length === 0) {
        await ctx.reply(
          "You haven't set any goals yet. Use the 'Add New Goal' button to get started!"
        );
        await ctx.answerCbQuery();
        return;
      }
      await this.actionHandler.handleViewGoals(ctx, user);
    });
    this.bot.action(
      "complete_goal",
      this.actionHandler.handleCompleteGoal.bind(this.actionHandler)
    );
    this.bot.action(/complete_goal_(\d+)/, (ctx: any) => {
      const goalIndex = parseInt(ctx.match[1]);
      return this.actionHandler.handleGoalCompletion(ctx, goalIndex);
    });

    // Message handler
    this.bot.on(
      "text",
      this.messageHandler.handleMessage.bind(this.messageHandler)
    );
  }

  private setupScheduler(): void {
    this.schedulerService.setupScheduler();
  }

  public start(): void {
    this.bot.launch();
  }

  public stop(): void {
    this.bot.stop();
  }
}
