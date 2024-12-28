import dotenv from "dotenv";
dotenv.config();

export const config = {
  connectionString: process.env.DATABASE_URL,
  sslEnabled: false,
  poolConfig: {
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
  },
};
