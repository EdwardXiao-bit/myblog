# 构建阶段
FROM node:24-slim AS build
WORKDIR /app

# SITE_URL 是构建时变量：canonical、分享卡片、RSS、sitemap 都靠它，
# 所以必须在 build 阶段就传进来，运行阶段再改是没用的。
ARG SITE_URL=https://example.com
ENV SITE_URL=$SITE_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# 运行阶段
FROM node:24-slim
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# 留言板和日记都在这个 SQLite 文件里。
# 部署时务必挂一个持久化卷到 /app/data，否则容器一重建数据就没了。
VOLUME /app/data

EXPOSE 4321
CMD ["node", "dist/server/entry.mjs"]
