# 交接文档：博客切正式域名上线（2026-11-02）

> 临时文档。**上线验收全部通过后删掉这份文件，不要提交进仓库。**
> 接手者零上下文即可按本文继续，不需要回看之前的对话。

## 一句话现状

域名 `edwardxiao.space` 的 ICP 备案已通过（渝ICP备2026027564号），站点目前仍以 `http://8.137.154.34` 裸 IP 运行且健康；**尚未切域名**，卡在两件必须由用户在阿里云控制台完成的动作，以及一次待用户批准的 git push。

## 目标

把 `/opt/myblog` 上的 Astro 站点从 `http://8.137.154.34` 切到 `https://edwardxiao.space`（Caddy 自动签 Let's Encrypt 证书），页脚挂上备案号，完成上线验收。

## 硬事实（都已核实，可信）

| 项 | 值 |
| --- | --- |
| 域名 | `edwardxiao.space`，DNS 在**阿里云云解析**；当前**没有任何 A 记录**（尚未解析，符合备案期规范） |
| ICP 备案号 | `渝ICP备2026027564号`（重庆管局） |
| 公安联网备案 | **未办**。用户说自己晚上办，须在网站开通后 30 日内完成（beian.gov.cn） |
| 服务器 | 阿里云 ECS `8.137.154.34`，用户 `root`，SSH 22 |
| 系统 | Ubuntu 26.04.1 LTS，2 核 / 1.7G 内存 / 40G 盘（用 23%） |
| SSH 认证 | 公钥已装好。本地 `~/.ssh/id_rsa`（RSA 4096，`edward@LAPTOP-BO6KM4OM`）可直连，无需密码 |
| 仓库（服务器） | `/opt/myblog`，HEAD `0a6562b` |
| 容器 | `myblog-app-1` healthy（6 天）、`myblog-caddy-1` up（7 天） |
| 对外端口 | **80 TCP 可连**（`http://8.137.154.34/healthz` → 200）；**443 TCP 从外部连不上** ← 阻塞项 |
| 数据 | `data/guestbook.db`：**0 留言 / 0 点赞 / 0 表情 / 0 附件**，`data/uploads/` 空 → 重部署零风险 |
| 数据挂载 | `./data` 与 `./backups` 都是宿主机挂载卷，不在 git 跟踪范围内，重新 build/部署不会丢 |
| 备份 | cron 正常：每天 04:00 备份、每周日 05:00 恢复演练。已有 11 份，最新一份 UTC 目录名 `2026-11-01_20-00-01`（= 北京时间 11-02 04:00）；最近一次恢复演练 14 通过 / 0 失败 |
| 镜像源 | 已解决。服务器 `.env` 里 `BUILDX_BUILDER=cn-mirror`、`NODE_IMAGE=docker.m.daocloud.io/library/node:24-slim` |
| 本地仓库 | `C:/Users/Ed/dsh_workspace/myblog`，`main` = `b3f91b8`，**ahead origin/main 2 个提交** |

## 已完成

1. **ICP 号已填进代码**：`src/data/site.ts` 第 123 行 `icp: '渝ICP备2026027564号'`（1 行改动，**本地未提交、未推送**）。`police` 仍为空字符串，公安备案号下来后再填。
2. **本地按生产地址构建验证通过**（`SITE_URL=https://edwardxiao.space npm run build`），产物已 grep 确认：
   - `dist/client/index.html` 里有 `渝ICP备2026027564号`，且链向 `beian.miit.gov.cn`
   - `<link rel="canonical" href="https://edwardxiao.space/"` 正确
   - `robots.txt` / `sitemap.xml` 里全是 `https://edwardxiao.space`
3. **服务器基线已摸清**（见上表），确认无线上数据损失风险。

## 未完成 / 卡点

### 卡点 A（用户做，我没有阿里云控制台权限）

