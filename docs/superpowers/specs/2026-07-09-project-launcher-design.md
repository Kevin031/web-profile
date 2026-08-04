# 前端项目桌面启动器设计

日期：2026-07-09

## 背景

需要一个本机桌面工具，扫描 `D:/Projects` 下的前端项目，快速查看项目分支状态，执行拉代码、切分支、启动项目，并持续追踪已启动项目的运行状态。第一版定位为“本机项目启动器”，不扩展到团队协作控制台、CI/MR 聚合或复杂自动化编排。

当前落点目录 `D:/Projects/web-profile` 不是 git 仓库，适合作为新项目初始化位置。

## 第一版目标

- 默认扫描 `D:/Projects` 一级目录下带 `package.json` 的项目。
- 支持手动添加更深层或特殊路径项目。
- 展示项目 Git 状态，包括当前分支、未提交改动、ahead/behind。
- 支持一键 `git pull` 和切换已有本地分支。
- 支持启动、停止、重启项目，默认命令为 `npm run dev`。
- 支持为单个项目覆盖启动命令，例如 `pnpm dev`、`npm run serve`。
- 追踪工具启动的 dev server 子进程状态和最近日志。
- 保存收藏、隐藏项目、启动命令、默认项目根目录等本地配置。

## 非目标

- 不做 GitLab MR、CI、代码评审状态聚合。
- 不做批量强制重置、自动 stash、自动解决冲突等高风险 Git 操作。
- 不默认递归扫描所有子目录，避免 monorepo 和缓存目录造成噪音。
- 不在第一版接管工具启动前已经存在的外部 dev server 进程。
- 不做复杂工作流编排，只保留后续扩展入口。

## 技术方案

第一版采用 Electron + 前端框架 + TypeScript。

选择 Electron 的原因：

- 核心能力依赖本机命令执行、子进程管理、stdout/stderr 日志流和文件系统扫描。
- Electron 主进程运行在 Node.js 环境，天然适合通过受控 API 管理 `git`、`npm`、`pnpm`、`yarn`。
- Renderer 负责界面，Main 负责本机能力，通过 IPC 隔离命令执行面。

Tauri 作为备选方案保留。Tauri v2 可以通过 shell plugin 或 sidecar 执行命令，但动态命令权限、Rust/JavaScript 边界和 sidecar 配置会让第一版复杂度升高。后续如果包体、内存或系统集成成为主要矛盾，再评估迁移或重做。

参考文档：

- Electron Process Model: https://electronjs.org/docs/latest/tutorial/process-model
- Electron IPC: https://electronjs.org/docs/latest/tutorial/ipc
- Electron utilityProcess: https://electronjs.org/docs/latest/api/utility-process
- Tauri Shell Plugin: https://v2.tauri.app/plugin/shell/
- Tauri Sidecar: https://v2.tauri.app/develop/sidecar/

## 架构

### Renderer 前端

负责桌面界面：

- 项目列表、搜索、状态筛选、收藏筛选。
- 项目表格：项目名、路径、当前分支、Git 状态、启动命令、运行状态、端口或 URL。
- 详情面板：scripts、分支列表、启动配置、最近日志、最近操作结果。
- 设置页面：项目根目录、默认启动命令、日志保留行数、启动时是否自动扫描。

Renderer 不直接执行本机命令，只通过 preload 暴露的受控 IPC API 调用 Main 能力。

### Main 主进程

负责本机能力：

- 扫描项目目录。
- 读取和解析 `package.json`。
- 执行 Git 命令。
- 启动和停止 dev server 子进程。
- 维护运行中项目状态。
- 管理本地配置文件。

### IPC 接口层

建议暴露受控接口：

- `scanProjects()`
- `refreshProject(projectId)`
- `getGitStatus(projectId)`
- `pullProject(projectId)`
- `listBranches(projectId)`
- `checkoutBranch(projectId, branchName)`
- `startProject(projectId)`
- `stopProject(projectId)`
- `restartProject(projectId)`
- `updateProjectConfig(projectId, patch)`
- `getProjectLogs(projectId)`

IPC 入参必须使用项目 ID 或已登记路径，不接受 Renderer 任意传入 shell 字符串。

### 本地配置层

第一版使用 JSON 文件，保存：

- 项目根目录，默认 `D:/Projects`。
- 手动添加项目路径。
- 隐藏项目路径。
- 收藏项目路径。
- 每个项目的启动命令覆盖。
- 日志保留行数。
- 是否启动时自动扫描。

后续当任务记录、历史日志、分组和统计能力变复杂时，再迁移 SQLite。

### 进程管理器

每个由工具启动的项目对应一个受控子进程，记录：

- 项目 ID。
- pid。
- cwd。
- 启动命令。
- 启动时间。
- 当前状态：starting、running、exited、failed、stopping。
- 退出码。
- 最近 stdout/stderr 日志。
- 从日志中识别到的本地 URL。

运行状态以子进程生命周期为主，不以端口扫描作为唯一依据。

