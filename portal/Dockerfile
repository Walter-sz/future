# 在 portal 目录下构建：docker build -t walter-portal .
FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "start"]
