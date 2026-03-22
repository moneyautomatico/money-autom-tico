FROM ghcr.io/puppeteer/puppeteer:21.1.1

# Define o diretório de trabalho
WORKDIR /app

# Copia os arquivos de dependências
COPY package*.json ./

# Instala as dependências (incluindo o whatsapp-web.js)
RUN npm install

# Copia o restante do código
COPY . .

# Expõe a porta que o sistema usa
EXPOSE 8080

# Comando para iniciar
CMD ["node", "server.js"]
