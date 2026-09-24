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
# 运维脚本进镜像：备份、恢复演练、生产冒烟都要在容器里跑
# （docker compose exec app node scripts/backup.mjs）
COPY --from=build /app/scripts ./scripts

# 留言板和日记都在这个 SQLite 文件里。
# 部署时务必挂一个持久化卷到 /app/data，否则容器一重建数据就没了。
VOLUME /app/data

EXPOSE 4321

# 探活真的去读一次数据库：进程活着但数据库打不开的情况也要能被发现。
# node:24-slim 里没有 curl/wget，所以用 node 自带的 fetch。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4321/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/entry.mjs"]
