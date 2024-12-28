import { Context } from "telegraf";
import { DatabaseService } from "../../db/index";
import { ClaudeService } from "../../claude-service";

export class CommandHandler {
  constructor(private db: DatabaseService, private claude: ClaudeService) {}

  async handleSetupCommand(ctx: Context): Promise<void> {
    await ctx.reply(
      "Let's set up your profile! First, what's your timezone? (e.g., 'Europe/London', 'America/New_York')"
    );
    // @ts-ignore
    ctx.session = { step: "timezone" };
  }

  async handleGoalsCommand(ctx: Context): Promise<void> {
    const keyboard = {
      inline_keyboard: [
        [{ text: "➕ Add New Goal", callback_data: "add_goal" }],
        [{ text: "📊 View Goals", callback_data: "view_goals" }],
        [{ text: "✅ Mark Goal Complete", callback_data: "complete_goal" }],
      ],
    };

    await ctx.reply("Goal Management:", { reply_markup: keyboard });
  }

  async handleProgressCommand(ctx: any): Promise<void> {
    const user = await this.db.users.getUser(ctx.from.id);
    if (!user) {
      await ctx.reply("Please use /setup first to create your profile.");
      return;
    }

    const progress = await this.db.goals.getGoalProgress(ctx.from.id);
    const progressMessage = this.formatProgressMessage(progress);
    await ctx.reply(progressMessage);
  }

  async handleStartCommand(ctx: Context): Promise<void> {
    const welcomeMessage = `
Welcome to your Personal Motivation Bot! 🌟

I'm here to help you stay motivated and achieve your goals. Here are the commands you can use:

/setup - Set up your profile and preferences
/goals - Manage your goals
/messages - Manage your motivation messages
/motivate - Get an immediate motivation message
/togglecheckins - Toggle check-in reminders on/off
/help - Show this help message

Let's begin by setting up your profile with /setup
`;
    await ctx.reply(welcomeMessage);
  }

  async handleMotivateCommand(ctx: any): Promise<void> {
    try {
      const user = await this.db.users.getUser(ctx.from.id);
      if (!user) {
        await ctx.reply("Please use /setup first to create your profile.");
        return;
      }
      const message = await this.claude.generateMotivationalMessage(user);
      await ctx.reply(message);
      await this.db.messages.logMessage(ctx.from.id, message, "motivation");
    } catch (error) {
      console.error("Error generating test motivation:", error);
      await ctx.reply(
        "Sorry, I couldn't generate a motivation message right now. Please try again later."
      );
    }
  }

  async handleToggleCheckinsCommand(ctx: any): Promise<void> {
    const user = await this.db.users.getUser(ctx.from.id);
    if (!user) {
      await ctx.reply("Please use /setup first to create your profile.");
      return;
    }

    user.checkInEnabled = !user.checkInEnabled;
    await this.db.users.saveUser(user);

    await ctx.reply(
      user.checkInEnabled
        ? "✅ Daily check-ins have been enabled! You'll receive messages at 9 AM and 9 PM."
        : "❌ Daily check-ins have been disabled."
    );
  }

  private formatProgressMessage(progress: any[]): string {
    return progress
      .map((goal) => {
        const status = goal.status === "completed" ? "✅" : "🔄";
        return `${status} ${goal.goal}\nStarted: ${goal.start_date}${
          goal.completion_date ? `\nCompleted: ${goal.completion_date}` : ""
        }`;
      })
      .join("\n\n");
  }
}
