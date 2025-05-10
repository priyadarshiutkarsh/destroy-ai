FROM node:18-slim

# Install Playwright dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
RUN npx playwright install chromium
RUN npx playwright install-deps

COPY . .
EXPOSE 3000

CMD ["npm", "start"]