## 项目识别

默认扫描策略：

- 只扫描 `D:/Projects/*/package.json`。
- 读取 `package.json` 中的 `name` 和 `scripts`。
- 检查目录下是否存在 `.git` 或可被 `git rev-parse --show-toplevel` 识别。
- 根据 lock 文件推断包管理器，但默认启动命令仍为 `npm run dev`。
- 支持用户手动添加更深层项目路径。

项目唯一标识使用规范化后的绝对路径，避免重名项目冲突。

## Git 功能

状态展示：

- 当前分支。
- 是否有未提交改动。
- 是否 ahead/behind upstream。
- 是否非 Git 项目。

操作：

- `git pull`。
- 切换已有本地分支。
- 刷新单项目状态。

约束：

- 有未提交改动时，切分支默认阻断并提示原因。
- `git pull` 失败或冲突时只展示错误，不自动解决。
- 不提供强制 reset、删除分支、清理未跟踪文件等危险入口。

## 启动管理

默认启动命令：

```bash
npm run dev
```

每个项目可以覆盖启动命令。启动前校验：

- 项目路径存在。
- `package.json` 存在。
- 启动命令非空。
- 当前项目没有已由工具启动的运行中进程。

启动后：

- 捕获 stdout/stderr。
- 识别 `http://localhost:*`、`http://127.0.0.1:*`、局域网 URL。
- 支持停止和重启。
- 启动失败时保留错误日志，并允许修改命令后重试。

应用退出时，第一版默认提示是否停止由工具启动的子进程。设置里可以增加“退出时保持运行”，但默认行为应偏安全和可预期。

## 页面设计

主界面采用开发者控制台风格，强调密集、清晰、可扫描。

布局：

- 左侧：项目导航、搜索、状态筛选、收藏、全部项目。
- 中间：项目表格。
- 右侧：选中项目详情。
- 底部：任务状态栏，显示 pull、checkout、启动等任务。

项目表格列：

- 项目名。
- 路径。
- 当前分支。
- Git 状态。
- 启动命令。
- 运行状态。
- 本地 URL。
- 操作。

行内主操作根据状态变化：

- 未启动：启动。
- 运行中：停止、重启。
- 启动失败：重试、打开日志。

详情面板：

- scripts 列表。
- 分支列表。
- 启动命令配置。
- 最近日志。
- 最近操作结果。

## 数据流

启动应用：

1. Renderer 调用 `scanProjects()`。
2. Main 扫描一级目录和手动项目路径。
3. Main 返回项目基础信息。
4. Renderer 对可见项目请求 Git 状态。
5. Main 使用并发限制执行 Git 命令，避免几十个仓库同时运行命令。

用户操作：

1. Renderer 发起 pull、checkout、start、stop 等 IPC 请求。
2. Main 创建任务并更新任务状态。
3. Main 将任务结果、运行状态和日志推送给 Renderer。
4. Renderer 更新项目表格、详情面板和底部任务栏。

配置变更：

1. Renderer 提交配置 patch。
2. Main 校验后写入 JSON。
3. Main 返回最新配置和受影响项目状态。

## 错误处理

- 扫描失败：标记目录不可读，不影响其他项目。
- package.json 解析失败：项目显示为异常，保留路径和错误。
- 非 Git 项目：仍允许启动，Git 状态显示“非 Git”。
- Git 命令失败：展示命令类型、退出码和关键 stderr。
- Pull 冲突：标记失败并提示手动处理。
- 切分支失败：保持当前分支状态，显示失败原因。
- 启动失败：状态设为“启动失败”，保留 stderr。
- 子进程异常退出：状态设为 exited 或 failed，保留退出码和最近日志。
- 配置写入失败：界面回滚本次配置修改并提示错误。

## 测试策略

单元测试：

- 项目扫描。
- `package.json` 解析。
- 包管理器识别。
- 本地 URL 提取。
- 配置读写。
- IPC 入参校验。

集成测试：

- 使用临时 git 仓库覆盖 clean、dirty、ahead、behind、checkout 失败、pull 失败。
- 使用测试 Node 脚本模拟 dev server，验证启动、日志捕获、退出、停止。

验收：

- 类型校验通过。
- lint 通过。
- 与本次改动相关的单元测试通过。
- 第一版只要相关测试和类型校验通过，可以不打开浏览器验收。

## 后续扩展

- 项目分组和工作区预设。
- 一键启动多个项目。
- 打开编辑器、浏览器、本地 URL。
- 端口占用检测。
- 外部已运行 dev server 发现。
- Git 远端分支检出。
- GitLab MR/CI 聚合。
- SQLite 历史记录和任务审计。

## 已确认决策

- 第一版定位选择本机项目启动器。
- 扫描策略选择一级目录为主，支持手动添加子项目。
- 启动配置选择默认 `npm run dev`，支持项目级覆盖。
- 技术栈选择 Electron。
- 当前设计不包含团队协作控制台和复杂自动化工作流。
