# Web Profile 操作手册

Web Profile 是面向 Windows 10/11 x64 的本机前端项目启动器，用于集中扫描、启动和管理本地前端项目。

桌面端基于 Tauri 2、React 19 和 Vite。浏览器预览使用同一套界面和 Mock 数据，仅用于界面开发，不能启动本机项目或执行 Git 操作。

## 1. 使用前准备

### 1.1 普通用户

- Windows 10/11 x64
- Microsoft Edge WebView2 Runtime
- Git
- Node.js
- 项目实际使用的包管理器：npm、pnpm、yarn 或 bun
- 可选：VS Code 或 Cursor，用于从应用中打开项目

安装版在系统缺少 WebView2 时会自动下载并安装；便携版要求系统已安装 WebView2。

### 1.2 开发和打包

除上述环境外，还需要：

- Rust stable MSVC 工具链
- Visual Studio 2022 Build Tools，并安装 `Desktop development with C++`

可用以下命令检查主要工具：

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

运行构建产物中的安装程序：

```text
src-tauri/target/release/bundle/nsis/Web Profile_<version>_x64-setup.exe
```

按安装向导完成安装，然后从开始菜单或桌面快捷方式启动 Web Profile。

### 2.2 使用便携版

直接运行：

```text
release/Web Profile-portable-x64/Web Profile.exe
```

便携版无需安装，但配置和扫描缓存仍会写入当前 Windows 用户目录。

### 2.3 选择项目根目录

应用默认扫描 `D:/Projects`。如果该目录不存在，首次启动时会要求选择项目根目录。

选择的目录应采用以下结构：

```text
D:/Projects/
├── project-a/
│   └── package.json
├── project-b/
│   └── package.json
└── documents/
```

应用只扫描根目录的直接子目录，不递归扫描更深层级；只有包含 `package.json` 的直接子目录会被识别为项目。更换目录可点击左下角“更换根目录”或顶部设置按钮。

## 3. 日常操作

### 3.1 查找和筛选项目

- 在左侧搜索框中按项目名称或路径搜索。
- 使用“全部、收藏、运行中、有改动、隐藏”筛选项目。
- 点击项目前的收藏按钮可置顶项目。
- 使用工作台右上角的视图按钮切换表格或网格展示；应用会记住当前选择。
- 点击顶部刷新按钮重新扫描根目录并更新项目列表。

### 3.2 启动项目

1. 在项目列表中选中项目。
2. 在右侧“启动”区域检查启动命令，默认值为 `npm run dev`。
3. 如需修改，输入实际命令并点击“保存”，例如 `pnpm dev` 或 `npm run serve`。
4. 点击列表中的启动按钮。
5. 状态变为“运行中”后，在 URL 列或右侧“访问”区域打开项目。

应用会从启动日志中识别 `localhost`、`127.0.0.1`、`0.0.0.0` 或局域网 IP 的 HTTP 地址。若界面一直显示“等待启动日志输出 Local 地址”，请先检查日志中是否实际输出了带端口的完整 URL。

右侧脚本列表来自项目 `package.json` 的 `scripts`。点击脚本会自动生成对应包管理器的命令并立即启动，**不会**改写已保存的默认启动命令：

- pnpm、yarn、bun：`<包管理器> <script>`
- npm 或未识别：`npm run <script>`

同一项目可并行运行多个不同脚本；若某命令已在启动或运行中，再次点击会复用已有实例而不会重复启动。状态徽章在有多个服务时会显示如 `运行中 ×2`。

包管理器根据项目锁文件识别：`pnpm-lock.yaml`、`yarn.lock`、`bun.lockb`、`bun.lock` 或 `package-lock.json`。

### 3.3 停止和重启

- 点击项目行中的停止按钮，结束该项目下全部服务及其子进程。
- 点击重启按钮，停止后使用已保存的默认启动命令重新启动。
- 在日志标签页中可单独停止当前服务。
- 点击顶部“全部停止”，结束所有由 Web Profile 启动的服务。
- 关闭应用时，如仍有项目运行，会提示“停止并退出”；取消提示则继续保持应用和项目运行。

### 3.4 打开项目目录

项目行和详情区都提供打开按钮。通过按钮旁的下拉菜单选择默认工具：

- 文件资源管理器
- VS Code
- Cursor
- 终端

选择会保存为全局默认值。使用 VS Code 或 Cursor 前，请确保对应命令已正确安装并可从系统调用。

### 3.5 Git 操作

对于 Git 项目，可以：

- 点击“刷新 Git”读取当前分支、工作区状态以及 ahead/behind 信息。
- 在右侧分支下拉框中切换本地分支。
- 点击 `Pull` 拉取当前分支。
- 使用“有改动”筛选工作区不干净的项目。

切换分支或拉取失败时，先查看界面错误提示，再在项目终端中运行 `git status`。未提交修改、冲突、认证失败或未配置上游分支都可能导致操作失败。

### 3.6 收藏、隐藏和恢复

- 收藏：点击项目列表中的收藏按钮，收藏项目会优先排序。
- 隐藏：选中项目后，点击详情区右上角的隐藏按钮。
- 恢复：进入左侧“隐藏”筛选，选中项目并再次点击隐藏按钮。

