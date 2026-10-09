# Optional: run the Studio in a container. See README ("Docker").
FROM node:22-alpine
RUN apk add --no-cache git \
 && git config --system --add safe.directory '*'
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV STUDIO_HOST=0.0.0.0 JEKYLL_REPO=/site PORT=4747 HOME=/tmp
EXPOSE 4747
USER node
CMD ["node", "server.js"]
