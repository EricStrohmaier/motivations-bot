import { DatabaseService } from "../../db/index";
import { ClaudeService } from "../../claude-service";
import { UserProfile } from "../../types";

export class ActionHandler {
  private readonly defaultMotivationMessages = [
    "Nothing is as important as you create your music of the future.",
    "I am pretty sure you can find time for this today. If you're low on energy then this action will only bring you more energy than you think and it will take nothing at all, just one hour of your time. And you will still have 11-15 hours of your day left for other stuff.",
    "You are never too late. As a matter of fact, you are always on time in your life. Things always happen in the right place with perfect timing.",
    "You have all the time in the world to finish your track.",
    "Leaving your legacy is the most important mission in your life.",
    "Being creative in a moment is what you like.",
    "When you do music you forget about time and space because you love it.",
    "Someone else is producing tracks right now and you are not. If you start right now, then next year you will have 10 tracks and by the end of 2025 you will have 50 tracks and by the end of 2026 you will have 100 tracks and by 2030 you will be a successful music producer making millions of dollars per year or at least enough money for the happy living.",
    "If you produce one more track this week, then next year you will have 10 tracks and by the end of 2025 you will have 50 tracks and by the end of 2026 you will have 100 tracks and by 2030 you will be a successful music producer making millions of dollars per year or at least enough money for the happy living.",
    "You have already made ~100 hours of composing music since 2021, so you need only 9900 hours to go. If working 1 hour a day, then it's 30 hours per month, and you will gain 90-100 hours in a quarter and about 400 hours per year. If you double this and work 2 hours a day, then 800 hours per year. If you work 5 hours a day, then it's gonna be 1800 hours per year which means that in 5-6 years you will become a professional! But already in 1-2 years, you can get a job in this.",
    "Do one more track for Mom. She likes listening to my tracks and always appreciates it.",
    "Your music should look like you in your perfect outfits every day creative and outstanding. Your catalog of music will be like your wardrobe. People will judge you but also understand you by your music and your work.",
    "Keep going I love you.",
  ];

  constructor(private db: DatabaseService, private claude: ClaudeService) {}

  async handleAddMessage(ctx: any): Promise<void> {
    await ctx.reply("Please enter your new motivation message:");
    ctx.session = { step: "adding_message" };
    await ctx.answerCbQuery();
  }

  async handleViewMessages(ctx: any): Promise<void> {
    const user = await this.db.users.getUser(ctx.from!.id);
    if (!user || !user.customMotivationMessages?.length) {
      await ctx.reply(
        "You don't have any custom messages set. Using AI-generated messages instead."
      );
      await ctx.answerCbQuery();
      return;
    }

    const messages = user.customMotivationMessages
      .map((msg, i) => `${i + 1}. ${msg}`)
      .join("\n\n");

    await ctx.reply(`Your motivation messages:\n\n${messages}`);
    await ctx.answerCbQuery();
  }

  async handleResetMessages(ctx: any): Promise<void> {
    try {
      const user = await this.db.users.getUser(ctx.from!.id);
      if (!user) {
        await ctx.reply("Please set up your profile first using /setup");
        await ctx.answerCbQuery();
        return;
      }

      const updatedUser = {
        ...user,
        customMotivationMessages: [...this.defaultMotivationMessages],
      };

      await this.db.users.saveUser(updatedUser);

      await ctx.reply(
        "✅ Messages reset to default music producer motivation messages!\n\nUse /messages to view them."
      );
    } catch (error) {
      console.error("Error resetting messages:", error);
      await ctx.reply(
        "Sorry, there was an error resetting your messages. Please try again later."
      );
    } finally {
      await ctx.answerCbQuery().catch(console.error);
    }
  }

  async handleTestMessage(ctx: any): Promise<void> {
    try {
      const user = await this.db.users.getUser(ctx.from!.id);
      const message = await this.claude.generateMotivationalMessage(
        user as any
      );
      await ctx.reply(`Test message:\n\n${message}`);
    } catch (error) {
      console.log("Error generating test message:", error);
      await ctx.reply("Sorry, I couldn't generate a test message right now.");
    }
    await ctx.answerCbQuery();
  }

