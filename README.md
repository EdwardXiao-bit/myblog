# 个人主页

用 Astro 搭的个人主页：个人简介、项目、活动照片、留言板与日记。

## 怎么跑起来

```bash
npm install     # 第一次才需要
npm run dev     # 打开 http://localhost:4321
```

改代码、加内容都会自动刷新，不用重启。
（例外：新增「内容集合」或改 `astro.config.mjs` 时需要手动重启一次 dev。）

```bash
npm run build        # 构建到 dist/（静态页进 dist/client，服务端代码进 dist/server）
npm run serve        # 跑构建产物（等同线上运行方式）
npm run preview      # 预览构建结果
npm run check:build  # 构建后自检：内容断言 + 断链 + 静态/SSR 边界（建议 build 之后跑）
npm run smoke        # 对运行中的服务器发真实请求，确认页面正常
npm run test:guestbook  # 留言板端到端测试（见下方说明）
```

## 最常改的地方

| 想改什么 | 改哪个文件 |
| --- | --- |
| 名字、签名、邮箱、社交链接、经历、关键词 | `src/data/site.ts` |
| 颜色、字号、间距、圆角 | `src/styles/global.css` 顶部的设计变量 |
| 导航栏菜单 | `src/components/Header.astro` 里的 `nav` 数组 |
| 首页布局 | `src/pages/index.astro` |
| 项目内容 | `src/content/projects/` 里的 Markdown |
| 活动内容与照片 | `src/content/activities/` 里的目录 |
| 内容字段规则（哪些必填） | `src/content.config.ts` |

头像：把图片放进 `public/`（比如 `public/avatar.jpg`），然后在 `src/data/site.ts` 里把 `avatar` 改成 `'/avatar.jpg'`。留空就用名字首字生成。

## 加一个项目

在 `src/content/projects/` 新建一个 `.md`，文件名随意（就是排序用的 id）：

```markdown
---
title: 项目名
summary: 一句话说清楚它解决什么问题、你做了什么。
href: https://github.com/you/repo   # 没有链接就删掉这一行
tags: ['TypeScript', '工具']
period: '2024'
order: 1        # 数字越小越靠前
---
```

字段写错或必填项忘了，构建时会直接报错并指出是哪个文件。想加字段（比如「截图」「团队规模」）就改 `src/content.config.ts` 里对应的 schema。

## 加一场活动

一个活动 = `src/content/activities/` 下的一个目录：

```
src/content/activities/2026-guanyinqiao-reunion/
  index.md        ← 活动信息 + 正文
  cover-group.jpg ← 封面（列表页缩略图）
  group-wide.jpg  ← 照片，数量随意
  bingjiang.jpg
```

`index.md` 的写法：

```markdown
---
title: 观音桥同学聚会
date: 2026-08-23
location: 重庆 · 观音桥
summary: 列表页显示的一句话
cover: ./cover-group.jpg
photos:
  - ./group-wide.jpg
  - ./bingjiang.jpg
captions:          # 可选，和 photos 按顺序对应
  - 高中同学
  - 贵州冰浆，开到了重庆
---
正文写在这里，支持 Markdown。
```

照片直接放进同目录、在 `photos` 里列出文件名即可——站点会自动压缩成 WebP、按屏幕宽度生成多尺寸，并做懒加载，你不需要手动处理图片。

> 画廊用的是多列（masonry）布局，横图和竖图会各按自己的比例排，
> **不会被裁成统一尺寸**——所以手机拍的竖图直接放进去也不会缺内容。
> `captions` 是可选的，但照片多、题材杂时写上会清楚很多。

## 留言板与日记

留言板在 `/guestbook`，管理页在 `/admin`。两者都需要服务端，所以构建时不会被预渲染；
首页、项目、活动仍然是纯静态文件。

### 第一次使用：设置管理密码

复制 `.env.example` 成 `.env`，把 `ADMIN_PASSWORD` 改成你自己的密码（至少 6 位），重启 `npm run dev`。
然后打开 `/admin` 登录。

> `.env` 已经在 `.gitignore` 里，不会被提交。
> 部署到线上时，用系统环境变量覆盖 `.env` 里的值即可（真实环境变量优先级更高）。

### 谁可以留言

任何人都能留言，**不需要注册、不收集邮箱**。昵称留空就是匿名，填了就署名显示。
也可以只发图片不写字。

留言支持：

