# Endfield Mod Manager

> 面向 Windows 平台《明日方舟：终末地》（Arknights: Endfield / `EFMI · XXMI`）的纯本地 Mod 管理器，基于 **Tauri v2（Rust + Edge WebView2）+ React 19 + TypeScript + Tailwind CSS v4** 构建。

## 核心特性

- **纯本地离线**：免登录、无遥测与广告；全部配置、外观分区、标签池、预设方案与自定义壁纸均保存在本地。
- **角色与外观管理**：内置干员与非角色分类，支持中文/英文别名/拼音检索、自定义排序与置顶、16:10 / `303×386` 封面裁剪、外观分区、合集折叠与排他开关。
- **INI / 冲突与防崩溃保护**：解析并录制写回 `.ini` 快捷键、检测 Hash 冲突与 `RabbitFX` 单实例、`DISABLED_` 无损切换，并提供多步撤销（`Ctrl+Z`）与时间快照修复回滚。
- **局内浮窗与状态桥接**：全局热键（默认 `Alt+F`）呼出双窗体透明浮窗，支持后台 F10 重载、UIPI 权限检测，以及独立 `EFMI\efmm\` 命名空间的 `Persist Bridge` 状态持久化。
- **批量导入与离线体检**：支持拖拽导入 ZIP / 7z / RAR / `QAQ` MP4 加密包、目录整理隔离、8 项环境诊断，以及 `XXMI / EFMI` 本地包安全升级。

## 安装与升级

- **Windows 便携版（推荐首次下载）**：解压 `EndfieldModManager-v<版本>-windows-x64-portable.zip` 至任意目录，双击 `EndfieldModManager.exe` 运行（内置 `portable.flag`，数据保存在同级 `data\`）。
- **Windows 安装版**：运行 `EndfieldModManager_<版本>_x64-setup.exe` 按向导安装。
- **应用内热更新**：在「设置 → 软件版本与 GitHub 更新」检查并一键更新。每次发版的 `update.zip` 均为**完整自包含包**并兼容 `latest.json` schema v1，支持早至 `v0.1.0` 的任意旧版本跨多版本直升最新版，且完整保留 `data/`、`portable.flag` 及所有本地配置。

## 数据目录优先级与安全说明

1. 环境变量 `EFMM_DATA_DIR` 指定的目录；
2. 便携模式（主程序同级存在 `portable.flag` 或 `data\`）下的同级 `data\`；
3. 默认系统目录 `%APPDATA%\EndfieldModManager`。

> 对 `EFMI\Mods` 的修改主要基于 `DISABLED_` 前缀切换、时间戳备份与系统回收站；仍建议首次使用前自行备份个人 Mod 库。

## 本地开发与构建

需要 **Node.js 20+**、**Rust（Windows MSVC）** 与 **Windows 10/11（Edge WebView2）**：

```powershell
# 安装前端依赖 & 启动开发模式
npm.cmd install
npm.cmd run tauri dev

# 类型检查、前端构建与 Rust 单元测试
npx.cmd tsc --noEmit
npm.cmd run build:frontend
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture

# 生成 Portable ZIP / Update ZIP / NSIS 安装包 / latest.json 到指定目录
node scripts/build-release.mjs --output-directory release-artifacts --notes "EndfieldModManager vX.Y.Z"
```

> Agent 开发、版本同步与自动发版细则见 [AGENTS.md](./AGENTS.md)。
