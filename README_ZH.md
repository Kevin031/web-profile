# Web Profile

### 本机前端项目桌面启动器 — 在一个工作台里扫描、启动和管理本地开发服务

[![Version](https://img.shields.io/github/v/release/Kevin031/web-profile?color=blue&label=version)](https://github.com/Kevin031/web-profile/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey.svg)](https://github.com/Kevin031/web-profile/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](package.json)

[English](README.md) | 中文

## 为什么需要 Web Profile？

如果你在一个目录下维护多个前端仓库，日常往往是：开终端、`cd` 进项目、执行 `pnpm dev` 或 `npm run dev`、在日志里找 Local 地址，然后下一个项目再来一遍。**Web Profile** 是基于 Tauri 的桌面应用：扫描项目根目录、展示 Git 状态、启动开发服务、从日志识别 URL，并在一个界面里停止或重启所有服务。

- **统一工作台** — 表格/网格视图、搜索、收藏，以及运行中 / 有改动 / 隐藏等筛选
- **真实进程管理** — 启动默认命令或 `package.json` 脚本，可并行多服务；支持单独停止或全部停止
- **Git 一览** — 分支、工作区状态、Pull、切分支
- **多种打开方式** — 资源管理器、VS Code、Cursor、终端；全局记住默认工具
- **中英文界面** — 在 **设置 → 语言** 中切换（默认 **English**）
- **跨平台桌面端** — 主要面向 Windows 安装版与便携版；发布流程亦支持 macOS

浏览器预览（`npm run web`）使用同一套 React 界面和 Mock 数据，仅用于前端界面开发，不能启动本机项目或执行 Git 操作。

## 功能概览

### 项目工作台

- 扫描可配置根目录下的直接子文件夹；仅包含 `package.json` 的目录会被识别为项目
- 按名称、路径、分支、脚本、状态等搜索
- 收藏、隐藏、恢复（不删除磁盘上的项目文件）
- 记住表格/网格布局与默认打开工具

### 开发服务

- 每个项目可配置启动命令（默认 `npm run dev`）
- 从 `package.json` 的 scripts 一键启动，并按锁文件识别包管理器
- 从日志解析多个本地 URL（如前后端不同端口）并分别打开
- 按服务分标签查看日志；支持停止单个服务或项目下全部服务；工具栏 **全部停止**

### Git

- 刷新分支、干净/有改动、ahead/behind
- 切换本地分支、`pull --ff-only`
- **有改动** 筛选

### 更新

- 启动时检查 GitHub Release 的 `latest.json`；在工具栏手动下载、安装签名更新包

## 快速开始

1. 安装或运行便携版（见 [安装](#2-安装与首次启动)）。
2. 首次启动时若默认 `D:/Projects` 不存在，选择 **项目根目录**。
3. 点击 **刷新** 扫描项目。
4. 选中项目 → 确认 **启动** 命令 → 在列表中点击启动。
5. 状态为 **运行中** 后，在 URL 列或右侧 **访问** 区域打开地址。

**语言：** 点击右上角 **设置（齿轮）** → **语言** → 选择 **English** 或 **中文**，会写入应用配置并持久保存。

## 1. 使用前准备

### 1.1 普通用户

- Windows 10/11 x64（主要目标平台）或 macOS（发布流程支持 `.app`）
- Microsoft Edge WebView2 Runtime
- Git、Node.js，以及项目实际使用的包管理器（npm、pnpm、yarn 或 bun）
- 可选：VS Code 或 Cursor，用于从应用中打开项目

安装版在系统缺少 WebView2 时会自动下载并安装；便携版要求系统已安装 WebView2。

### 1.2 开发和打包

除上述环境外，还需要：

- Rust stable MSVC 工具链
- Visual Studio 2022 Build Tools，并安装 `Desktop development with C++`

```powershell
node --version
npm --version
git --version
rustc --version
cargo --version
```

项目脚本会自动尝试从 `%USERPROFILE%/.cargo/bin` 加载 Rustup 工具链，因此 IDE 尚未刷新 `PATH` 时通常也能构建。

## 2. 安装与首次启动

### 2.1 使用安装版

```text
src-tauri/target/release/bundle/nsis/Web Profile_<version>_x64-setup.exe
```

按安装向导完成安装，然后从开始菜单或桌面快捷方式启动 Web Profile。

### 2.2 使用便携版

```text
release/Web Profile-portable-x64/Web Profile.exe
```

便携版无需安装，但配置和扫描缓存仍会写入当前 Windows 用户目录。

### 2.3 选择项目根目录

应用默认扫描 `D:/Projects`。如果该目录不存在，首次启动时会要求选择项目根目录。

```text
D:/Projects/
├── project-a/
│   └── package.json
├── project-b/
│   └── package.json
└── documents/
```

应用只扫描根目录的直接子目录，不递归；只有包含 `package.json` 的直接子目录会被识别为项目。更换目录：**设置 → 更换项目根目录**，或左下角 **更换根目录**。

## 3. 日常操作

### 3.1 查找和筛选项目

- 左侧搜索框（`Ctrl/Cmd+K` 或 `/` 聚焦搜索）
- 筛选：全部、收藏、运行中、有改动、隐藏
- 收藏按钮置顶项目；右上角切换表格/网格视图
- 刷新按钮重新扫描根目录

### 3.2 启动项目

1. 选中项目，在右侧 **启动** 区域检查命令（默认 `npm run dev`）。
2. 修改后点击 **保存**（如 `pnpm dev`）。
3. 点击列表中的启动按钮。
4. **运行中** 后在 URL 列或 **访问** 区域打开。

日志中会识别 `localhost`、`127.0.0.1`、`0.0.0.0` 或局域网 IP 的 HTTP 地址；同一条命令输出多个地址时会全部展示。若一直显示等待 Local 地址，请检查日志是否输出了完整 URL。

脚本列表来自 `package.json` 的 `scripts`，点击即启动且**不会**改写已保存的默认启动命令：

- pnpm、yarn、bun：`<包管理器> <script>`
- npm 或未识别：`npm run <script>`

可并行运行多个脚本；多服务时状态徽章可能显示 `运行中 ×2`。包管理器根据锁文件识别。

### 3.3 停止和重启

- 行内停止：结束该项目下全部服务及子进程
- 更多操作中的重启：使用已保存的默认启动命令
- 日志标签页可单独停止当前服务
- **全部停止**：结束所有由 Web Profile 启动的服务
- 关闭应用时若仍有项目运行，会提示停止并退出

### 3.4 打开项目目录

打开按钮旁下拉选择默认工具：文件资源管理器、VS Code、Cursor、终端。选择会保存为全局默认值。

### 3.5 Git 操作

- 更多操作 → **刷新 Git 状态**
- 详情区切换分支、**Pull**
- **有改动** 筛选

### 3.6 收藏、隐藏和恢复

- 收藏：列表中收藏按钮，收藏项目优先排序
- 隐藏：详情区右上角隐藏按钮
- 恢复：左侧 **隐藏** 筛选中再次点击隐藏

### 3.7 查看日志

按服务分标签，标题为启动命令；每个服务默认最多保留 500 行。应用重启后历史日志不保证保留。

## 4. 开发调试

```powershell
npm install
npm run dev      # Tauri + Vite，http://127.0.0.1:1420
npm run web      # 仅 UI + Mock
npm run typecheck
npm test
npm run lint
```

Rust（在 `src-tauri` 目录）：

```powershell
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

## 5. 构建与发布

### Omni Link 发布介绍页和 Windows 下载包

发布使用两个独立节点：下载节点保留 ZIP，介绍页节点自动解压为静态网站。首次运行会通过公司 SSO 授权，并把两个固定节点的 ID 与分享地址保存在已忽略提交的 `release.local.json` 中；后续运行原地更新，链接不变。

```powershell
# 仅生成 dist/web-profile-windows-x64.zip，不上传
npm run package:release

# 一行完成校验、打包，并依次上传下载资源和介绍页
npm run release:omni

# 输入版本号后，构建安装版与便携版并完成上述发布
npm run publish:omni
```

下载 ZIP 包含标准安装版和便携版。介绍页发布包为 `dist/web-profile-site.zip`，下载按钮在打包时替换为独立下载节点的 Omni Link 地址。命令结束时会分别输出“介绍页”和“下载资源”两条链接。

`publish:omni` 会先显示当前版本并要求明确输入 `x.y.z` 版本号，允许同版本重发但拒绝降级；随后同步 npm、Tauri、Cargo 和介绍页版本，运行测试、类型检查、ESLint，构建 Windows 安装版与便携版，最后发布两个 Omni Link 节点。该命令不会触发 `prebuild` 的自动补丁号递增。

> `build`、`build:portable`、`build:portable:desktop` 构建前会自动将补丁版本号加一，并同步 `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`。不要用构建命令做无副作用的验证。

| 命令 | 产物 |
| --- | --- |
| `npm run build` | `src-tauri/target/release/bundle/nsis/Web Profile_<version>_x64-setup.exe` |
| `npm run build:portable` | `release/Web Profile-portable-x64/Web Profile.exe` |
| `npm run build:portable:desktop` | 便携版 + 快捷方式（Windows）或 `/Applications/Web Profile.app`（macOS） |

### GitHub Release 自动更新

启动后检查 `latest.json`；工具栏 **检查更新**，发现新版本后需再次点击才下载、验证签名并重启。发布需在 Actions Secret 中配置 `TAURI_SIGNING_PRIVATE_KEY`。

## 6. 配置、缓存与迁移

| 数据 | 路径 | 说明 |
| --- | --- | --- |
| 应用配置 | `%APPDATA%/com.webprofile.app/web-profile.config.json` | 根目录、收藏、隐藏、启动命令、打开工具、视图模式、**语言** |
| 扫描缓存 | `%LOCALAPPDATA%/com.webprofile.app/web-profile.projects.cache.json` | 可删除后重新扫描 |
| 旧版 Electron 配置 | `%APPDATA%/web-profile/web-profile.config.json` | 仅在新配置不存在时导入一次 |

修改配置前请先退出应用并备份。

## 7. 常见问题

### 项目没有出现在列表中

确认是直接子目录且含有效 `package.json`；点击刷新；检查 **隐藏** 筛选。

### 项目启动失败

在终端手动执行相同命令；确认依赖与 `PATH`；查看日志首条错误；检查端口占用。

### 启动成功但没有访问地址

确认日志中有类似：

```text
Local: http://localhost:5173/
```

### 无法用 VS Code 或 Cursor 打开

确认 CLI 已安装；或改用资源管理器/终端。

### Git 状态或 Pull 失败

在项目目录执行 `git status`、`git remote -v`、`git branch -vv`。

### 桌面应用无法启动

修复 WebView2；开发模式确认 `1420` 未占用；便携版重新打包；可删扫描缓存（勿在未备份时删配置）。

## 8. 安全边界

前端无通用 Shell 或文件系统权限。启动命令仅针对已登记项目；打开目录、Git、进程与日志均由 Tauri 后端受控命令完成。
