FROM docker.m.daocloud.io/library/node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY test.js ./

ENV SFU_URL=http://host.docker.internal:3001
ENV SFU_ROOM=demo
ENV SFU_CLIENTS=2

CMD ["npm", "run", "test"]