| 功能 | 说明 |
| --- | --- |
| 配图 | 最多 3 张，单张不超过 5 MB；只收 jpg / png / webp / gif |
| 表情 | 输入框下方有个表情面板，点一下就插到光标处（本地实现，没引第三方库） |
| 点赞 | **不需要登录**，同一来源对同一条只算一次，**再点一下取消**；有脚本时不刷新页面 |
| 表情反应 | 点赞旁边的「＋」里挑一个表情贴上去，旁边会显示**表情 + 个数**；同一来源同一表情只算一次，**再点一下就取消**。回复同样能贴 |
| 回复 | 只有站主能回，在 `/admin` 每条留言下面直接写；**回复本身也支持配图、表情和点赞** |

图片上传后会**自动等比缩到长边 1600 以内、转成 WebP，并丢掉 EXIF**
（手机照片的 EXIF 里可能有拍摄地点，不该跟着留言一起公开）。
GIF 原样保存，否则动图会变成静图。

上限都在 `src/lib/storage.ts` 顶部改。

### 表情反应是怎么存的

一张 `reactions` 表，主键是 `(entry_id, emoji, ip_hash)`——
同一来源对同一条内容的同一个表情只算一次，和点赞的去重方式一致。

**接口只接受白名单里的表情**（名单在 `src/lib/reactions.ts`）。
这一点是有意的：表情是匿名访客能写进数据库、又会被原样渲染到页面上的内容，
不限制的话等于开了一个写任意内容的入口。想加表情就改那个数组。

留言、日记、回复都能贴，因为它们都是 entries 里的一条记录。

### 回复是怎么存的

回复**不是** entries 表上的一个文本列，而是**另一条 entry**
（`kind='reply'` + `parent_id` 指向被回复的留言）。

这么做的好处：配图、点赞、时间戳这些机制全部直接复用，不用为回复再写一套；
删除留言时会连它的回复和回复的图片一起清理。

**每次提交都是追加一条新回复**（像对话一样可以连着回几条），
不会被覆盖；每条回复有自己的时间、自己的配图、自己的点赞数，
管理页里可以逐条删除。

### 日记

在 `/admin` 里写，两种可见性：

- **公开** —— 出现在留言板上，署站主名并带「站主日记」标签
- **仅自己可见** —— 只存在数据库里，只有登录后能在管理页看到

### 一个彩蛋

留言时把昵称填成站主自己的（`src/data/site.ts` 里的 `name`，**大小写不计**）：

- 输入框下面会当场冒出一句「竟然和我一个昵称！🤡 那你是冒牌的」
- 这条留言审核通过后，留言板上会带一个「**冒牌🤡**」标签
- 管理页里也能看到这个标签，方便审核时一眼认出

标记是**渲染时比对**的，不写进数据库——所以以后改站点名，历史留言的标记会跟着变，
也不会出现「数据库里存的名字和站点名不一致」这种问题。

不想要这个彩蛋：删掉 `src/utils/nickname.ts`，再去掉
`guestbook.astro` 与 `admin.astro` 里对 `isImpostor` 的调用即可。

### 图片存在哪

默认落在 `data/uploads/年/月/随机名.webp`，数据库里只存相对路径。
这个目录和数据库一样是**运行时数据**，已经被 `.gitignore` 排除；
部署时要和数据库一起放在持久化磁盘上（Docker 那个 `-v myblog-data:/app/data` 已经覆盖了）。

想换到对象存储（S3 / 阿里云 OSS）时，**只需要改 `src/lib/storage.ts` 一个文件**：
把 `saveImage` / `readImage` / `removeImage` 三个函数换成调 SDK 即可，上层不用动。
也可以用 `UPLOAD_DIR` 环境变量把目录换到别处。

### 审核与防垃圾

| 机制 | 说明 |
| --- | --- |
| 审核开关 | `.env` 里 `MODERATION=on`（默认）时留言先进待审核队列；改成 `off` 则提交即公开 |
| 蜜罐字段 | 表单里有个真人看不见的「网址」输入框，机器人填了就**静默丢弃**——不报错、不提示，对方不知道自己被识破了 |
| 提交速度 | 页面渲染到提交不足 1.2 秒的当作机器人丢弃 |
| 限流 | 同一来源每小时最多 5 条（改 `src/lib/guestbook.ts` 里的 `LIMITS.perHour`） |
| 隐私 | 数据库里**只存 IP 的哈希**，不存明文 IP，无法反查 |
| 跨站防护 | 提交时校验来源，管理动作全部要求登录 cookie |
| 上传防护 | 校验类型与大小、文件名随机、拒绝目录穿越；删除留言会连图片一起删 |