  async handleClearMessages(ctx: any): Promise<void> {
    console.log("Clear messages action triggered");
    try {
      if (!ctx.from) {
        console.error("No from field in context");
        return;
      }

      console.log("Attempting to clear messages for user:", ctx.from.id);
      const user = await this.db.users.getUser(ctx.from.id);

      if (!user) {
        console.log("No user found for clear_messages action");
        await ctx.answerCbQuery("Please set up your profile first");
        return;
      }

      console.log("Clearing messages for user:", user.userId);
      user.customMotivationMessages = [];
      await this.db.users.saveUser(user);

      try {
        await ctx.editMessageText(
          "✅ Messages cleared! Now using AI-generated motivation messages.\n\nUse /messages to return to the messages menu.",
          { reply_markup: undefined }
        );
      } catch (editError) {
        console.error("Error editing message:", editError);
        // Fallback to sending new message if edit fails
        await ctx.reply(
          "✅ Messages cleared! Now using AI-generated motivation messages.\n\nUse /messages to return to the messages menu."
        );
      }

      await ctx.answerCbQuery("Messages cleared successfully!");
      console.log("Clear messages action completed successfully");
    } catch (error) {
      console.error("Error in clear_messages action:", error);
      try {
        await ctx.answerCbQuery("Error clearing messages. Please try again.");
      } catch (cbError) {
        console.error("Error sending callback query answer:", cbError);
      }
      try {
        await ctx.reply(
          "Sorry, there was an error clearing your messages. Please try again."
        );
      } catch (replyError) {
        console.error("Error sending error reply:", replyError);
      }
    }
  }

  async handleCompleteGoal(ctx: any): Promise<void> {
    try {
      const user = await this.db.users.getUser(ctx.from!.id);
      if (!user || user.goals.length === 0) {
        await ctx.reply("You don't have any goals to mark as complete.");
        await ctx.answerCbQuery();
        return;
      }

      // Create inline keyboard with all goals
      const keyboard = {
        inline_keyboard: user.goals.map((goal, index) => [
          {
            text: `${index + 1}. ${goal.text}`,
            callback_data: `complete_goal_${index}`,
          },
        ]),
      };

      await ctx.reply("Select the goal you've completed:", {
        reply_markup: keyboard,
      });
      await ctx.answerCbQuery();
    } catch (error) {
      console.error("Error marking goal complete:", error);
      await ctx.reply(
        "Sorry, I couldn't process your request. Please try again."
      );
      await ctx.answerCbQuery();
    }
  }

  async handleGoalCompletion(ctx: any, goalIndex: number): Promise<void> {
    try {
      const user = await this.db.users.getUser(ctx.from!.id);

      if (!user || !user.goals[goalIndex]) {
        await ctx.reply("Goal not found.");
        await ctx.answerCbQuery();
        return;
      }

      const completedGoal = user.goals[goalIndex];

      // Save to goal progress
      await this.db.goals.saveGoalProgress(
        user.userId,
        completedGoal.text,
        "completed",
        "Completed via bot command"
      );

      // Remove the completed goal from the list
      user.goals.splice(goalIndex, 1);
      await this.db.users.saveUser(user);

      const celebrationEmojis = ["🎉", "🎊", "🌟", "⭐", "🏆", "✨"];
      const randomEmoji =
        celebrationEmojis[Math.floor(Math.random() * celebrationEmojis.length)];

      await ctx.editMessageText(
        `${randomEmoji} Congratulations! You've completed your goal: "${completedGoal.text}"!\n\nKeep up the great work! Use /goals to manage your remaining goals.`
      );

      await ctx.answerCbQuery("Goal marked as complete! 🎉");
    } catch (error) {
      console.error("Error completing goal:", error);
      await ctx.reply(
        "Sorry, I couldn't mark the goal as complete. Please try again."
      );
      await ctx.answerCbQuery();
    }
  }

  async handleViewGoals(ctx: any, user: UserProfile): Promise<void> {
    if (!user || user.goals.length === 0) {
      await ctx.reply("You don't have any goals set.");
      await ctx.answerCbQuery();
      return;
    }

    const goals = user.goals
      .map((goal, index) => `${index + 1}. ${goal.text}`)
      .join("\n");

    await ctx.reply(`Your goals:\n\n${goals}`);
    await ctx.answerCbQuery();
  }
}
