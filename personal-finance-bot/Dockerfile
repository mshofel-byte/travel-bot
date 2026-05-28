FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
RUN npx playwright install --with-deps chromium

COPY . .

CMD ["node", "index.js"]
