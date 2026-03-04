FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json tsconfig.build.json jest.config.cjs ./
COPY src ./src
COPY tests ./tests

RUN npm install && npm test && npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8000

CMD ["node", "dist/index.js"]

