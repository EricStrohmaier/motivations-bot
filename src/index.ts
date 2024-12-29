import { config } from "dotenv";
import { MotivationBot } from "./bot";

import { NotificationService } from "./slack";
import express from "express";
import { DatabaseService } from "./db/index";

async function startBot() {
  let dbService: DatabaseService | null = null;
  let server: any = null;

  try {
    // Load environment variables
    config();

    // Initialize Express app for health checks
    const app = express();
    const PORT = process.env.PORT || 3000;

    // Initialize notification service
    const notificationService = new NotificationService(
      process.env.SLACK_WEBHOOK_URL!
    );

    // Add health check endpoint with notification
    app.get("/health", async (req, res) => {
      try {
        const dbService = req.app.locals.dbService;
        if (!dbService) {
          throw new Error("Database service not initialized");
        }

        // Perform health checks
        await dbService.ensureConnection();

        // All checks passed
        res.status(200).json({
          status: "healthy",
          timestamp: new Date().toISOString(),
          database: "connected",
          bot: "running",
        });
      } catch (error) {
        console.error("Health check failed:", error);

        // Prepare metadata for notification
        const metadata = {
          databaseStatus: (error as Error).message.includes("database")
            ? "disconnected"
            : "unknown",
          lastHealthCheck: new Date().toISOString(),
          processUptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
        };

        // Send notification
        await notificationService.sendSlackAlert(error, metadata);

        res.status(503).json({
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          error: error || "Unknown error",
        });
      }
    });

    // Initialize database with retries
    dbService = new DatabaseService();
    await dbService.initialize();
    console.log("Database initialized successfully");

    app.locals.dbService = dbService;

    // Create and start the bot
    const bot = new MotivationBot(
      process.env.TELEGRAM_TOKEN!,
      process.env.ANTHROPIC_API_KEY!,
      dbService,
      process.env.OPENAI_API_KEY
    );

    // Start the health check server
    server = app.listen(PORT, () => {
      console.log(`Health check server listening on port ${PORT}`);
    });

    // Setup graceful shutdown
    process.on("SIGTERM", () => gracefulShutdown());
    process.on("SIGINT", () => gracefulShutdown());

    async function gracefulShutdown() {
      console.log("Received shutdown signal");

      try {
        // Close the HTTP server
        if (server) {
          await new Promise((resolve) => server.close(resolve));
          console.log("HTTP server closed");
        }

        // Close database connection
        if (dbService) {
          await dbService.close();
          console.log("Database connection closed");
        }

        process.exit(0);
      } catch (error) {
        console.error("Error during shutdown:", error);
        process.exit(1);
      }
    }

    await bot.start();
    console.log("Bot started successfully");
  } catch (error) {
    console.error("Failed to start bot:", error);

    // Try to clean up resources
    if (server) {
      server.close();
    }
    if (dbService) {
      await dbService.close();
    }

    process.exit(1);
  }
}

startBot();
