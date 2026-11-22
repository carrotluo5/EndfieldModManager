# Endfield Mod Manager

> 面向 Windows 平台《明日方舟：终末地》（Arknights: Endfield / EFMI · XXMI）打造的高性能纯本地 Mod 管理器。

采用 **Tauri v2（Rust + Edge WebView2）+ React 19 + TypeScript + Tailwind CSS v4 + Motion** 构建，聚焦终末地 `EFMI / XXMI` 生态的日常管理与局内快捷体验。

---

## 核心定位与原则

- **100% 纯本地离线**：无需登录账号，不包含联网遥测、云端评论、赞助弹窗与商业壁垒；所有配置、外观分区、标签池、预设方案与局部背景图均保留在本地。
- **专精《明日方舟：终末地》（EFMI / XXMI）**：围绕 3DMigoto `EFMI\Mods` 目录管理角色、外观分区与预设。
- **高性能低占用**：Rust 原生并发扫描 `Mods` 目录与 `.ini` 解析，离屏 Canvas 预模糊自定义壁纸，4 级毛玻璃/动效降级档位。

---

## 主要功能

1. **角色总览与外观分区**
   - 内置《明日方舟：终末地》干员与非角色分类（`NPC` / `大世界` / `UI` / `功能` / `武器` / `其他`），支持中文、英文别名、全拼与首字母拼音检索（`pinyin-pro`）。
   - 拖拽自定义角色排序、卡片置顶、16:10 / `303×386` 封面裁剪（`_cover.png`）、旧版英文目录向中文目录迁移、以及外观分区（`AppearanceSection`）分组管理。

2. **Mod 列表、合集折叠与详情面板**
   - `DISABLED_` 启用/禁用原子重命名切换、排他模式与智能同系列变体合集折叠。
   - 完整解析 `.ini` 快捷键（支持键盘录制直改写回 `.ini` 源文件）、纹理/模型 Hash 冲突检测、`RabbitFX.ini` 单实例防崩溃保护。
   - 自定义本地标签池（多标签 AND 组合筛选）、收藏书签、备注、16:10 预览图裁剪与大图灯箱查看。

3. **预设方案（Presets）与多步撤销**
   - 一键捕获当前启用状态创建/覆盖预设，内置「无 Mod 纯净预设」，支持可视化勾选编辑与 JSON 导入导出。
   - 记录开关切换与预设应用 Delta，支持 `Ctrl+Z` / 一键撤销回退并同步 `RabbitFX` 保护检查。

