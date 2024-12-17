// src/db/migrations.ts
import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function initializeDatabase() {
  const db = await open({
    filename: "motivation_bot.db",
    driver: sqlite3.Database,
  });

  // Create tables
  await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            interests TEXT,
            goals TEXT,
            motivation_frequency INTEGER DEFAULT 2,
            preferred_time TEXT DEFAULT '10:00',
            last_message_date TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

  console.log("✓ Users table created");

  await db.exec(`
        CREATE TABLE IF NOT EXISTS goal_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            goal TEXT,
            status TEXT CHECK(status IN ('active', 'completed', 'abandoned')),
            start_date TEXT,
            completion_date TEXT,
            notes TEXT,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
    `);

  console.log("✓ Goal progress table created");

  await db.exec(`
        CREATE TABLE IF NOT EXISTS message_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            message_text TEXT,
            message_type TEXT CHECK(message_type IN ('motivation', 'progress_update', 'goal_completion')),
            sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
    `);

  console.log("✓ Message history table created");

  return db;
}

// Run migrations if this file is executed directly
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      console.log("Database initialization completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Error initializing database:", error);
      process.exit(1);
    });
}
