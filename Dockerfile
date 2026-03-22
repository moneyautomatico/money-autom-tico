FROM ghcr.io/puppeteer/puppeteer:21.1.1
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
