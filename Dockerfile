FROM ghcr.io/puppeteer/puppeteer:21.1.1
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# PATCH 5: garante que /tmp/.wpp_session existe e tem permissão de escrita
RUN mkdir -p /tmp/.wpp_session && chmod 777 /tmp/.wpp_session
EXPOSE 8080
CMD ["node", "server.js"]
