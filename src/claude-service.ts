import { Anthropic } from "@anthropic-ai/sdk";
import { UserProfile } from "./types";
import { DatabaseService } from "./db/index";

const model = "claude-3-5-haiku-20241022";
const MAX_CONTEXT_MESSAGES = 10; // Keep last 10 messages for context

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export class ClaudeService {
  private client: Anthropic;
  private db: DatabaseService;
  private conversationCache: Map<number, ConversationMessage[]> = new Map();

  constructor(apiKey: string, dbService: DatabaseService) {
    this.client = new Anthropic({
      apiKey: apiKey,
    });
    this.db = dbService;
  }

  private async getConversationContext(
    userId: number
  ): Promise<ConversationMessage[]> {
    if (!this.conversationCache.has(userId)) {
      // Load last messages from database
      const recentMessages = await this.db.messages.getRecentMessages(
        userId,
        MAX_CONTEXT_MESSAGES
      );
      const context = recentMessages.map((msg) => ({
        role:
          msg.message_type === "user_message"
            ? ("user" as const)
            : ("assistant" as const),
        content: msg.message_text,
        timestamp: new Date(msg.sent_at),
      }));
      this.conversationCache.set(userId, context);
    }
    return this.conversationCache.get(userId) || [];
  }

  private async updateConversationContext(
    userId: number,
    message: ConversationMessage
  ): Promise<void> {
    let context = await this.getConversationContext(userId);
    context.push(message);

    // Keep only the last MAX_CONTEXT_MESSAGES messages
    if (context.length > MAX_CONTEXT_MESSAGES) {
      context = context.slice(-MAX_CONTEXT_MESSAGES);
    }

    this.conversationCache.set(userId, context);
  }

  private formatGoalsContext(userProfile: UserProfile): string {
    if (!userProfile.goals || userProfile.goals.length === 0) {
      return "They are at the beginning of their journey and haven't set specific goals yet. This is a perfect time to encourage general personal growth and positive habits.";
    }

    return `Their current goals are:\n${userProfile.goals
      .map(
        (g) =>
          `- ${g.text}${
            g.deadline
              ? ` (due: ${new Date(g.deadline).toLocaleDateString()})`
              : ""
          }`
      )
      .join("\n")}`;
  }

  private async generateCustomMotivation(
    userId: number
  ): Promise<string | null> {
    return this.db.messages.getNextMotivationMessage(userId);
  }

  private async generateAIMotivation(
    userProfile: UserProfile
  ): Promise<string> {
    const formattedGoals = this.formatGoalsContext(userProfile);
    const hasGoals = userProfile.goals && userProfile.goals.length > 0;

    const prompt = `Create an encouraging and motivational message for someone. ${formattedGoals}

The message should:
1. Be personal and empathetic
2. ${
      hasGoals
        ? "Reference specific goals they're working on"
        : "Encourage them to embrace new opportunities and personal growth"
    }
3. ${
      hasGoals
        ? "Acknowledge the challenges they might face"
        : "Acknowledge that starting a journey of self-improvement takes courage"
    }
4. ${
      hasGoals
        ? "Provide specific encouragement related to their goals"
        : "Provide general encouragement about taking positive steps forward"
    }
5. ${
      hasGoals
        ? "End with an actionable step or thought"
        : "End with an invitation to set a meaningful goal or take a small positive step"
    }

Keep the tone positive, energetic, and forward-looking. Make it feel like it's coming from a supportive friend who really understands their journey.
Keep responses concise. Short messages are better than long ones.`;

    const message = await this.client.messages.create({
      model: model,
      max_tokens: 350,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const response =
      message.content[0].type === "text" ? message.content[0].text : "";
    const emojis = ["✨", "🌟", "💪", "🚀", "🎯", "⭐", "🌈", "💫"];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

    return `${response} ${randomEmoji}`;
  }

  async generateMotivationalMessage(userProfile: UserProfile): Promise<string> {
    console.log("Generating motivational message...");

    // First try custom message
    const customMessage = await this.generateCustomMotivation(
      userProfile.userId
    );
    if (customMessage) {
      return customMessage;
    }

    // Fall back to AI-generated message
    return this.generateAIMotivation(userProfile);
  }

  async generateContextualResponse(
    userMessage: string,
    userProfile: UserProfile
  ): Promise<string> {
    console.log("Generating contextual response...");

    // Get conversation context
    const conversationContext = await this.getConversationContext(
      userProfile.userId
    );
    const goalsContext = this.formatGoalsContext(userProfile);

    // Format conversation history
    const conversationHistory = conversationContext
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const prompt = `You are a motivational AI assistant. You have an ongoing conversation with a user who has the following context:

${goalsContext}

Previous conversation:
${conversationHistory}

The user's latest message is: "${userMessage}"

Respond in a way that:
1. Shows you remember and reference the conversation context when relevant
2. Addresses their immediate question or comment
3. Keeps the conversation flowing naturally

Keep responses concise and friendly. If they seem to be struggling or frustrated, offer specific encouragement related to their goals.`;

    const message = await this.client.messages.create({
      model: model,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const response =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Update conversation context
    await this.updateConversationContext(userProfile.userId, {
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    });
    await this.updateConversationContext(userProfile.userId, {
      role: "assistant",
      content: response,
      timestamp: new Date(),
    });

    // Store messages in database
    await this.db.messages.logMessage(
      userProfile.userId,
      userMessage,
      "user_message"
    );
    await this.db.messages.logMessage(
      userProfile.userId,
      response,
      "assistant_message"
    );

    return response;
  }
}
