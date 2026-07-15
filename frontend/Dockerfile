FROM docker.io/library/node:24-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci \
    && sha256sum package-lock.json | cut -d ' ' -f 1 > node_modules/.package-lock.hash

COPY . .

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 5173

ENTRYPOINT ["docker-entrypoint.sh"]

CMD ["npm", "run", "dev"]
