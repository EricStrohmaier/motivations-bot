// src/bot.ts
import { Telegraf, session } from "telegraf";
import { DatabaseService } from "./db";
import { ClaudeService } from "./claude-service";
import { scheduleJob } from "node-schedule";
import { parseGoalAndDeadline } from "./helper";
import { UserProfile } from "./types";

export class MotivationBot {
  private bot: Telegraf;
  private db: DatabaseService;
  private claude: ClaudeService;

  constructor(
    telegramToken: string,
    claudeApiKey: string,
    dbService: DatabaseService // Add database service parameter
  ) {
    this.bot = new Telegraf(telegramToken);
    this.db = dbService; // Use the provided database service
    this.claude = new ClaudeService(claudeApiKey, dbService);

    this.setupMiddleware();
    this.setupCommands();
    this.setupScheduler();
    this.setBotCommands().catch(console.error); // Add this line
  }

  private setupMiddleware(): void {
    this.bot.use(session());
  }

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
  ];

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
      { command: "help", description: "Show help message" },
    ]);
  }
  private setupCommands(): void {
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

    this.bot.action("add_message", async (ctx: any) => {
      await ctx.reply("Please enter your new motivation message:");
      ctx.session = { step: "adding_message" };
      await ctx.answerCbQuery();
    });

    this.bot.action("view_messages", async (ctx) => {
      const user = await this.db.getUser(ctx.from!.id);
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
    });

    this.bot.action("reset_messages", async (ctx) => {
      try {
        // Get user and handle non-existence
        const user = await this.db.getUser(ctx.from!.id);
        if (!user) {
          await ctx.reply("Please set up your profile first using /setup");
          await ctx.answerCbQuery();
          return;
        }

        // Update user object with default messages
        const updatedUser = {
          ...user,
          customMotivationMessages: [...this.defaultMotivationMessages],
        };

        // Save to database
        await this.db.saveUser(updatedUser);

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
    });

    this.bot.action("test_message", async (ctx) => {
      try {
        const user = await this.db.getUser(ctx.from!.id);
        const message = await this.claude.generateMotivationalMessage(
          user as UserProfile
        );
        await ctx.reply(`Test message:\n\n${message}`);
      } catch (error) {
        await ctx.reply("Sorry, I couldn't generate a test message right now.");
      }
      await ctx.answerCbQuery();
    });

    this.bot.command("clear_messages", async (ctx) => {
      const user = await this.db.getUser(ctx.from.id);
      if (!user) {
        await ctx.reply("Please use /setup first to create your profile.");
        return;
      }

      user.customMotivationMessages = [];
      await this.db.saveUser(user);

      await ctx.reply(
        "✅ Messages cleared! Now using AI-generated motivation messages."
      );
    });

    this.bot.command("togglecheckins", async (ctx) => {
      const user = await this.db.getUser(ctx.from.id);
      if (!user) {
        await ctx.reply("Please use /setup first to create your profile.");
        return;
      }

      user.checkInEnabled = !user.checkInEnabled;
      await this.db.saveUser(user);

      await ctx.reply(
        user.checkInEnabled
          ? "✅ Daily check-ins have been enabled! You'll receive messages at 9 AM and 9 PM."
          : "❌ Daily check-ins have been disabled."
      );
    });

    this.bot.command("test_reminders", async (ctx) => {
      await ctx.reply("🔍 Testing deadline reminders...");

      try {
        // Force current hour to test different times
        const testHours = [9, 14, 20];

        for (const hour of testHours) {
          await ctx.reply(`Testing reminders for ${hour}:00`);

          // Override current date for testing
          const testDate = new Date();
          testDate.setHours(hour, 0, 0, 0);

          await this.checkDeadlines(testDate);
        }

        await ctx.reply("✅ Reminder test completed!");
      } catch (error) {
        console.error("Error testing reminders:", error);
        await ctx.reply("❌ Error testing reminders");
      }
    });

    // Add this to your setupCommands method
    this.bot.command("check_logs", async (ctx) => {
      try {
        const logs = await this.db.getRecentMessages(ctx.from.id, 5);

        if (logs.length === 0) {
          await ctx.reply("No message history found yet.");
          return;
        }

        const logMessage = logs
          .map((log) => {
            const date = new Date(log.sent_at).toLocaleString();
            const type =
              log.message_type === "motivation"
                ? "💪 Motivation"
                : log.message_type === "progress_update"
                ? "📊 Progress"
                : log.message_type === "goal_completion"
                ? "✅ Completion"
                : "📝 Message";

            return `${type} - ${date}\n${log.message_text}`;
          })
          .join("\n\n---\n\n");

        await ctx.reply(`Recent notifications:\n\n${logMessage}`);
      } catch (error) {
        console.error("Error checking logs:", error);
        await ctx.reply(
          "Sorry, there was an error retrieving your message history. Please try again later."
        );
      }
    });

    // Start command
    this.bot.command("start", async (ctx) => {
      const welcomeMessage = `
Welcome to your Personal Motivation Bot! 🌟

I'm here to help you stay motivated and achieve your goals. Here are the commands you can use:

/setup - Set up your profile and preferences
/goals - Manage your goals
/messages - Manage your motivation messages
/progress - Track your progress
/help - Show this help message

Let's begin by setting up your profile with /setup
`;
      await ctx.reply(welcomeMessage);
    });

    // Setup profile flow
    this.bot.command("setup", this.handleSetupCommand.bind(this));

    // Goals management
    this.bot.command("goals", this.handleGoalsCommand.bind(this));

    // Add New Goal handler
    this.bot.action("add_goal", async (ctx: any) => {
      await ctx.reply(
        "What's your new goal? Please describe it (include deadline if any)"
      );
      ctx.session = { step: "adding_goal" };
      await ctx.answerCbQuery();
    });

    // View Goals handler
    this.bot.action("view_goals", async (ctx) => {
      try {
        const user = await this.db.getUser(ctx.from!.id);
        if (!user || user.goals.length === 0) {
          await ctx.reply(
            "You haven't set any goals yet. Use the 'Add New Goal' button to get started!"
          );
          await ctx.answerCbQuery();
          return;
        }

        const goalsMessage = user.goals
          .map((goal, index) => {
            let goalText = `${index + 1}. ${goal.text} (Priority: ${
              goal.priority
            })`;
            if (goal.deadline) {
              const deadline = new Date(goal.deadline);
              const daysUntil = Math.ceil(
                (deadline.getTime() - new Date().getTime()) /
                  (1000 * 60 * 60 * 24)
              );
              goalText += `\n   📅 Due: ${deadline.toLocaleDateString()}`;
              if (daysUntil > 0) {
                goalText += ` (${daysUntil} days remaining)`;
              } else if (daysUntil === 0) {
                goalText += " (Due today!)";
              } else {
                goalText += " (Overdue)";
              }
            }
            return goalText;
          })
          .join("\n\n");

        await ctx.reply(
          `Your current goals:\n\n${goalsMessage}\n\nAdd a deadline to your goals by including "by [date]" or "deadline [date]" when creating them.`
        );
        await ctx.answerCbQuery();
      } catch (error) {
        console.error("Error viewing goals:", error);
        await ctx.reply(
          "Sorry, I couldn't retrieve your goals. Please try again."
        );
        await ctx.answerCbQuery();
      }
    });

    // Mark Goal Complete handler
    this.bot.action("complete_goal", async (ctx) => {
      try {
        const user = await this.db.getUser(ctx.from!.id);
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
    });

    // Handle goal completion selection
    this.bot.action(/complete_goal_(\d+)/, async (ctx) => {
      try {
        const goalIndex = parseInt(ctx.match[1]);
        const user = await this.db.getUser(ctx.from!.id);

        if (!user || !user.goals[goalIndex]) {
          await ctx.reply("Goal not found.");
          await ctx.answerCbQuery();
          return;
        }

        const completedGoal = user.goals[goalIndex];

        // Save to goal progress
        await this.db.saveGoalProgress(
          user.userId,
          completedGoal.text,
          "completed",
          "Completed via bot command"
        );

        // Remove the completed goal from the list
        user.goals.splice(goalIndex, 1);
        await this.db.saveUser(user);

        const celebrationEmojis = ["🎉", "🎊", "🌟", "⭐", "🏆", "✨"];
        const randomEmoji =
          celebrationEmojis[
            Math.floor(Math.random() * celebrationEmojis.length)
          ];

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
    });

    // Progress tracking
    this.bot.command("progress", this.handleProgressCommand.bind(this));

    this.bot.command("motivate", async (ctx) => {
      try {
        const user = await this.db.getUser(ctx.from.id);
        console.log(user);
        if (!user) {
          await ctx.reply("Please use /setup first to create your profile.");
          return;
        }
        const message = await this.claude.generateMotivationalMessage(user);
        await ctx.reply(message);
        await this.db.logMessage(ctx.from.id, message, "motivation");
      } catch (error) {
        console.error("Error generating test motivation:", error);
        await ctx.reply(
          "Sorry, I couldn't generate a motivation message right now. Please try again later."
        );
      }
    });

    // Handle regular messages
    this.bot.on("text", this.handleMessage.bind(this));
  }

  private async handleSetupCommand(ctx: any): Promise<void> {
    await ctx.reply(
      "Let's set up your profile! First, what's your timezone? (e.g., 'Europe/London', 'America/New_York')"
    );
    ctx.session = { step: "timezone" };
  }

  private async handleGoalsCommand(ctx: any): Promise<void> {
    const keyboard = {
      inline_keyboard: [
        [{ text: "➕ Add New Goal", callback_data: "add_goal" }],
        [{ text: "📊 View Goals", callback_data: "view_goals" }],
        [{ text: "✅ Mark Goal Complete", callback_data: "complete_goal" }],
      ],
    };

    await ctx.reply("Goal Management:", { reply_markup: keyboard });
  }

  private async handleProgressCommand(ctx: any): Promise<void> {
    const user = await this.db.getUser(ctx.from.id);
    if (!user) {
      await ctx.reply("Please use /setup first to create your profile.");
      return;
    }

    const progress = await this.db.getGoalProgress(ctx.from.id);
    const progressMessage = this.formatProgressMessage(progress);
    await ctx.reply(progressMessage);
  }

  private async handleMessage(ctx: any): Promise<void> {
    const userId = ctx.from.id;
    const messageText = ctx.message.text;
    if (ctx.session?.step === "adding_message") {
      const user = await this.db.getUser(ctx.from.id);
      if (!user) {
        await ctx.reply("Please set up your profile first using /setup");
        return;
      }

      if (!user.customMotivationMessages) {
        user.customMotivationMessages = [];
      }

      user.customMotivationMessages.push(ctx.message.text);
      await this.db.saveUser(user);

      await ctx.reply(
        "✅ New motivation message added! Use /messages to manage your messages."
      );
      delete ctx.session.step;
      return;
    }
    // Handle setup and configuration steps
    if (ctx.session?.step) {
      let userProfile = (await this.db.getUser(userId)) || {
        userId,
        username: ctx.from.username || "",
        goals: [],
        motivationFrequency: 2,
        timezone: "UTC",
        checkInEnabled: true,
        lastMessageDate: new Date(),
      };

      switch (ctx.session.step) {
        case "timezone":
          try {
            // Validate timezone
            Intl.DateTimeFormat(undefined, { timeZone: messageText });
            userProfile.timezone = messageText;
            await ctx.reply(
              "Great! Now, would you like to receive daily check-ins (morning and evening)? Reply with yes/no"
            );
            ctx.session.step = "check_ins";
          } catch (e) {
            await ctx.reply(
              "Invalid timezone. Please provide a valid timezone (e.g., 'Europe/London', 'America/New_York')"
            );
          }
          return;

        case "check_ins":
          userProfile.checkInEnabled = messageText
            .toLowerCase()
            .includes("yes");
          await ctx.reply(
            "Perfect! Now, do you want to set up custom motivation messages? Reply /messages to get started."
          );
          ctx.session.step = "adding_message";
          return;

        case "goals":
          const newGoal = {
            text: messageText,
            priority: "medium",
            createdAt: new Date(),
          };
          //   @ts-ignore
          userProfile.goals.push(newGoal);
          await this.db.saveUser(userProfile as UserProfile);
          await ctx.reply(
            "Profile setup complete! You'll receive regular motivation messages."
          );
          delete ctx.session.step;
          return;

        case "adding_goal":
          const { goalText, deadline } = parseGoalAndDeadline(messageText);
          const goalToAdd = {
            text: goalText,
            priority: "medium",
            deadline: deadline,
            createdAt: new Date(),
          };

          if (!Array.isArray(userProfile.goals)) {
            userProfile.goals = [];
          }
          //   @ts-ignore
          userProfile.goals.push(goalToAdd);
          await this.db.saveUser(userProfile as UserProfile);

          let confirmationMessage = `✨ Great! I've added your new goal:\n"${goalToAdd.text}"`;
          if (deadline) {
            confirmationMessage += `\nDeadline: ${deadline.toLocaleDateString()}`;
          }
          confirmationMessage +=
            "\n\nYou can view all your goals or add more using /goals";

          await ctx.reply(confirmationMessage);
          delete ctx.session.step;
          return;

        case "scheduling":
          // Handle scheduling-specific messages if needed
          return;
      }
    }

    // Don't process commands through AI
    if (messageText.startsWith("/")) {
      return;
    }

    // Handle general messages with AI
    try {
      const userProfile = await this.db.getUser(userId);
      if (!userProfile) {
        await ctx.reply(
          "Hi! I don't recognize you yet. Please use /setup to create your profile first!"
        );
        return;
      }

      await ctx.sendChatAction("typing");
      const message = await this.claude.generateContextualResponse(
        messageText,
        userProfile
      );
      await ctx.reply(message);
    } catch (error) {
      console.error("Error handling message:", error);
      await ctx.reply(
        "Sorry, I had trouble processing that. Please try again."
      );
    }
  }
  private async checkDeadlines(testDate?: Date): Promise<void> {
    const users = await this.db.getAllUsers();
    const now = new Date();
    const currentHour = now.getHours();

    for (const user of users) {
      try {
        if (!Array.isArray(user.goals)) continue;

        for (const goal of user.goals) {
          if (!goal.deadline) continue;

          const deadline = new Date(goal.deadline);
          const daysUntil = Math.ceil(
            (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Customize message based on time of day
          let timeContext = "";
          if (currentHour === 9) {
            timeContext = "Start your day strong! ";
          } else if (currentHour === 14) {
            timeContext = "Afternoon check-in: ";
          } else if (currentHour === 20) {
            timeContext = "Evening reminder: ";
          }

          let reminderMessage = "";

          if (daysUntil === 0) {
            // Due today - different message for each time
            if (currentHour === 9) {
              reminderMessage = `🚨 ${timeContext}Today is the deadline for "${goal.text}"!\nYou've got a full day ahead to complete this. You can do it! 💪`;
            } else if (currentHour === 14) {
              reminderMessage = `⏰ ${timeContext}Your goal "${goal.text}" is due today.\nHow's your progress? Still on track to complete it?`;
            } else if (currentHour === 20) {
              reminderMessage = `🌙 ${timeContext}Your goal "${goal.text}" is due today.\nLet's make sure you finish it before the day ends!`;
            }
          } else if (daysUntil === 1) {
            // Due tomorrow - each check provides different info
            if (currentHour === 9) {
              reminderMessage = `⏰ ${timeContext}Your goal "${goal.text}" is due tomorrow.\nLet's make significant progress today!`;
            } else if (currentHour === 14) {
              reminderMessage = `📊 ${timeContext}One day left for "${goal.text}".\nTake some time this afternoon to work on it!`;
            } else if (currentHour === 20) {
              reminderMessage = `🎯 ${timeContext}"${goal.text}" is due tomorrow.\nConsider planning your schedule to finish it!`;
            }
          } else if (daysUntil === 3) {
            // Send only once per day at 9 AM
            if (currentHour === 9) {
              reminderMessage = `⚡ Three days left for "${goal.text}"!\nTime to kick it into high gear!`;
            }
          } else if (daysUntil === 7) {
            // Send only once per day at 9 AM
            if (currentHour === 9) {
              reminderMessage = `📅 One week until "${goal.text}" is due.\nMake sure you're on track!`;
            }
          } else if (daysUntil < 0) {
            // Overdue - send only once at 9 AM
            const daysPast = Math.abs(daysUntil);
            if (daysPast === 1 && currentHour === 9) {
              reminderMessage = `❗ Your goal "${goal.text}" is now overdue.\nWould you like to update the deadline or mark it as complete?`;
            }
          }

          if (reminderMessage) {
            await this.bot.telegram.sendMessage(user.userId, reminderMessage);
            await this.db.logMessage(
              user.userId,
              reminderMessage,
              "progress_update"
            );
          }
        }
      } catch (error) {
        console.error(
          `Failed to process deadlines for user ${user.userId}:`,
          error
        );
      }
    }
  }

  // Modify setupScheduler to handle timezone-specific scheduling
  private setupScheduler(): void {
    // Morning check-in (9 AM in user's timezone)
    scheduleJob("0 * * * *", async () => {
      const users = await this.db.getAllUsers();
      for (const user of users) {
        if (!user.checkInEnabled) continue;

        try {
          const userTime = new Date().toLocaleString("en-US", {
            timeZone: user.timezone,
          });
          const userDate = new Date(userTime);

          // Check if it's 9 AM in user's timezone
          if (userDate.getHours() === 9 && userDate.getMinutes() === 0) {
            const message =
              "🌅 Good morning! What's your smallest achievable goal for today?";
            await this.bot.telegram.sendMessage(user.userId, message);
            await this.db.logMessage(user.userId, message, "check_in");
          }

          // Check if it's 4 PM for motivation message
          if (userDate.getHours() === 16 && userDate.getMinutes() === 0) {
            const motivationMessage =
              await this.claude.generateMotivationalMessage(user);
            await this.bot.telegram.sendMessage(user.userId, motivationMessage);
            await this.db.logMessage(
              user.userId,
              motivationMessage,
              "motivation"
            );
          }

          // Evening check-in (9 PM in user's timezone)
          if (userDate.getHours() === 21 && userDate.getMinutes() === 0) {
            const message =
              "🌙 Evening check-in! Did you manage to achieve your goals today?";
            await this.bot.telegram.sendMessage(user.userId, message);
            await this.db.logMessage(user.userId, message, "check_in");
          }
        } catch (error) {
          console.error(
            `Failed to process schedule for user ${user.userId}:`,
            error
          );
        }
      }
    });

    // Keep the existing deadline checks
    scheduleJob("0 9,14,20 * * *", () => this.checkDeadlines());
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

  public start(): void {
    this.bot.launch();
    console.log("Bot started");
  }

  public stop(): void {
    this.bot.stop();
  }
}
