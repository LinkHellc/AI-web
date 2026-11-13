# 美甲试甲工作台

上传**手部照片**和**美甲款式图**，自动生成保留原手型与皮肤细节的上甲效果图。生图使用 OpenAI **GPT-Image 2.0（`gpt-image-2`）** 的图片编辑接口，支持兼容 OpenAI 的中转地址。

## 功能

- 三步流程：上传素材 → 生成中 → 完成（进度条）
- 两张图都上传后自动生成（可在“更多选项”里关闭）
- **2026 爆款推荐**：22 款（牛奶果冻、冰透猫眼、巧克力樱桃、牛奶法式、珍珠微立体、Y2K 格纹等），按风格筛选，点选即试戴
- **我的款式库**：批量导入本地图片、粘贴图片链接导入、上传款式图一键收藏，支持重命名 / 删除，下次直接点选
- **示例手图**：没有照片也能先体验（`public/samples/hand.jpg`）
- 可选：`npm run gen-presets` 用生图接口给推荐款生成真实样图（会扣费），之后卡片显示样图、试戴也更稳定
- 可选：甲型、长度、质感、画质（快速/标准/精细）、输出尺寸、补充描述
- 后台内置约束：不美化手指、不磨皮美白、保留原始手型姿势与皮肤纹理
- 结果页：大图 + 左右拖动对比上甲前后、手部原图/款式卡片、重新生成、下载效果图、重置全部
- 试甲记录：自动保存，可查看、下载、恢复素材重生成、删除
- 手机/电脑自适应，深色模式；支持拖拽、粘贴截图；上传前自动压缩并转 JPG（兼容手机 HEIC/MPO 照片）
- 没配 Key 时进入**模拟模式**，可先把流程跑通

## 运行（Windows）

需要 Node.js 22 或更高版本（https://nodejs.org 下载 LTS）。不需要 `npm install`，项目没有第三方依赖。

1. 双击 `start.bat`。首次运行会生成 `.env` 并用记事本打开。
2. 在 `.env` 填写 `OPENAI_API_KEY`、`OPENAI_BASE_URL`（中转地址要以 `/v1` 结尾）。
3. 再次双击 `start.bat`，浏览器打开 http://localhost:3000 。

命令行方式：

```bash
npm run check        # 检查接口地址、Key、模型是否可用（不生图、不扣费）
npm run try-edit     # 真实调用一次图片编辑（低画质，会扣一次费），排查生图失败用
npm run gen-presets  # 给爆款推荐生成样图（会扣费，约 22 张）
npm start       # 启动服务
npm test        # 运行自动测试（用假接口，不扣费）
```

## 配置（.env）

| 变量 | 说明 | 默认 |
|---|---|---|
| `OPENAI_API_KEY` | API Key，**只放 .env，不要提交**。.env 的值优先于系统环境变量 | 空（模拟模式） |
| `OPENAI_BASE_URL` | 接口地址，中转填对方地址 + `/v1` | `https://api.openai.com/v1` |
| `OPENAI_IMAGE_MODEL` | 生图模型 | `gpt-image-2` |
| `OPENAI_IMAGE_FIELD` | 多图字段名，一般不用改；失败时会自动在 `image[]`/`image` 间切换 | `image[]` |
| `HTTPS_PROXY` | 代理，如 `http://127.0.0.1:7890`；连不上接口时填写 | 空 |
| `PORT` / `HOST` | 端口 / 监听地址。手机同一 Wi-Fi 访问用 `0.0.0.0` | `3000` / `127.0.0.1` |
| `ACCESS_CODE` | 访问口令，对外开放时建议设置 | 空 |
| `REQUEST_TIMEOUT_MS` | 单次生图超时 | `240000` |
| `MAX_CONCURRENT` | 同时生图数量上限 | `2` |
| `MOCK_MODE` | `1` 强制模拟模式 | `0` |

## 目录

```
server.js            后端（零依赖 Node 服务 + 接口）
lib/prompt.js        款式库、选项、提示词
public/              前端页面（index.html / style.css / app.js）
scripts/check-api.js 接口自检
test/                自动测试
data/                生成记录与图片（自动创建，已在 .gitignore）
docs/                过程记录与决策
```

## 接口

- `GET /api/config` 模型、款式库与选项
- `POST /api/tryon` `{ handImage, designImage?, presetId?, extra?, shape, length, finish, quality, size }`，图片为 dataURL
- `GET /api/history`、`DELETE /api/history/:id`
- `GET /api/library`、`POST /api/library`（`{ items: [{ image, name, tags }] }`）、`POST /api/library/import-url`（`{ url }`）、`PATCH/DELETE /api/library/:id`
- `POST /api/tryon` 也接受 `libraryId`（我的款式）；推荐款若有样图会自动作为参考图
- `GET /files/...` 记录里的图片
