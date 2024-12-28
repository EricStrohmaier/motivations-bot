-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  user_id BIGINT PRIMARY KEY,
  username TEXT,
  goals JSONB DEFAULT '[]'::jsonb,
  motivation_frequency INTEGER DEFAULT 24,
  timezone TEXT DEFAULT 'UTC',
  check_in_enabled BOOLEAN DEFAULT true,
  last_message_date TIMESTAMP WITH TIME ZONE,
  custom_motivation_messages JSONB DEFAULT '[]'::jsonb
);

-- Create message_history table
CREATE TABLE IF NOT EXISTS message_history (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(user_id),
  message_text TEXT,
  message_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create goal_progress table
CREATE TABLE IF NOT EXISTS goal_progress (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(user_id),
  goal TEXT,
  status TEXT CHECK (status IN ('active', 'completed', 'abandoned')),
  notes TEXT,
  start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completion_date TIMESTAMP WITH TIME ZONE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_message_history_user_id ON message_history(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_progress_user_id ON goal_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_message_history_created_at ON message_history(created_at);
CREATE INDEX IF NOT EXISTS idx_goal_progress_status ON goal_progress(status);

-- Set up proper permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