1. **安全组入方向放行 TCP 443**。80 通但 443 不通；Caddy 默认优先走 443 的 TLS-ALPN-01 校验，443 被挡会导致证书签发长时间超时重试。
2. **云解析加两条 A 记录**：`@` → `8.137.154.34`、`www` → `8.137.154.34`，TTL 600。

### 卡点 B（用户批准）

**push 待批准**。要推的是 3 项：

```
9b7c7cf feat(home): 题注改为逐字解码（乱码跳动后锁定），光标解码时常亮
b3f91b8 fix(home): 悬停只暂停翻牌，不再打断退格/解码，避免题注停在半截
（未提交）src/data/site.ts: icp 填号
```

前两个提交只动 `src/components/CardDeck.astro`（+111 / −21），是首页翻牌交互。**用户的硬规矩：commit / push 必须先经他明确同意**；部署动作（改 `.env`、跑 `deploy.sh`）可以直接做。

## 接下来的精确步骤

按顺序，**不要提前把反向代理切到域名**（DNS 未生效时 Caddy 会立刻尝试签发并进入指数退避，留下难看中间态）。

### 1. 等 DNS 生效

```bash
nslookup edwardxiao.space 223.5.5.5 | tail -3   # 期望出 8.137.154.34
nslookup www.edwardxiao.space 223.5.5.5 | tail -3
```

同时确认 443 通了（在**本地**跑，不要在服务器上跑）：

```bash
timeout 8 bash -c 'exec 3<>/dev/tcp/8.137.154.34/443' && echo "443 ok"
```

### 2. 推代码（用户同意后）

```bash
cd C:/Users/Ed/dsh_workspace/myblog
git add src/data/site.ts && git commit -m "chore(seo): 填 ICP 备案号 渝ICP备2026027564号"
git push origin main     # 推到 ssh://git@ssh.github.com:443/EdwardXiao-bit/myblog.git
```

### 3. 服务器改 `.env`（三处，别漏；先备份）

```bash
ssh root@8.137.154.34 'cd /opt/myblog && cp .env .env.bak-$(date +%F) && \
  sed -i "s|^SITE_URL=.*|SITE_URL=https://edwardxiao.space|" .env && \
  sed -i "s|^SITE_DOMAIN=.*|SITE_DOMAIN=edwardxiao.space|" .env && \
  sed -i "s|^ACME_EMAIL=.*|ACME_EMAIL=1062355602@qq.com|" .env && \
  grep -E "^(SITE_URL|SITE_DOMAIN|ACME_EMAIL)=" .env'
```

> `ACME_EMAIL` 建议用 `1062355602@qq.com`（取自 `src/data/site.ts` 的 public email）；想换别的就让用户说。
> **绝对不要动** `ADMIN_PASSWORD` / `GUESTBOOK_SALT`：`GUESTBOOK_SALT` 一改，所有点赞/表情的 IP 去重记录立即失效（等于重置）。
> 服务器的 `.env` 是完整生产配置；本地那份只有 `ADMIN_PASSWORD`/`GUESTBOOK_SALT`，**不要拿本地的覆盖服务器的**。

### 4. 拉代码 + 部署

```bash
ssh root@8.137.154.34 'cd /opt/myblog && git pull --ff-only && ./deploy.sh'
```

`deploy.sh` 自带：前置环境检查 → 构建（`SITE_URL` 作为 build arg 写进产物）→ 起容器 → 等 health → 容器内冒烟（含 `--expect-proxy`，断言不同访客 IP 能区分）→ 立即备份 + 恢复演练。任一步失败会明确报错退出，不要跳过后声称成功。

注意 `SITE_URL` 是**构建期**变量：改完必须重新 build，光 `docker compose restart` 无效。

### 5. 验收（在服务器**之外**的机器跑）