> 待审核留言里的图片没有被任何页面引用，但**知道地址的人仍然能打开**——
> 文件名是随机串，猜不到，严格说这不算访问控制。个人站够用；
> 要更严就得把「已发布」也纳入图片的读取判断。

内容长度上限、昵称长度等都在 `src/lib/guestbook.ts` 的 `LIMITS` 里。

### 留言板端到端测试

`npm run test:guestbook` 会对着真实运行的服务器发请求，并**直接读数据库核对结果**，
覆盖匿名、蜜罐、限流、转义、审核、登录等 56 项断言。

跑之前需要两个服务器实例（一个审核开、一个审核关）：

```powershell
npm run build
# 终端 A
$env:GUESTBOOK_DB='data/test-guestbook.db'; $env:PORT='4322'; node dist/server/entry.mjs
# 终端 B
$env:GUESTBOOK_DB='data/test-open.db'; $env:MODERATION='off'; $env:PORT='4323'; node dist/server/entry.mjs
# 终端 C
npm run test:guestbook
```

测试用的是独立的库文件，不会碰你的 `data/guestbook.db`。

### 数据库迁移测试

改了表结构时，**务必也跑一下这个**：

```bash
npm run build
npm run test:migration
```

它会造两个「历史版本」的库（最早那版、回复还是文本列那版），
拿它们起服务，检查老数据是否完好、结构是否补齐、旧回复有没有搬成新记录。

> 为什么单独做这个：其他测试都用**全新建的库**，所以「新库能跑、老库直接报错」
> 这类问题永远测不到——**这个坑真的踩过一次**：
> 把 `create index ... on entries (parent_id)` 和建表写在一起，
> 老库还没有 parent_id 这一列，一建索引就报 `no such column`，整个站 500。
> 现在建表 / 补列 / 建索引是严格三步分开的。

## 改完东西没生效？

开发服务器偶尔不会跟上文件变动，表现是页面还是旧的——**内容或样式都可能**。
按顺序试：

1. **强制刷新**页面（`Ctrl+F5`），绕开浏览器缓存
2. **重启 dev**：`Ctrl+C`，再 `npm run dev`
3. 仍然可疑的话，**以构建产物为准**：

   ```bash
   npm run build
   npm run serve     # 打开 http://localhost:4321
   ```

   dev 是热更新的、偶尔会落后；`dist/` 里的是真正会上线的东西，出问题先看它。

`npm run smoke` 会对比「源文件数」和「页面上的条目数」，如果内容陈旧会直接指出来。
不过它只管内容，管不了样式——样式上的怪问题，用 `npm run build` 再看一遍最省事。

## 部署

首页、项目、活动是纯静态文件，但**留言板和日记需要服务端**，所以整站没法丢到纯静态托管，
需要一个 Node 进程和一块能持久写入的磁盘。

### 环境变量

| 变量 | 什么时候读 | 说明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 运行时 | 管理页密码，建议 12 位以上。**必须改掉默认值** |
| `GUESTBOOK_SALT` | 运行时 | 计算访客 IP 哈希用的盐。**上线后别改**，改了等于重置所有人的点赞去重 |
| `MODERATION` | 运行时 | `on`（默认）/ `off` |
| `GUESTBOOK_DB` | 运行时 | 数据库路径，默认 `data/guestbook.db` |
| `HOST` / `PORT` | 运行时 | 监听地址与端口，默认 `localhost:4321`；容器里用 `0.0.0.0` |
| `TRUST_PROXY` | 运行时 | **放在反向代理后面时必须设为 `1`**，详见下一节 |
| `SITE_URL` | **构建时** | 真实域名。影响 canonical、分享卡片、RSS、sitemap |
| `SITE_DOMAIN` | 运行时 | Caddy 对外提供的域名；留空则用 `http://IP` |
| `ACME_EMAIL` | 运行时 | 申请 HTTPS 证书的联系邮箱（可选） |

> `SITE_URL` 是构建时变量——它会写进 sitemap 和 RSS 的绝对地址里，改了必须重新构建。
> 其余变量都是运行时读取的，改完重启进程即可（这也意味着密码不会被烤进构建产物）。

### ⚠️ 反向代理后面必须开 TRUST_PROXY

这是这个项目最容易**悄悄踩坏**的一个点，单独说：

Astro 的 node 适配器取客户端地址的方式是 `incomingRequest.socket.remoteAddress`
（见 `node_modules/astro/dist/vite-plugin-app/handle-request.js`），**它不解析 `X-Forwarded-For`**。
所以只要前面挂了 Caddy / nginx，而你又没告诉应用「我在代理后面」，那么所有访客的地址
都会是代理容器的地址，于是：

