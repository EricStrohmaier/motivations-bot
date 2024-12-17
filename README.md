# Motivation Bot

A Telegram bot that sends personalized motivation messages.

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Create .env file with required environment variables:
   - TELEGRAM_TOKEN
   - ANTHROPIC_API_KEY
   - SLACK_WEBHOOK_URL
4. Build: `npm run build`
5. Start: `npm start`

## Docker

Build and run with Docker:

```bash
docker-compose up --build
```

## Environment Variables

- `TELEGRAM_TOKEN`: Your Telegram bot token
- `ANTHROPIC_API_KEY`: Your Claude API key
- `SLACK_WEBHOOK_URL`: Webhook URL for health check notifications
- `PORT`: Port for health check endpoint (default: 3000)
