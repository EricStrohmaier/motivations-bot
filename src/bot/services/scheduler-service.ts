import { Telegraf } from "telegraf";
import { scheduleJob } from "node-schedule";
import { DatabaseService } from "../../db/index";
import { ClaudeService } from "../../claude-service";

export class SchedulerService {
  constructor(
    private bot: Telegraf,
    private db: DatabaseService,
    private claude: ClaudeService
  ) {}

  setupScheduler(): void {
    // Run every hour at the top of the hour
    scheduleJob("0 * * * *", async () => {
      const users = await this.db.users.getAllUsers();
      const now = new Date();

      for (const user of users) {
        if (!user.checkInEnabled) continue;

        try {
          const userTime = new Date().toLocaleString("en-US", {
            timeZone: user.timezone,
          });
          const userDate = new Date(userTime);

          const userHour = userDate.getHours();
          const userMinutes = userDate.getMinutes();
          const isEvenDay = userDate.getDate() % 2 === 0;

          console.log(`Checking schedule for user ${user.userId}:`, {
            userHour,
            userMinutes,
            isEvenDay,
          });

          await this.handleScheduledTasks(user, userHour, isEvenDay);
        } catch (error) {
          console.error(
            `Failed to process schedule for user ${user.userId}:`,
            error
          );
        }
      }
    });
  }

  private async handleScheduledTasks(
    user: any,
    userHour: number,
    isEvenDay: boolean
  ): Promise<void> {
    // Morning check-in at 9 AM on even days
    if (userHour === 9 && isEvenDay) {
      const message =
        "🌅 Good morning! What's your smallest achievable goal for today?";
      await this.bot.telegram.sendMessage(user.userId, message);
      await this.db.messages.logMessage(user.userId, message, "check_in");
      console.log("Sent morning check-in message");
    }

    // Daily motivation message at 12 PM
    if (userHour === 12) {
      const motivationMessage = await this.claude.generateMotivationalMessage(
        user
      );
      await this.bot.telegram.sendMessage(user.userId, motivationMessage);
      await this.db.messages.logMessage(
        user.userId,
        motivationMessage,
        "motivation"
      );
      console.log("Sent motivation message");
    }

    // Evening check-in at 8 PM on even days
    if (userHour === 20 && isEvenDay) {
      const message =
        "🌙 Evening check-in! Did you manage to achieve your goals today?";
      await this.bot.telegram.sendMessage(user.userId, message);
      await this.db.messages.logMessage(user.userId, message, "check_in");
      console.log("Sent evening check-in message");
    }

    await this.checkDeadlines(user);
  }

  private async checkDeadlines(user: any): Promise<void> {
    if (!Array.isArray(user.goals)) return;

    const now = new Date();
    const currentHour = now.getHours();

    for (const goal of user.goals) {
      if (!goal.deadline) continue;

      const deadline = new Date(goal.deadline);
      const daysUntil = Math.ceil(
        (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      const message = this.getDeadlineMessage(goal, daysUntil, currentHour);
      if (message) {
        await this.bot.telegram.sendMessage(user.userId, message);
        await this.db.messages.logMessage(
          user.userId,
          message,
          "progress_update"
        );
      }
    }
  }

  private getDeadlineMessage(
    goal: any,
    daysUntil: number,
    currentHour: number
  ): string | null {
    // Customize message based on time of day
    let timeContext = "";
    if (currentHour === 9) {
      timeContext = "Start your day strong! ";
    } else if (currentHour === 14) {
      timeContext = "Afternoon check-in: ";
    } else if (currentHour === 20) {
      timeContext = "Evening reminder: ";
    }

    if (daysUntil === 0) {
      // Due today - different message for each time
      if (currentHour === 9) {
        return `🚨 ${timeContext}Today is the deadline for "${goal.text}"!\nYou've got a full day ahead to complete this. You can do it! 💪`;
      } else if (currentHour === 14) {
        return `⏰ ${timeContext}Your goal "${goal.text}" is due today.\nHow's your progress? Still on track to complete it?`;
      } else if (currentHour === 20) {
        return `🌙 ${timeContext}Your goal "${goal.text}" is due today.\nLet's make sure you finish it before the day ends!`;
      }
    } else if (daysUntil === 1) {
      // Due tomorrow - each check provides different info
      if (currentHour === 9) {
        return `⏰ ${timeContext}Your goal "${goal.text}" is due tomorrow.\nLet's make significant progress today!`;
      } else if (currentHour === 14) {
        return `📊 ${timeContext}One day left for "${goal.text}".\nTake some time this afternoon to work on it!`;
      } else if (currentHour === 20) {
        return `🎯 ${timeContext}"${goal.text}" is due tomorrow.\nConsider planning your schedule to finish it!`;
      }
    } else if (daysUntil === 3 && currentHour === 9) {
      return `⚡ Three days left for "${goal.text}"!\nTime to kick it into high gear!`;
    } else if (daysUntil === 7 && currentHour === 9) {
      return `📅 One week until "${goal.text}" is due.\nMake sure you're on track!`;
    } else if (daysUntil < 0) {
      // Overdue - send only once at 9 AM
      const daysPast = Math.abs(daysUntil);
      if (daysPast === 1 && currentHour === 9) {
        return `❗ Your goal "${goal.text}" is now overdue.\nWould you like to update the deadline or mark it as complete?`;
      }
    }

    return null;
  }
}
