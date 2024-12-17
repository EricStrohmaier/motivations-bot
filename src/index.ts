import { config } from "dotenv";
import { MotivationBot } from "./bot";
import { DatabaseService } from "./db";
import { NotificationService } from "./slack";
import express from "express";

async function startBot() {
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

    // Initialize database
    const dbService = new DatabaseService();
    await dbService.initialize();
    console.log("Database initialized successfully");

    app.locals.dbService = dbService;

    // Create and start the bot
    const bot = new MotivationBot(
      process.env.TELEGRAM_TOKEN!,
      process.env.ANTHROPIC_API_KEY!,
      dbService
    );

    // Handle shutdown with notification
    const shutdown = async () => {
      console.log("Shutting down gracefully...");
      await notificationService.sendSlackAlert(
        { message: "Bot shutting down" },
        { reason: "Graceful shutdown", time: new Date().toISOString() }
      );
      await dbService.close();
      bot.stop();
      server.close(() => {
        console.log("Server closed");
        process.exit(0);
      });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    // Start the Express server
    const server = app.listen(PORT, () => {
      console.log(`Health check server listening on port ${PORT}`);
    });

    // Start the bot
    await bot.start();
    console.log("Bot started successfully");
  } catch (error) {
    console.error("Error starting bot:", error);
    process.exit(1);
  }
}

startBot();
