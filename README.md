# Endfield Mod Manager

> 面向 Windows 平台《明日方舟：终末地》（Arknights: Endfield / EFMI · XXMI）打造的高性能纯本地 Mod 管理器。

采用 **Tauri v2（Rust + Edge WebView2）+ React 19 + TypeScript + Tailwind CSS v4 + Motion** 构建，聚焦终末地 `EFMI / XXMI` 生态的日常管理与局内快捷体验。

---

## 核心定位与原则

- **100% 纯本地离线**：无需登录账号，不包含联网遥测、云端评论、赞助弹窗与商业壁垒；所有配置、外观分区、标签池、预设方案与局部背景图均保留在本地。
- **专精《明日方舟：终末地》（EFMI / XXMI）**：围绕 3DMigoto `EFMI\Mods` 目录规范设计，只读迁移旧版 `QAQManager` 配置与预设，绝不篡改游戏客户端本体。
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
   - `Persist Bridge` 状态同步与恢复（`qaqm\qaqm_includer.ini` + `.qaqm-persistbak` 备份与 `LRU` 最近禁用缓存槽）。

5. **拖拽安装向导、目录整理、修复与离线诊断**
   - **批量导入向导**：支持全屏拖拽、ZIP（自动兼容 GBK/UTF-8）、7z/RAR（优先调用 `7za.exe`/`UnRAR.exe`，回退 Windows 11 原生 `tar.exe`）与 `QAQManager` v2 MP4 伪装包解密，支持 EFF 特效 Mod 识别、>10GB 大包提醒与角色/分区指定。
   - **目录整理与体检**：检测缺失默认干员目录、旧版英文目录迁移、组 A 错放 Mod 归位与组 B 散落零碎文件安全隔离（`DISABLED_loose-时间戳`）。
   - **Mod 修复与无损回滚**：修复前自动将目标 `.ini` 快照备份至 `.efmm-backups/<时间戳>/`，支持内置规范化引擎或外部 `Fixer.exe`，并可随时一键回滚。
   - **8 项离线诊断**：检查 XXMI/EFMI 路径对齐、`d3dx.ini [Include]`、RabbitFX 单实例、Hash 冲突、EFF 误放、根目录脏文件、UIPI 权限与 Persist Bridge 状态。
   - **安全包升级与 4 步初始化向导**：覆盖更新本地 XXMI/EFMI 包时自动跳过保护 `Mods`、`d3dx_user.ini`、`XXMI Launcher Config.json` 与 `qaqm` 目录。

6. **个性化与系统设置**
   - 四套免登录本地主题（樱粉浅色 / 午夜暗色 / 终末地工业暗 / 极简纯白）、自定义强调色、多张本地背景图轮换（离屏预模糊 / 遮罩浓度 / 不透明度）、侧边栏缩放与兼容降级档位。
   - 支持注册表 `Endfield.exe` 探测、Windows 开机自启动开关、完整配置 JSON 导入导出与便携模式。

---

## 目录与数据存储模式

软件按以下优先级解析本地配置与缓存目录：

1. 若设置了环境变量 `EFMM_DATA_DIR`，优先使用该目录；
2. 若主程序 `EndfieldModManager.exe` 同级目录存在 `portable.flag` 或 `data\` 文件夹，则自动启用**便携模式**，将数据保存在同级 `data\` 中；
3. 否则默认保存至 `%APPDATA%\EndfieldModManager`。

> 对 `EFMI\Mods` 执行的所有操作均遵循可逆原则（`DISABLED_` 前缀切换、安全隔离或系统回收站），并建议在首次使用前为个人 Mod 库做好备份。

---

## 安装与使用

### Windows 安装版（NSIS）
运行 `EndfieldModManager_0.1.0_x64-setup.exe`，按简体中文向导安装即可（默认为当前用户安装，无需管理员权限）。

### Windows 便携版（Portable ZIP）
解压 `EndfieldModManager-v0.1.0-windows-x64-portable.zip` 至任意英文或中文路径，直接双击 `EndfieldModManager.exe` 运行；压缩包内已附带 `portable.flag`，配置和背景将独立存储在同目录 `data\` 中。

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

# 类型检查与前端构建
npx.cmd tsc --noEmit
npm.cmd run build

# 运行 Rust 单元测试（纯临时目录隔离，不写入真实 %APPDATA% 与 D:\MOD）
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture

# 一键构建 Windows Release、NSIS 安装包与 Portable ZIP
powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1
```

可选组件：若需要极速外部解压支持，可将合法获取的 `7za.exe` 与 `UnRAR.exe` 放入 `src-tauri/bin/`，构建脚本会自动一并打入便携包。

---

## V2 后续规划

- GameBanana 模组直连浏览、MD5 校验下载与自动命名落盘。
- 新版本干员默认封面（`303×386`）与别名词表同步工具。
