---
title: 新加坡国立大学暑期研习
date: 2026-07-30
location: 新加坡 · NUS School of Computing
summary: 参加 NUS 计算机学院暑期课程 Introduction to 2D Game Development，三人组队做出 2D 平台解谜游戏《Stopover》，结业成绩 A。
cover: ./cover-nus-building.jpg
photos:
  - ./welcome-dinner.jpg
  - ./classroom.jpg
  - ./showcase.jpg
  - ./computing-gallery.jpg
  - ./whiteboard.jpg
  - ./farewell-dinner.jpg
  - ./certificate.jpg
  - ./transcript.jpg
  - ./merlion.jpg
captions:
  - Welcome Dinner，和不同学校的同学聊各自做过的游戏
  - 教室里赶进度
  - 项目展示：《Stopover》的展台
  - Computing Gallery 里的老游戏机
  - 机房白板，被画成了 Rick and Morty
  - Farewell Dinner
  - Certificate of Completion
  - 成绩单：A
  - 结课后去市区逛了鱼尾狮公园
order: 1
---

2026 年 5 月到 7 月，在新加坡国立大学计算机学院（NUS School of Computing）参加了暑期课程
**Introduction to 2D Game Development**，由 Kelvin Sung 教授主讲。结业成绩 A。

## 项目

三人组队，完整走了一遍工业化开发流程：提案 → 原型验证 → 初版 → Alpha 测试 → Beta 测试，
最终产出 2D 平台跳跃解谜游戏 **《Stopover》**。

游戏以「双世界切换」为核心解谜机制：玩家在两个平行场景之间切换视角、交互物件来破解关卡。
叙事从「死神与社畜的相遇」开始，讲死神引导主人公回溯生前记忆、逐步走向生命终点。

我在组里负责 **UI 系统、音效体系与视觉特效**：

- **音效**：用面向对象的方式把 BGM 和场景音效分层封装，实现动态加载、随场景切换与音量控制
- **视觉特效**：为了做出复古显像管的雪花屏，参考了 NVIDIA GPU Gems 里
  《Fast Fluid Dynamics Simulation on the GPU》的思路，用二维流体速度场和密度扩散驱动
  噪点粒子流动与消散——这个效果后来成了整部作品视觉风格的核心

## 课堂之外

- Campus Walk 认路，参观了 Computing Gallery 和 COM1
- Welcome Dinner 上和不同学校的同学交流各自做过的游戏
- 结课后去市区走了走

## 学到的东西

技术上最大的收获是把零散的经验串成了体系：以前做游戏停在「会调用引擎功能」，
这次弄清楚了 Unity 的组件式架构、2D 渲染管线和场景资源管理的底层关系。

工程上则是第一次真切体会到协作的难。三个人并行开发，Git 冲突、玩法分歧、工期压力都碰上了；
最后靠统一分支规范、把每个人的诉求摆开谈优先级、重新倒排工期解决。
这部分大概比技术本身更值钱。
