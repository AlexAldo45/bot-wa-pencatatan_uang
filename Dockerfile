# Use Node 20 LTS Debian image for full Linux library support for Puppeteer / Chromium
FROM node:22-bookworm-slim

# Install Chromium and required headless browser dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxtst6 \
    ca-certificates \
    procps \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer environment to use system installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Cap Node.js heap to 512MB to prevent OOM on low-RAM devices
ENV NODE_OPTIONS="--max-old-space-size=512"

# Reduce glibc memory fragmentation (significant RAM saving on Linux)
ENV MALLOC_ARENA_MAX=2

# Set timezone (avoids repeated timezone lookups)
ENV TZ=Asia/Jakarta

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && npm ci --only=production \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy application source code
COPY . .

# Ensure storage directories exist
RUN mkdir -p data logs .wwebjs_auth .wwebjs_cache

# Copy and set entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Use entrypoint to clean lock files before starting
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "start"]