- 限流从「**每人**每小时 5 条」退化成「**全站**每小时 5 条」；
- 点赞去重键是 `(entry_id, ip_hash)`，于是**一个人点赞 = 所有人都点过了**。

两种情况都不报错，只是「莫名其妙不好用」。修法是两件事一起做：

1. 应用侧设 `TRUST_PROXY=1`（`docker-compose.yml` 里已经设好），
   它会取 `X-Forwarded-For` 的**最后一段**——见 `src/lib/client-ip.ts`；
2. 代理侧**覆盖**而不是追加这个头（`Caddyfile` 里写了
   `header_up X-Forwarded-For {http.request.remote.host}`）。如果用默认的追加行为，
   访客可以自己塞一个 IP 绕过限流。

`deploy.sh` 会自动验证这一点（它跑 `smoke-prod --expect-proxy`，断言两个不同访客
得到不同的 `ip_hash`）。手工验证：

```bash
docker compose exec -T app node scripts/smoke-prod.mjs http://127.0.0.1:4321 --write --expect-proxy
```

> 反过来说：**如果站点直接暴露在公网（没有反向代理），就不要开 `TRUST_PROXY`**，
> 否则任何人都能伪造 IP 绕开限流。

### 方式一：Docker Compose（推荐，一条命令）

```bash
cp .env.example .env
vim .env            # 至少改 SITE_URL / ADMIN_PASSWORD / GUESTBOOK_SALT
./deploy.sh         # 构建 + 启动 + 自检 + 立即备份并验证可恢复
```

`deploy.sh` 不是「跑起来就说成功」，它会依次做：

1. 前置检查：缺 `.env`、`SITE_URL` 还是 `example.com`、密码还是 `change-me*` —— 直接拒绝部署；
2. `docker compose build`（`SITE_URL` 在这一步写进产物）；
3. `up -d` 并轮询 `/healthz`，60 次探测还不健康就打印最后 50 行日志并失败退出；
4. 跑生产冒烟（含反代 IP 区分验证），任一项失败就报错退出；
5. 立刻备份一次并跑恢复演练。

之后更新站点：

```bash
./deploy.sh --pull
```

`docker-compose.yml` 里两个服务：`app`（只在内网，不直接对外）和 `caddy`（自动申请并续期
HTTPS 证书）。没有域名时把 `.env` 里的 `SITE_DOMAIN` 留空，就用 `http://IP` 访问；
买了域名填上再跑一次 `deploy.sh` 即可切到 HTTPS。

### 方式二：不用 Docker，直接跑 Node

```bash
npm ci
SITE_URL=https://your-domain.com npm run build

ADMIN_PASSWORD='你的密码' \
GUESTBOOK_SALT='一串随机字符' \
HOST=0.0.0.0 PORT=4321 \
node dist/server/entry.mjs
```

用 systemd 或 pm2 跑成常驻服务，前面用 Caddy / nginx 做 HTTPS 反向代理。
**这种跑法也要记得 `TRUST_PROXY=1`**（见上一节），否则限流会失效。

系统自带的 systemd 单元最省事（不用装 pm2）：

```ini
# /etc/systemd/system/myblog.service
[Unit]
Description=myblog
After=network.target

[Service]
WorkingDirectory=/opt/myblog
EnvironmentFile=/opt/myblog/.env
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=4321 TRUST_PROXY=1
ExecStart=/usr/bin/node dist/server/entry.mjs
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

> 诚实说明：`docker-compose.yml` 和 `Caddyfile` 的**语法与逻辑经过审查，但没有在真实
> Docker 环境里跑过**（本机没装 Docker）。`deploy.sh` 的 bash 语法做了 `bash -n` 检查。
> 第一次部署时留意构建与卷挂载；`deploy.sh` 的自检会把「站起来了但其实是坏的」这种情况挡下来。

### 备份与恢复

**不要用 `cp` 直接拷 `.db` 文件**：数据库开了 WAL，直接拷可能拿到「还没合并」的旧快照。
用自带脚本，它走 `VACUUM INTO`（事务一致的读快照），并同时备份上传的图片：

```bash
# 容器里跑（推荐，容器里有 node）
docker compose exec -T app node scripts/backup.mjs

