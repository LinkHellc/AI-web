# AI-web

两个独立的 AI 图像小工具，各自一个文件夹，互不依赖，可分别启动、分别部署。

| 文件夹 | 项目 | 本地端口 |
| --- | --- | --- |
| `nail-tryon-studio/` | 美甲试甲工作台：手部照片 + 款式图 → 试戴效果 | 3000 |
| `ai-photo-studio/` | AI 写真工作台：模特资产 + 服装 + 拍摄模式／动作库批量出图，另含 3D 镜头换机位 | 3001 |

## 启动

两个项目都是零依赖的 Node.js 22+ HTTP 服务，没有 `npm install` 步骤：

```bash
cd nail-tryon-studio && npm start     # http://localhost:3000
cd ai-photo-studio   && npm start     # http://localhost:3001
```

Windows 下也可直接双击各自目录里的 `start.bat`。

辅助命令：`npm test`（模拟模式跑通流程，不调用接口、不扣费）、`npm run check`（只查 `/models`，确认 Key／地址／模型可用）。

## 配置

每个目录都带一份 `.env`，其中 **`OPENAI_API_KEY` 已留空**，其余为已验证的接口地址、模型名和运行参数。在本机填入自己的 Key 即可使用；不填 Key 时服务会进入模拟模式（走通流程但不出真图）。

> ⚠️ 这是公开仓库。`.env` 是脱敏模板，填入真实 Key 后**不要提交**它的改动。
> 建议执行 `git update-index --skip-worktree <目录>/.env` 忽略本地改动，或把真实配置放进 `.env.local`（已忽略）。

## 目录说明

- `server.js`：零依赖 Node 后端；`lib/`：环境读取、提示词与预设；`public/`：原生 HTML／JS／CSS。
- `public/samples/`：示例素材，来源与授权见 `credits.json`。
- `docs/`：设计取舍与过程记录。
- 运行时数据写入各项目自己的 `data/`（模特照片、作品、历史），**不进版本库**。
- 未上传：本地 `data/`、WorkBuddy／发布平台记录、历史更新包、第三方页面存档。

两个项目可以同时在本地运行；写真工作台的后端会把生图改成「提交任务 + 轮询」，因此部署到带网关超时限制的平台时不会因单张图耗时较长而被中断。
