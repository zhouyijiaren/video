FROM docker.m.daocloud.io/library/node:20-bullseye

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libxshmfence1 \
  xdg-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install

COPY test.js ./

ENV CHROME_BIN=/usr/bin/chromium
ENV SERVER_URL=http://host.docker.internal:3001
ENV CLIENT_URL=http://host.docker.internal:8080
ENV ROOM_ID=demo

CMD ["npm", "run", "test"]
