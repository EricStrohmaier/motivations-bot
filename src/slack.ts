// src/services/notification.service.ts
import fetch from "node-fetch";

export class NotificationService {
  private webhookUrl: string;
  private lastNotificationTime: number = 0;
  private readonly NOTIFICATION_COOLDOWN = 5 * 60 * 1000; // 5 minutes in milliseconds

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async sendSlackAlert(error: any, metadata: any = {}): Promise<void> {
    // Check cooldown to prevent spam
    const now = Date.now();
    if (now - this.lastNotificationTime < this.NOTIFICATION_COOLDOWN) {
      console.log("Notification skipped due to cooldown");
      return;
    }

    try {
      const message = {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🚨 Bot Health Check Failed",
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Error:* ${error.message || "Unknown error"}`,
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Time:* ${new Date().toISOString()}`,
              },
              {
                type: "mrkdwn",
                text: `*Environment:* ${process.env.NODE_ENV || "development"}`,
              },
            ],
          },
        ],
      };

      // Add metadata if available
      if (Object.keys(metadata).length > 0) {
        message.blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Additional Info:*\n${JSON.stringify(metadata, null, 2)}`,
          },
        });
      }

      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to send Slack notification: ${response.statusText}`
        );
      }

      this.lastNotificationTime = now;
    } catch (error) {
      console.error("Error sending Slack notification:", error);
    }
  }
}
