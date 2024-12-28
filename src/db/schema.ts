import { PoolClient } from "pg";

export async function initializeTables(client: PoolClient): Promise<void> {
  try {
    // First, check if tables exist
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
      );
    `);

    if (!tableExists.rows[0].exists) {
      await createTables(client);
    } else {
      await updateSchema(client);
    }

    console.log("Database tables initialized successfully");
  } catch (error) {
    console.error("Error initializing tables:", error);
    throw error;
  }
}

async function createTables(client: PoolClient): Promise<void> {
  // Create users table
  await client.query(`
    CREATE TABLE users (
      user_id BIGINT PRIMARY KEY,
      username TEXT,
      goals JSONB DEFAULT '[]'::jsonb,
      motivation_frequency INTEGER DEFAULT 24,
      timezone TEXT DEFAULT 'UTC',
      check_in_enabled BOOLEAN DEFAULT true,
      last_message_date TIMESTAMP WITH TIME ZONE,
      custom_motivation_messages JSONB DEFAULT '[]'::jsonb
    )
  `);

  // Create message_history table
  await client.query(`
    CREATE TABLE message_history (
      id SERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(user_id),
      message_text TEXT,
      message_type TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create goal_progress table
  await client.query(`
    CREATE TABLE goal_progress (
      id SERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(user_id),
      goal TEXT,
      status TEXT CHECK (status IN ('active', 'completed', 'abandoned')),
      notes TEXT,
      start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      completion_date TIMESTAMP WITH TIME ZONE
    )
  `);
}

async function updateSchema(client: PoolClient): Promise<void> {
  // Update user_id to BIGINT if needed
  await client.query(`
    DO $$ 
    BEGIN 
      -- Check and modify users table
      IF EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'user_id' 
        AND data_type = 'integer'
      ) THEN 
        ALTER TABLE message_history DROP CONSTRAINT IF EXISTS message_history_user_id_fkey;
        ALTER TABLE goal_progress DROP CONSTRAINT IF EXISTS goal_progress_user_id_fkey;
        ALTER TABLE users ALTER COLUMN user_id TYPE BIGINT;
        ALTER TABLE message_history ALTER COLUMN user_id TYPE BIGINT;
        ALTER TABLE goal_progress ALTER COLUMN user_id TYPE BIGINT;
        ALTER TABLE message_history ADD CONSTRAINT message_history_user_id_fkey 
          FOREIGN KEY (user_id) REFERENCES users(user_id);
        ALTER TABLE goal_progress ADD CONSTRAINT goal_progress_user_id_fkey 
          FOREIGN KEY (user_id) REFERENCES users(user_id);
      END IF;
    END $$;
  `);

  // Check if created_at column exists in message_history table
  const columnExists = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = 'message_history' 
      AND column_name = 'created_at'
    );
  `);

  if (!columnExists.rows[0].exists) {
    await client.query(`
      ALTER TABLE message_history 
      ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    `);
  }

  // Check for missing columns
  const result = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'users'
  `);
  const columnNames = result.rows.map((row: any) => row.column_name);

  const columnUpdates = [];
  if (!columnNames.includes("custom_motivation_messages")) {
    columnUpdates.push(
      "ALTER TABLE users ADD COLUMN custom_motivation_messages JSONB DEFAULT '[]'::jsonb"
    );
  }
  if (!columnNames.includes("timezone")) {
    columnUpdates.push(
      "ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'UTC'"
    );
  }
  if (!columnNames.includes("check_in_enabled")) {
    columnUpdates.push(
      "ALTER TABLE users ADD COLUMN check_in_enabled BOOLEAN DEFAULT true"
    );
  }

  for (const update of columnUpdates) {
    await client.query(update);
  }
}
