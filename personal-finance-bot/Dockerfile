FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV PORT=3002
EXPOSE 3002
CMD ["node", "index.js"]
