# 部署到阿里云 / 腾讯云（香港轻量）

目标：从「刚买完机器」到「站点在公网可用」。全程照抄即可，不需要懂 Docker。

两家（阿里云轻量应用服务器 / 腾讯云轻量应用服务器）流程完全一样，
只有控制台里「防火墙」这一项的入口名称略有差别。

---

## 0. 买之前确认这 5 项

| 项 | 选什么 | 为什么 |
| --- | --- | --- |
| **地域** | **中国香港**（或新加坡） | 内地地域**必须备案**；香港免备案，且大陆访问延迟低 |
| **规格** | 2 核 2G | 够跑「构建镜像 + Caddy + Node」。1 核 1G 也能跑，但要先加 swap（见 §9） |
| **系统盘** | ≥ 40G | 镜像 + 数据 + 备份都要地方 |
| **镜像** | Ubuntu 22.04 / 24.04 | Docker 支持最好 |
| **时长** | 先买 1 个月或 1 年 | **别一次买三年**——先用一个月确认线路和速度 |

### 唯一可能产生意外费用的项：流量

轻量服务器是「峰值带宽 + 每月流量包」模式（例如 2 核 2G / 20Mbps / 0.5TB 每月）。
**超出流量包会按 GB 单独计费**，这是这类机器上最容易被忽略的账单来源。

买之前看清两件事：

1. 流量包是**每月**还是**总额**；
2. **超出后的单价**是多少。

对个人主页来说 0.5TB/月 用不完（页面都是静态的，图片已被压成 WebP）。
但如果你往站点传大量照片、或者有人刷你的图，就要留意。**可以设个用量提醒。**

---

## 1. 开放 80 / 443 端口（两步，缺一不可）

### 第一步：控制台里的防火墙

- **腾讯云轻量**：控制台 → 轻量应用服务器 → 选中实例 → **防火墙** → 添加规则
  放行 `TCP:80`、`TCP:443`（22 一般默认已开）
- **阿里云轻量**：控制台 → 轻量应用服务器 → **防火墙**（或安全组）→ 添加规则
  同样放行 `TCP:80`、`TCP:443`

> 只做这一步、不做第二步，或者反过来，都会表现为「服务器上 curl 通、外面打不开」。

### 第二步：系统内的防火墙

阿里云/腾讯云的 Ubuntu 镜像一般默认不拦，但**先确认一次**，别假设：

```bash
sudo ufw status                    # 若为 inactive 就没事
# 若为 active：
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp

sudo iptables -L INPUT -n | head   # 国内云一般没有额外 DROP 规则
```

---

## 2. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker

# 让当前用户能直接用 docker（不用每次加 sudo）
sudo usermod -aG docker $USER
newgrp docker

docker --version && docker compose version
```

两行都打印出版本号才算成功。`docker compose`（带空格）是 v2 插件，本项目需要它。

> 大陆地域的机器从 `get.docker.com` 拉取可能很慢，香港机器没问题。
> 如果卡住，换用系统源：`sudo apt update && sudo apt install -y docker.io docker-compose-v2`

---

## 3. 拉代码、配环境变量

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone https://github.com/EdwardXiao-bit/myblog.git
sudo chown -R $USER:$USER /opt/myblog
cd /opt/myblog

cp .env.example .env
vim .env
```

`.env` 里**必须改**这三项：

```ini
SITE_URL=http://你的公网IP        # 还没有域名就先写 IP；它是构建期变量
ADMIN_PASSWORD=换一个12位以上的强密码
GUESTBOOK_SALT=随便一串随机字符
```

`SITE_DOMAIN` 先**留空**——先用 IP 跑通，买了域名再填（见 §6）。
`MODERATION` 保持 `on`（上线建议先审核后显示）。

> `SITE_URL` 是**构建期**变量：canonical 链接、RSS、sitemap、分享卡片都用它。
> 改它必须重新跑一次部署（`./deploy.sh` 会重新构建），光重启容器没用。
> `deploy.sh` 会检查它是不是还是占位的 `example.com`，是就拒绝部署。

> 仓库如果是私有的，`git clone` 会要认证。用 GitHub 的 Personal Access Token
> 拼进 URL，或者在这台机器上生成 SSH key 加到 GitHub（Deploy key）。

---

## 4. 部署

```bash
./deploy.sh
```

它会依次做：

1. 前置检查（`.env` 缺项、占位 `SITE_URL`、弱口令 → 直接拒绝）；
2. `docker compose build`（第一次会久一点，几分钟）；
3. 启动并轮询 `/healthz`，最多等 2 分钟；
4. 跑生产冒烟（含「反代下不同访客是否被区分」的断言）；
5. 立刻做一次备份，并跑一次**恢复演练**验证这份备份真的能用。

任何一步失败都会**明确报错退出**，不会丢一句「部署完成」让你自己去发现站是坏的。

看到最后打印访问地址，就是成功了。

---

## 5. 验收（这一步最重要）

