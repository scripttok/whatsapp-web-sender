# Dockerfile para WhatsApp Sender com Playwright no Render.com
FROM node:20-alpine AS base

# Instala Chromium + dependências do Playwright (sem sudo, tudo no Alpine)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Define o path do Chromium para o Playwright
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Cria diretório do app
WORKDIR /app

# Copia package.json e instala dependências
COPY package*.json ./
RUN npm ci --only=production

# Copia o resto do código
COPY . .

# Expõe a porta (ajuste se o seu for diferente de 3000)
EXPOSE 3000

# Comando de start
CMD ["npm", "start"]