4. **双窗体局内快捷浮窗（Overlay）与 Persist Bridge**
   - 全局热键（默认 `Alt+F`）呼出游戏内透明悬浮窗及智能左右自适应展开的 `side-panel`（角色气泡模式与详情切皮模式）。
   - Rust Win32 原生输入桥接（向导兼容后台 F10 重载与修饰键+主按键转发）与游戏/管理器 UAC 权限对齐检查（UIPI 提醒与一键提权重启）。
   - `Persist Bridge` 使用 `EFMI\efmm\` 下自己的 INI 与缓存、`EFMM\Persist\` 命名空间及 `.efmm-persistbak` 备份。默认关闭。检测到旧桥接仍在管理同一套 Mod 时，先在旧软件关闭其状态持久化并恢复原始 INI，再启用本软件的桥接。

5. **拖拽安装向导、目录整理、修复与离线诊断**
   - **批量导入向导**：支持全屏拖拽、ZIP（自动兼容 GBK/UTF-8）、7z/RAR（优先调用 `7za.exe`/`UnRAR.exe`，回退 Windows 11 原生 `tar.exe`）与 `QAQManager` v2 MP4 伪装包解密，支持 EFF 特效 Mod 识别、>10GB 大包提醒与角色/分区指定。
   - **目录整理与体检**：检测缺失默认干员目录、旧版英文目录迁移、组 A 错放 Mod 归位与组 B 散落零碎文件安全隔离（`DISABLED_loose-时间戳`）。
   - **Mod 修复与无损回滚**：修复前自动将目标 `.ini` 快照备份至 `.efmm-backups/<时间戳>/`，支持内置规范化引擎或外部 `Fixer.exe`，并可随时一键回滚。
   - **8 项离线诊断**：检查 XXMI/EFMI 路径对齐、`d3dx.ini [Include]`、RabbitFX 单实例、Hash 冲突、EFF 误放、根目录脏文件、UIPI 权限与 Persist Bridge 状态。
   - **安全包升级与 4 步初始化向导**：覆盖更新本地 XXMI/EFMI 包时保留 `Mods`、`d3dx_user.ini`、`XXMI Launcher Config.json` 与状态持久化目录。

6. **个性化与系统设置**
   - 四套免登录本地主题（樱粉浅色 / 午夜暗色 / 终末地工业暗 / 极简纯白）、自定义强调色、多张本地背景图轮换（离屏预模糊 / 遮罩浓度 / 不透明度）、侧边栏缩放与兼容降级档位。
   - 支持注册表 `Endfield.exe` 探测、Windows 开机自启动开关、完整配置 JSON 导入导出与便携模式。
   - **GitHub Releases 自动更新**：仅在用户主动检查更新（或开启启动提示开关）时连接 GitHub Releases / 镜像下载，支持 `latest.json` SHA-256 校验、PE 头验签与就地热更新重启（仅替换可执行程序与可选 `bin/`，完全保留 `data/` 与 `portable.flag`；私有仓库可按需配置只读 GitHub Token）。

---

## 目录与数据存储模式

软件按以下优先级解析本地配置与缓存目录：

1. 若设置了环境变量 `EFMM_DATA_DIR`，优先使用该目录；
2. 若主程序 `EndfieldModManager.exe` 同级目录存在 `portable.flag` 或 `data\` 文件夹，则自动启用**便携模式**，将数据保存在同级 `data\` 中；
3. 否则默认保存至 `%APPDATA%\EndfieldModManager`。

使用 `EFMM_DATA_DIR` 或便携模式时，主窗口与两个浮窗的 WebView2 数据（包括视图偏好）也会写入该目录的 `webview\`。

> 对 `EFMI\Mods` 执行的所有操作均遵循可逆原则（`DISABLED_` 前缀切换、安全隔离或系统回收站），并建议在首次使用前为个人 Mod 库做好备份。

---

## 安装与使用

本项目构建后可直接双击 `D:\MOD\EndfieldModManager\EndfieldModManager.exe`。该目录旁的 `data\` 保存便携配置，重复构建会更新程序文件。

### Windows 便携版（Portable ZIP — 推荐首次下载）
解压 `EndfieldModManager-v0.1.0-windows-x64-portable.zip` 至任意目录，双击 `EndfieldModManager.exe` 运行；压缩包内自带 `portable.flag`，配置、背景与 WebView 数据独立保存在同级 `data\`，绿色免安装。

### 应用内更新包（Update ZIP + `latest.json`）
每次 GitHub 发版会同时附带 `EndfieldModManager-v<版本>-windows-x64-update.zip` 与 `latest.json`。每个 `update.zip` 均为完整自包含运行包（非仅针对上一版本的增量补丁），并遵循 `latest.json` schema v1 兼容契约（含 `schemaVersion` 与 `minSupportedClientVersion`），支持早至 `v0.1.0` 的任意旧版本客户端跨多版本一键直升最新版；在软件「设置 -> 软件版本与 GitHub 更新」中点击检查更新后可自动下载校验并热更新重启，全程保留本地 `data/`、`portable.flag` 及所有配置；手动覆盖也可直接解压 `update.zip` 覆盖原程序（不包含 `portable.flag` 与 `data/`）。

### Windows 安装版（NSIS）
运行 `EndfieldModManager_0.1.0_x64-setup.exe`，按简体中文向导安装即可（默认为当前用户安装，无需管理员权限）。

---

## 本地开发与构建

### 环境要求
- Node.js 20+ 与 npm
- Rust 工具链（`cargo` / `rustc`，Windows MSVC）
- Windows 10 / Windows 11（Edge WebView2）

### 常用命令

```powershell
# 安装前端依赖
npm.cmd install

# 启动开发模式（Vite + Tauri）
npm.cmd run tauri dev

# 构建并发布便携 EXE 到 D:\MOD\EndfieldModManager
npm.cmd run build

# 单独检查和构建前端
npm.cmd run build:frontend

# 运行 Rust 单元测试（纯临时目录隔离，不写入真实 %APPDATA% 与 D:\MOD）
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture

# 同时生成 NSIS 安装包、便携 ZIP、更新包 ZIP 与 latest.json 清单
npm.cmd run build:release
# 或指定输出到仓库 release-artifacts 目录：
node scripts/build-release.mjs --output-directory release-artifacts --notes "EndfieldModManager v0.1.0"
```

可选组件：若需要极速外部解压支持，可将合法获取的 `7za.exe` 与 `UnRAR.exe` 放入 `src-tauri/bin/`，构建脚本会自动一并打入便携包。

---

## V2 后续规划

- GameBanana 模组直连浏览、MD5 校验下载与自动命名落盘。
- 新版本干员默认封面（`303×386`）与别名词表同步工具。
