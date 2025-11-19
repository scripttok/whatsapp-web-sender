# Dockerfile — VAI FUNCIONAR NA PRIMEIRA VEZ
FROM mcr.microsoft.com/playwright:v1.56.1-focal

# Define variáveis de ambiente (não precisa de nada no Render)
ENV NODE_ENV=production

# Cria diretório do app
WORKDIR /app

# Copia package primeiro (melhor cache)
COPY package*.json ./

# Instala dependências
RUN npm ci --only=production

# Copia o resto do código
COPY . .

# Porta (mude se a sua for diferente)
EXPOSE 3000

# Start
CMD ["npm", "start"]