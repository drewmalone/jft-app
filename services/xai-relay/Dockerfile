FROM node:24-alpine
WORKDIR /app
COPY services/xai-relay/package.json services/xai-relay/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY services/xai-relay/*.mjs ./services/xai-relay/
COPY shared/xai-relay/*.mjs ./shared/xai-relay/
RUN chmod a+r /app/package*.json && chmod -R a+rX /app/services /app/shared
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "services/xai-relay/server.mjs"]
