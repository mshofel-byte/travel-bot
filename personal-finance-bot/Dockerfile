FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libx11-6 \
    libxcb1 \
    libxext6 \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json patch-leumi.js patch-discount.js ./
RUN npm ci && \
    node -e "const fs=require('fs'),f='node_modules/israeli-bank-scrapers/lib/scrapers/max.js',c=fs.readFileSync(f,'utf8');fs.writeFileSync(f,c.replace('throw new Error(\`Unknown transaction type \${cleanedUpTxnTypeStr}\`)','return _transactions2.TransactionTypes.Normal'));" && \
    node patch-leumi.js && \
    node patch-discount.js
COPY . .

ENV NODE_ENV=production
CMD ["node", "index.js"]
