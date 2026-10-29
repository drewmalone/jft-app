FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY bridge.mjs config.mjs server.mjs ticket.mjs ./
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