```bash
# 在服务器上自测
curl -s localhost/healthz
# 期望：{"ok":true,"entries":0,...}

curl -sI localhost | head -1
# 期望：HTTP/1.1 200 OK（或 308 跳转）
```

然后**关掉手机 WiFi，用 4G/5G 流量**打开 `http://你的公网IP/`。

> 为什么非要用手机流量测：你电脑上开着代理、或者和服务器走同一条线路，
> 都可能让「其实访客打不开」被掩盖过去。**这是唯一真正重要的验收项。**

进去之后顺手试：

- 打开首页、项目、活动页，照片能正常显示；
- 在留言板发一条留言 —— 因为 `MODERATION=on`，它会进审核队列；
- 访问 `/admin`，用你设的密码登录，通过审核，回留言板确认显示出来了。

---

## 6. 接域名 + HTTPS（可选，但推荐）

**香港服务器 + 域名不需要备案**（备案只约束内地服务器）。所以这一步很轻：

1. 域名解析一条 A 记录指向服务器公网 IP；
2. 等解析生效（`ping 你的域名` 能看到那个 IP）；
3. 改 `.env`：

   ```ini
   SITE_URL=https://你的域名
   SITE_DOMAIN=你的域名
   ACME_EMAIL=你的邮箱
   ```

4. 再跑一次 `./deploy.sh`。

Caddy 会自动向 Let's Encrypt 申请证书并自动续期，80 端口会自动跳 443。

> 证书签发要求 **80 端口从公网可达**。如果 §1 的安全组没放开 80，
> 这里会失败（表现为一直拿不到证书）。

域名注册建议在阿里云（万网）或腾讯云，并做好**实名认证**（这是域名实名，不是网站备案）。

---

## 7. 配定时任务：备份 + 每周恢复演练

```bash
crontab -e
```

加入：

```cron
# 每天凌晨 4 点备份
0 4 * * * cd /opt/myblog && docker compose exec -T app node scripts/backup.mjs >> backups/cron.log 2>&1
# 每周日凌晨 5 点做一次恢复演练（验证备份真的能恢复）
0 5 * * 0 cd /opt/myblog && docker compose exec -T app node scripts/restore-drill.mjs >> backups/cron.log 2>&1
```

备份落在 `/opt/myblog/backups/`，默认保留最近 14 份。

> **备份和机器在同一块盘上，只能防误删，防不了磁盘挂掉。**
> 有条件就再同步一份到站外（另一台机器、对象存储、或者 `rclone` 到网盘）。
> 阿里云/腾讯云的对象存储都有免费额度，够放这个站的备份。

---

## 8. 出问题怎么查（按顺序）

```bash
# 1) 容器活着吗、健康吗
docker compose ps

# 2) 应用日志（最近 100 行）
docker compose logs --tail 100 app

# 3) Caddy 日志（证书问题看这里）
docker compose logs --tail 100 caddy

# 4) 服务器内部通不通（排除防火墙因素）
curl -sI localhost | head -1
curl -s localhost/healthz

# 5) 数据库状态
docker compose exec -T app node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/guestbook.db');console.log(d.prepare('select count(*) n from entries').get())"
```

| 症状 | 多半是 |
| --- | --- |
| 服务器上 curl 通，外面打不开 | §1 的两步防火墙（安全组 / 系统内）漏了一步 |
| 一直拿不到证书 | 80 端口从公网不可达；或域名还没解析生效 |
| `deploy.sh` 在健康检查处失败 | 看 `docker compose logs app`，通常是 `.env` 写错 |
| 留言板发不出去 | 看 `/healthz` 是否 200；限流是**每 IP 每小时 5 条**（正常用不会碰到） |
| 页面正常但样式/图片 404 | 换过 `SITE_URL` 后没重新构建（`./deploy.sh` 会重建） |

---

## 9. 附：只有 1 核 1G 时的 swap

2 核 2G 不需要。如果你买的是 1G 小机器，构建镜像时可能 OOM，先加 2G swap：

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

---

## 10. 更新站点

```bash
cd /opt/myblog && ./deploy.sh --pull
```

拉最新代码 → 重新构建 → 滚动重启 → 自检 → 备份。自检不过会报错退出，
不会把坏版本留在线上。

---

## 关于「这个流程验证到什么程度」

诚实说明（免得你踩坑时以为是我没测）：

- **已验证**：生产构建、standalone 服务器运行、`/healthz`、生产冒烟（38 项）、
  备份与恢复演练（14 项）、留言板端到端（129 项）、`docker-compose.yml` 与
  `Caddyfile` 的结构与关键配置（22 项断言）、`deploy.sh` 的 bash 语法与弱口令检查。
- **未验证**：**Docker 本身从未真正跑起来过**（开发这台机器上没装 Docker）。
  所以「镜像构建、卷挂载、容器间网络、Caddy 实际签发证书」这几件事，
  第一次部署时才是它们第一次真实运行。

`deploy.sh` 的自检就是为了在这个阶段把问题当场拦下来：
它会在容器不健康或冒烟失败时**直接报错退出**，而不是让你以为部署成功了。