# 或者本地
npm run backup
```

每次备份会在 `backups/<时间戳>/` 下生成 `guestbook.db`、`uploads/` 和 `manifest.json`
（清单里记着条目数、图片数、完整性检查结果，恢复时用来判断这份备份完不完整）。
默认保留最近 14 份，用 `KEEP` 改。

**恢复演练**——「备份成功」和「备份能恢复」是两件事：

```bash
docker compose exec -T app node scripts/restore-drill.mjs
# 或 npm run restore:drill
```

它把最新一份备份恢复到临时目录，逐项校验：`integrity_check`、各表行数与清单是否一致、
能不能真的查出公开留言、附件指向的图片文件在不在。**不碰正在用的 `data/`**，随时可跑。

真正的恢复操作就三步：停应用 → 用备份覆盖 `data/guestbook.db` 和 `data/uploads/` → 启动。

定时任务（宿主机 crontab）：

```cron
# 每天凌晨 4 点备份
0 4 * * * cd /opt/myblog && docker compose exec -T app node scripts/backup.mjs >> backups/cron.log 2>&1
# 每周日凌晨 5 点做一次恢复演练
0 5 * * 0 cd /opt/myblog && docker compose exec -T app node scripts/restore-drill.mjs >> backups/cron.log 2>&1
```

> 备份放在同一块盘上只能防误删，**防不了磁盘挂掉**。
> 记得把 `backups/` 同步到站外（另一块盘、对象存储、或者 `rclone` 到网盘）。

### 健康检查

`/healthz` 会真的去读一次数据库再回 JSON（`{"ok":true,"entries":N,...}`），
数据库打不开时返回 503。好处是「进程活着但数据库坏了」也能被发现——
只回 200 的探活等于没探。容器 healthcheck 和外部可用性监控都用它。

### 上线前检查清单

- [ ] `.env` 里改掉 `ADMIN_PASSWORD`（12 位以上）和 `GUESTBOOK_SALT`
- [ ] `SITE_URL` 设成真实地址——**它是构建期变量，改完必须重新 build**
- [ ] 挂上持久化卷（`./data`），或确认它在会被备份的路径下
- [ ] 配好 HTTPS 反代；**反代后面确认 `TRUST_PROXY=1` 且代理覆盖了 `X-Forwarded-For`**
- [ ] `./deploy.sh` 跑完自检全绿（含 `/healthz`、生产冒烟、备份与恢复演练）
- [ ] 打开 `/robots.txt` 和 `/sitemap-index.xml` 确认域名是你要的
- [ ] 随便发一条留言，确认能在 `/admin` 看到并通过审核
- [ ] 配好 `backups/` 的定时任务，并**把备份同步到站外**
- [ ] 想清楚定位：**仓库历史里仍有未打码的原图**。若仓库是公开的，
      任何人 clone 后翻历史都能拿到——要么转私有，要么重写历史

## 目录结构

```
src/
  components/         可复用组件（导航、页脚、主题切换、项目卡、画廊）
  content/
    projects/         项目（一篇 .md 一个项目）
    activities/       活动（一个目录一场活动）
  content.config.ts   内容字段规则
  data/site.ts        站点内容配置
  layouts/            页面外壳（HTML head、SEO、主题初始化）
  lib/                服务端逻辑（数据库、留言业务、登录、.env 加载、卡片渲染）
  pages/              一个文件 = 一个页面
    api/              表单提交接口（留言、管理动作）
    og.png.ts         站点分享卡片（构建时生成）
    rss.xml.ts        订阅源（服务端渲染，日记随时更新）
    robots.txt.ts     robots（sitemap 地址跟着 SITE_URL 走）
  styles/global.css   设计系统 + 全局样式
  utils/              日期格式化等小工具
scripts/              自检、冒烟、端到端测试脚本
public/               静态文件（图标、头像）
data/                 数据库文件（留言 / 日记，不进版本库）
Dockerfile            容器部署
```

## 进度

- [x] **P1** 骨架、设计系统、首页（简介 / 经历 / 关键词）、深浅色主题
- [x] **P2** 项目页、活动页（Markdown 内容集合 + 照片自动压缩与画廊 + 活动详情页）
- [x] **P3** 留言板 + 日记（SQLite、匿名留言、蜜罐、限流、审核开关、管理页）
- [x] **P4** 分享卡片（自动生成中文 og:image）、RSS、sitemap、robots、Docker 部署

## 分享卡片是怎么来的

`/og.png` 和每场活动的 `/og/activities/<slug>.png` 都是**构建时自动画出来的**，
不是手工做的图片——所以改了名字或标语，卡片会跟着变，不需要重新做图。

画卡片的逻辑在 `src/lib/og.ts`（SVG + sharp，走系统字体，因此不需要往仓库里塞 CJK 字体文件）。
想换卡片颜色，改那个文件顶部的 `COLORS`。
