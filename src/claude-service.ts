import { Anthropic } from "@anthropic-ai/sdk";
import { UserProfile } from "./types";
import { DatabaseService } from "./db";

export class ClaudeService {
  private client: Anthropic;
  private db: DatabaseService;

  constructor(apiKey: string, dbService: DatabaseService) {
    this.client = new Anthropic({
      apiKey: apiKey,
    });
    this.db = dbService; // Use the provided database service
  }
  async generateContextualResponse(
    userMessage: string,
    userProfile: UserProfile
  ): Promise<string> {
    console.log("Generating contextual response...");
    // Format user's context
    const goalsContext =
      userProfile.goals.length > 0
        ? `Their current goals are:\n${userProfile.goals
            .map(
              (g) =>
                `- ${g.text}${
                  g.deadline
                    ? ` (due: ${new Date(g.deadline).toLocaleDateString()})`
                    : ""
                }`
            )
            .join("\n")}`
        : "They haven't set any specific goals yet.";

    const prompt = `You are a motivational AI assistant. You have an ongoing conversation with a user who has the following context:

${goalsContext}

The user's message is: "${userMessage}"

Respond in a way that:
1. Addresses their immediate question or comment

Keep responses concise. If they seem to be struggling or frustrated, offer specific encouragement related to their goals. 
Short messages are better than long ones.`;

    const message = await this.client.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    return message.content[0].type === "text" ? message.content[0].text : "";
  }

  async generateMotivationalMessage(userProfile: UserProfile): Promise<string> {
    console.log("Generating motivational message...");

    // First try to get a custom message
    const customMessage = await this.db.getNextMotivationMessage(
      userProfile.userId
    );
    if (customMessage) {
      return customMessage;
    }

    // Format goals for better readability
    const formattedGoals = userProfile.goals
      .map((goal) => goal.text)
      .join("\n- ");

    const prompt = `Create an encouraging and motivational message for someone working on these goals:
- ${formattedGoals}

The message should:
1. Be personal and empathetic
2. Reference specific goals they're working on
3. Acknowledge the challenges they might face
4. Provide specific encouragement related to their goals
5. End with an actionable step or thought

Keep the tone positive, energetic, and forward-looking. Make it feel like it's coming from a supportive friend who really understands their journey.

Keep responses concise. Short messages are better than long ones.`;

    const message = await this.client.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 350,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7, // Add some variability
    });

    const response =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Add a random emoji at the end for extra friendliness
    const emojis = ["✨", "🌟", "💪", "🚀", "🎯", "⭐", "🌈", "💫"];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

    return `${response} ${randomEmoji}`;
  }
}
