import { DatabaseService } from "../../db/index";
import { ClaudeService } from "../../claude-service";
import { UserProfile } from "../../types";
import { parseGoalAndDeadline } from "../../helper";
import { createWriteStream, unlink } from "fs";
import { promisify } from "util";
import path from "path";
import { createReadStream } from "fs";
import OpenAI from "openai";

const unlinkAsync = promisify(unlink);

export class MessageHandler {
  private openai?: OpenAI;

  constructor(
    private db: DatabaseService,
    private claude: ClaudeService,
    openaiApiKey?: string
  ) {
    if (openaiApiKey) {
      this.openai = new OpenAI({ apiKey: openaiApiKey });
    }
  }

  async handleMessage(ctx: any): Promise<void> {
    const userId = ctx.from.id;
    const messageText = ctx.message.text;

    if (ctx.session?.step === "adding_message") {
      await this.handleAddingMessage(ctx);
      return;
    }

    if (ctx.session?.step) {
      await this.handleSetupSteps(ctx, userId, messageText);
      return;
    }

    // Don't process commands through AI
    if (messageText.startsWith("/")) {
      return;
    }

    if (ctx.message.voice) {
      await this.handleVoiceMessage(ctx);
      return;
    }

    await this.handleGeneralMessage(ctx, userId, messageText);
  }

  private async handleAddingMessage(ctx: any): Promise<void> {
    const user = await this.db.users.getUser(ctx.from.id);
    if (!user) {
      await ctx.reply("Please set up your profile first using /setup");
      return;
    }

    if (!user.customMotivationMessages) {
      user.customMotivationMessages = [];
    }

    user.customMotivationMessages.push(ctx.message.text);
    await this.db.users.saveUser(user);

    await ctx.reply(
      "✅ New motivation message added! Use /messages to manage your messages."
    );
    delete ctx.session.step;
  }

  private async handleSetupSteps(
    ctx: any,
    userId: number,
    messageText: string
  ): Promise<void> {
    let userProfile = (await this.db.users.getUser(userId)) || {
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
        await this.handleTimezoneStep(
          ctx,
          userProfile as UserProfile,
          messageText
        );
        break;

      case "check_ins":
        await this.handleCheckInsStep(
          ctx,
          userProfile as UserProfile,
          messageText
        );
        break;

      case "goals":
        await this.handleGoalsStep(
          ctx,
          userProfile as UserProfile,
          messageText
        );
        break;

      case "adding_goal":
        await this.handleAddingGoalStep(
          ctx,
          userProfile as UserProfile,
          messageText
        );
        break;
    }
  }

  private async handleTimezoneStep(
    ctx: any,
    userProfile: UserProfile,
    messageText: string
  ): Promise<void> {
    try {
      // Validate timezone
      Intl.DateTimeFormat(undefined, { timeZone: messageText });
      userProfile.timezone = messageText;

      // Save the profile immediately after timezone is set
      await this.db.users.saveUser(userProfile);

      await ctx.reply(
        "Great! Now, would you like to receive daily check-ins (morning and evening)? Reply with yes/no"
      );
      ctx.session.step = "check_ins";
    } catch (e) {
      await ctx.reply(
        "Invalid timezone. Please provide a valid timezone (e.g., 'Europe/London', 'America/New_York')"
      );
    }
  }

  private async handleCheckInsStep(
    ctx: any,
    userProfile: UserProfile,
    messageText: string
  ): Promise<void> {
    userProfile.checkInEnabled = messageText.toLowerCase().includes("yes");
    await this.db.users.saveUser(userProfile);

    await ctx.reply(
      "Perfect! Now, do you want to set up custom motivation messages? Reply /messages to get started."
    );
    delete ctx.session.step;
  }

  private async handleGoalsStep(
    ctx: any,
    userProfile: UserProfile,
    messageText: string
  ): Promise<void> {
    const newGoal = {
      text: messageText,
      priority: "medium",
      createdAt: new Date(),
    };
    userProfile.goals.push(newGoal as any);
    await this.db.users.saveUser(userProfile);
    await ctx.reply(
      "Profile setup complete! You'll receive regular motivation messages."
    );
    delete ctx.session.step;
  }

  private async handleAddingGoalStep(
    ctx: any,
    userProfile: UserProfile,
    messageText: string
  ): Promise<void> {
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
    userProfile.goals.push(goalToAdd as any);
    await this.db.users.saveUser(userProfile);

    let confirmationMessage = `✨ Great! I've added your new goal:\n"${goalToAdd.text}"`;
    if (deadline) {
      confirmationMessage += `\nDeadline: ${deadline.toLocaleDateString()}`;
    }
    confirmationMessage +=
      "\n\nYou can view all your goals or add more using /goals";

    await ctx.reply(confirmationMessage);
    delete ctx.session.step;
  }

  private async handleGeneralMessage(
    ctx: any,
    userId: number,
    messageText: string
  ): Promise<void> {
    try {
      const userProfile = await this.db.users.getUser(userId);
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
      await this.db.messages.logMessage(userId, message, "motivation");
    } catch (error) {
      console.error("Error handling message:", error);
      await ctx.reply(
        "Sorry, I had trouble processing that. Please try again."
      );
    }
  }

  async handleVoiceMessage(ctx: any): Promise<void> {
    try {
      if (!this.openai) {
        await ctx.reply(
          "Voice message processing is not configured. Please contact the administrator."
        );
        return;
      }

      // Get the voice message file
      const file = await ctx.telegram.getFile(ctx.message.voice.file_id);
      const filePath = file.file_path;

      if (!filePath) {
        await ctx.reply(
          "Sorry, I couldn't process the voice message. Please try again."
        );
        return;
      }

      // Get bot token from context
      const botToken = (ctx.telegram as any).token;

      // Download URL for the voice file
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

      // Create a temporary file path
      const tempFilePath = path.join(
        __dirname,
        `../../../temp/${ctx.message.voice.file_id}.oga`
      );

      // Download the file using fetch
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      // Create write stream and pipe the response to it
      const fileStream = createWriteStream(tempFilePath);
      const buffer = await response.arrayBuffer();
      fileStream.write(Buffer.from(buffer));
      fileStream.end();

      // Wait for the file to be written
      await new Promise((resolve, reject) => {
        fileStream.on("finish", resolve);
        fileStream.on("error", reject);
      });

      // Transcribe using Whisper API
      const transcription = await this.openai.audio.transcriptions.create({
        file: createReadStream(tempFilePath),
        model: "whisper-1",
      });

      // Clean up the temporary file
      await unlinkAsync(tempFilePath);

      // Get user profile
      const user = await this.db.users.getUser(ctx.from.id);
      if (!user) {
        await ctx.reply("Please set up your profile first using /setup");
        return;
      }

      // Send transcribed text to Claude for contextual response
      const airesponse = await this.claude.generateContextualResponse(
        transcription.text,
        user
      );

      // Send Claude's response back to the user
      await ctx.reply(airesponse);
    } catch (error) {
      console.error("Error processing voice message:", error);
      await ctx.reply(
        "Sorry, there was an error processing your voice message. Please try again or send a text message."
      );
    }
  }
}