```bash
# 逐项手验；技能 vps-site-deploy 自带 scripts/check-site-live.sh 可一次跑完
nslookup edwardxiao.space 223.5.5.5
curl -sS -o /dev/null -w '%{http_code}\n' https://edwardxiao.space/healthz     # 200
curl -sS https://edwardxiao.space/ | grep -o '渝ICP备2026027564号'               # 出现
curl -sS https://edwardxiao.space/ | grep -o 'beian.miit.gov.cn'               # 出现
curl -sSI http://edwardxiao.space/ | head -1                                    # 应 308 跳 https
echo | openssl s_client -connect edwardxiao.space:443 -servername edwardxiao.space 2>/dev/null | openssl x509 -noout -dates
ssh root@8.137.154.34 'cd /opt/myblog && docker compose ps'                     # 两个 healthy
ssh root@8.137.154.34 'cd /opt/myblog && docker compose logs --tail 40 caddy'   # 看证书签发有没有报错
```

还要人工过的两条：

- 手机**关 WiFi 走 4G/5G** 打开 `https://edwardxiao.space/`，首页与照片正常（同网络测不出 DNS/安全组问题）
- 留言板发一条 → 进审核 → `/admin` 通过 → 前台出现（`MODERATION=on`）

### 6. 上线后可选

- 屏蔽 IP 直连，只认域名。**必须等 `SITE_DOMAIN` 已填好再做**，否则 Caddy 起不来。在 `Caddyfile` 站点块最前面加：

  ```caddyfile
  	@not_ours not host {$SITE_DOMAIN} www.{$SITE_DOMAIN} localhost 127.0.0.1
  	respond @not_ours "本站只通过域名访问。" 403
  ```

  然后先 validate 再 reload：`docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile` → `caddy reload ...`。验证 `curl -I http://8.137.154.34` 得 403。
- 公安备案号下来后填 `src/data/site.ts` 的 `police: '渝公网安备 xxxxxxxxxx 号'`，**重新部署**才生效（页脚对空值不渲染）。

## 坑（踩过的，别再踩）

- **SSH `Permission denied (publickey,password)` 但端口通** = 服务器 `authorized_keys` 缺公钥，不是本地密钥坏了。先验本地密钥对自洽：`ssh-keygen -y -f ~/.ssh/id_rsa | awk '{print $1,$2}' | sha256sum` 与 `awk '{print $1,$2}' ~/.ssh/id_rsa.pub | sha256sum` 一致即正常（本次已验证一致，公钥已由用户在控制台装好，现在可直连）。**永远不要向用户索取密码。**
- **80 通 ≠ 443 通**。本次就踩了：备案期只放行了 80。
- **在服务器上 `curl localhost` 永远 200**，证明不了外部可达性；端口必须在本地探。
- **远程容器里查 SQLite 别硬套引号**，多层 ssh 引号会被吃掉。写成 `.mjs` 传上去：
  `scp q.mjs root@HOST:/tmp/q.mjs && ssh root@HOST 'cd /opt/myblog && docker compose cp /tmp/q.mjs app:/tmp/q.mjs && docker compose exec -T app node /tmp/q.mjs'`
  且 `package.json` 有 `"type": "module"`，脚本里用 `import`，`require('node:sqlite')` 会报 `require is not defined in ES module scope`。
- **别用备份目录名判断漏跑**：目录名是 UTC，凌晨 4 点的任务显示成前一天 20:00。
- `backups-legacy/`（124K）是历史备份，未跟踪，**别删**。
- 项目自己的 `docs/deploy-mainland.md` §3 起就是备案后上线清单，和本文一致，冲突时以它 + 实际核查为准。

## 合规待办（用户侧）

- [ ] 公安联网备案（30 日内，用户说晚上自己办）
- [ ] 公安备案号下来后填 `police` 字段并重新部署
- [ ] 访问日志留存 ≥6 个月（Caddy 日志默认落盘，别关）
- [ ] 留言保持 `MODERATION=on`（个人备案对交互功能敏感）
- [ ] 个人备案不得有广告/付费/导流入口
