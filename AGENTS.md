# Agent 开发与发版规范（AGENTS.md）

本文件为所有在本仓库（`EndfieldModManager`）工作的 AI Agent 提供统一的工程校验与发版规范。

---

## 1. 版本同步规范（Version Sync）

每次发布新版本 `X.Y.Z`（例如 `0.1.1`），以下 3 个文件中的版本号**必须完全一致**，且同时更新并提交锁文件：

1. `package.json` → `"version": "X.Y.Z"`
2. `src-tauri/Cargo.toml` → `[package].version = "X.Y.Z"`
3. `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
4. `src-tauri/Cargo.lock` → 更新任何 Cargo 依赖或包版本后同步提交（`scripts/build-release.mjs` 与 CI 均使用 `cargo metadata --locked --offline`）

---

## 2. 跨多版本更新兼容契约（Cross-Version Update Contract）

本软件的 GitHub Auto-Updater 必须保证**早至 `v0.1.0` 的任意旧版本客户端都能直接跨多个版本升级到最新版**：

1. **每次 Release 必须包含完整 4 项产物**：
   - `EndfieldModManager-v<ver>-windows-x64-portable.zip`（首次下载便携包，含 `portable.flag`）
   - `EndfieldModManager-v<ver>-windows-x64-update.zip`（应用内热更新包，**不含**用户数据）
   - `EndfieldModManager_<ver>_x64-setup.exe`（NSIS 安装包）
   - `latest.json`（更新清单）
2. **`update.zip` 必须始终是完整自包含运行包**：
   - **禁止**做成仅针对上一版本 `v(N-1)` 的增量补丁。
   - **禁止**包含任何用户数据目录或配置文件：`portable.flag`、`data/`、`webview/`、`config.json`、`config.json.bak`、`presets.json`、`presets.json.bak`、`tags-pool.json`。
   - 若未来版本新增附属运行时文件（如 `bin/*`、`.dll` 或资源目录），必须更新 `scripts/build-release.mjs` 将其一并打包进 `update.zip` 与 `portable.zip`，以便旧客户端通过 `updater::sync_companion_update_files` 一次性补齐。
3. **`latest.json` 向后兼容契约**：
   - 必须保留 schema v1 关键字段：`schemaVersion`、`minSupportedClientVersion`、`version`、`tag`、`pubDate`、`notes`、`releaseUrl`、`updatePackage.{fileName,size,sha256,url}`、`portablePackage`。
   - 后续只允许增量追加新字段；除非发生不可避免的破坏性迁移，否则保持 `minSupportedClientVersion` 为 `"0.1.0"`。
4. **本地持久化 JSON 前向/后向兼容**：
   - 所有持久化结构体（`AppConfig`、`PresetStore`、`TagsPoolStore`、`ModTagsFile`）必须保持 `#[serde(default)]`，**禁止**使用 `#[serde(deny_unknown_fields)]`。

---

## 3. 发版前必跑校验（Pre-Release Checks）

Windows PowerShell 环境中统一使用 `npm.cmd` / `npx.cmd`，并确保 `%USERPROFILE%\.cargo\bin` 已加入 `PATH`：

1. **前端类型检查与构建**（必须退出码 `0`）：
   ```powershell
   npx.cmd tsc --noEmit
   npm.cmd run build:frontend
   ```
2. **Rust 编译检查**（必须 `0 errors, 0 warnings`）：
   ```powershell
   $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
   cargo check --manifest-path src-tauri/Cargo.toml
   ```
3. **Rust 单元测试**（必须 **100% 通过**，所有测试文件操作隔离于 `std::env::temp_dir()`）：
   ```powershell
   cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture
   ```
4. **打包脚本变更验证**：若修改过构建或发版脚本（`scripts/build-release.mjs`、`.github/workflows/release.yml`、`updater.rs` 清单逻辑），需本地试跑并检查生成的 `release-artifacts/latest.json` 字段与 SHA-256（**严禁将 `release-artifacts/` 提交到 Git**）：
   ```powershell
   node scripts/build-release.mjs --output-directory release-artifacts --notes "EndfieldModManager vX.Y.Z"
   ```

---

## 4. 提交、打标签与自动发版（Release Workflow）

1. 执行 `git status --short` 仔细审查，确保以下内容**未被暂存/提交**：
   - 构建产物与临时文件：`release-artifacts/`、`dist/`、`src-tauri/target/`
   - 本机内部文档：`AGENT_UI_CAPTURE_GUIDE.md`
   - 任何个人 GitHub Token、凭证或隐私路径数据
2. 提交并推送主分支：
   ```powershell
   git add -A
   git commit -m "chore(release): prepare vX.Y.Z"
   git push origin main
   ```
3. 创建并推送与版本号匹配的**附注标签（Annotated Tag）**，自动触发 `.github/workflows/release.yml`：
   ```powershell
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```
4. 使用 GitHub CLI 核验工作流与 Release 产物是否全部上传成功：
   ```powershell
   gh run list --limit 3
   gh release view vX.Y.Z
   ```

---

## 5. 安全红线（Safety Redlines）

- **禁止修改真实 Mod 库或游戏配置**：除明确只读扫描测试外，禁止改动真实用户目录下的 `EFMI\Mods`、`d3dx.ini`、`d3dx_user.ini` 或第三方管理器目录。
- **禁止提交敏感信息**：禁止在代码、日志、测试夹具或文档中写入 Token、私钥或个人敏感配置。
