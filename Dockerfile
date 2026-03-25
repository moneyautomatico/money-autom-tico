FROM ghcr.io/puppeteer/puppeteer:21.1.1

WORKDIR /app

# Copia dependências
COPY package*.json ./
RUN npm install

# Copia código
COPY . .

# Garante que /tmp/.wpp_session existe e tem permissão de escrita
RUN mkdir -p /tmp/.wpp_session && chmod 777 /tmp/.wpp_session

# Expõe o path do Chromium que vem com a imagem puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

EXPOSE 8080
CMD ["node", "server.js"]
