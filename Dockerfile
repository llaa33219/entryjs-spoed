FROM node:20-alpine

WORKDIR /app

COPY compiled-output/ .

EXPOSE 3000

CMD ["node", "server.js"]
