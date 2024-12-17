# Use Node.js 18
FROM node:18-slim

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Install TypeScript globally
RUN npm install -g typescript

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Create volume directory for SQLite database
RUN mkdir -p /usr/src/app/data

# Build TypeScript
RUN npx tsc

# Expose health check port
EXPOSE 3000

# Start command
CMD [ "node", "dist/index.js" ]