隐藏只影响应用内展示，不会删除项目文件。

### 3.7 查看日志

选中项目后，右侧“日志”区域按服务分标签展示：每个标签对应一次启动，标题为启动命令；页头显示完整命令并可单独停止。默认每个服务最多保留 500 行日志；应用重启后不保证保留历史运行日志。

## 4. 开发调试

安装依赖：

```powershell
npm install
```

启动桌面开发环境：

```powershell
npm run dev
```

Vite 开发服务器固定使用 `http://127.0.0.1:1420`。端口被占用时启动会直接失败，请先结束占用该端口的进程。

只预览前端界面：

```powershell
npm run web
```

浏览器预览显示 Mock 数据，不加载 Tauri 桌面能力，不能用于验证真实的项目进程、文件选择、Git 或本机打开操作。

运行前端检查：

```powershell
npm run typecheck
npm test
npm run lint
```

运行 Rust 检查：

```powershell
Set-Location src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

## 5. 构建与发布

> 注意：`build`、`build:portable` 和 `build:portable:desktop` 在构建前都会自动将补丁版本号加一，并同步修改 `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml`。不要用构建命令做无副作用的验证。

### 5.1 构建安装版

```powershell
npm run build
```

产物位置：

```text
src-tauri/target/release/bundle/nsis/Web Profile_<version>_x64-setup.exe
```

### 5.2 构建便携版

```powershell
npm run build:portable
```

产物位置：

```text
release/Web Profile-portable-x64/Web Profile.exe
```

重新打包时，脚本会替换已有便携版目录；若该目录中的 Web Profile 正在运行，脚本会先结束该实例。

### 5.3 构建便携版并添加到系统应用

```powershell
npm run build:portable:desktop
```

在 Windows 上，快捷方式名称包含当前版本号，例如 `Web Profile v0.1.3.lnk`。脚本只覆盖同名、同版本快捷方式，不会清理旧版本快捷方式。

在 macOS 上，脚本会将 `Web Profile.app` 安装到 `/Applications`。若已安装旧版本，会由当前构建替换。

### 5.4 GitHub Release 自动更新

桌面应用启动后只请求 GitHub Release 中的 `latest.json` 检查版本，不会自动下载安装包。发现新版本时，工作台顶部会显示更新按钮；只有用户点击后才下载、验证签名、安装并重启应用。

发布工作流要求仓库 Actions Secret 中存在 `TAURI_SIGNING_PRIVATE_KEY`。对应公钥已写入 `src-tauri/tauri.conf.json`，私钥必须在仓库外安全备份，不能提交到 Git。每次发布会生成 Windows、macOS 更新包及签名，并将平台下载地址写入 `latest.json`。

## 6. 配置、缓存与迁移

| 数据 | 路径 | 说明 |
| --- | --- | --- |
| 应用配置 | `%APPDATA%/com.webprofile.app/web-profile.config.json` | 根目录、收藏、隐藏、启动命令、默认打开工具和工作台视图 |
| 扫描缓存 | `%LOCALAPPDATA%/com.webprofile.app/web-profile.projects.cache.json` | 加快项目列表加载，可删除后重新扫描 |
| 旧版 Electron 配置 | `%APPDATA%/web-profile/web-profile.config.json` | 仅在新配置不存在时自动导入一次 |

迁移不会删除旧版 Electron 配置。旧扫描缓存不会迁移，应用会重新扫描项目。

手动修改配置前请先退出 Web Profile，并保留备份。配置损坏可能导致应用无法完成初始化。

## 7. 常见问题

### 项目没有出现在列表中

1. 确认项目是所选根目录的直接子目录。
2. 确认项目根目录中存在有效的 `package.json`。
3. 点击顶部刷新按钮。
4. 确认项目未被隐藏，可切换到“隐藏”筛选查看。

### 项目启动失败

1. 在终端进入项目目录，手动执行界面显示的启动命令。
2. 确认依赖已经安装。
3. 确认 Node.js 和对应包管理器可从系统 `PATH` 调用。
4. 查看右侧日志中的第一条错误信息。
5. 检查项目端口是否已被其他进程占用。

### 启动成功但没有访问地址

Web Profile 依赖项目日志识别本地 URL。确认开发服务器输出类似：

```text
Local: http://localhost:5173/
```

如果项目不输出 URL，可根据日志中的端口手动在浏览器访问。

### 无法用 VS Code 或 Cursor 打开

确认工具已安装，并已启用对应命令行入口。也可以将默认工具切换为文件资源管理器或终端。

### Git 状态或 Pull 失败

确认 Git 已安装且项目是有效仓库，然后在项目终端执行：

```powershell
git status
git remote -v
git branch -vv
```

根据输出处理未提交修改、上游分支或认证问题。

### 桌面应用无法启动

1. 安装或修复 Microsoft Edge WebView2 Runtime。
2. 使用开发模式时，确认 `1420` 端口未被占用。
3. 使用便携版时，尝试重新构建或重新解压完整目录。
4. 删除扫描缓存后重试；不要在未备份时删除应用配置。

## 8. 安全边界

前端不会获得通用 Shell 或文件系统权限。启动命令只会针对扫描得到的项目执行；打开目录、Git、进程和日志操作均由 Tauri 后端的受控命令完成。
