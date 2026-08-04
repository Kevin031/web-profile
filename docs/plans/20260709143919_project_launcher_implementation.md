# 前端项目桌面启动器实现计划

## Overview

构建一个 Electron + TypeScript 桌面应用，用于扫描 `D:/Projects` 下的本机前端项目，集中查看 Git 状态，执行 pull、切分支、启动/停止 dev server，并追踪运行日志。

## Problem Statement

当前本机前端项目数量多，日常切换项目需要在多个终端和编辑器之间执行重复命令：查分支、拉代码、切分支、启动服务、找本地 URL、查看日志。目标是把这些高频本机操作收敛到一个桌面控制台。

## Proposed Solution

第一版使用 Electron 桌面应用。Renderer 提供密集型开发者控制台界面，Main 进程封装文件系统、Git 命令、项目启动和进程管理能力。所有本机命令通过受控 IPC 暴露，避免 Renderer 任意执行 shell。

## Technical Approach

### Architecture

- Electron Main：扫描项目、执行 Git、管理 dev server 子进程、读写本地配置。
- Electron Preload：暴露类型安全的 IPC API。
- Renderer：展示项目表格、筛选、详情、启动配置和日志。
- Shared：复用类型定义、状态枚举、工具函数。

### Implementation Phases

#### Phase 1: Foundation

- 初始化 Electron + Vite + TypeScript 项目。
- 配置 lint、format、typecheck、test 脚本。
- 建立 main/preload/renderer/shared 目录结构。
- 实现基础窗口、IPC 桥和前端壳页面。

Success criteria:

- `npm run typecheck` 通过。
- 应用可以启动桌面窗口。

#### Phase 2: Core Implementation

- 实现项目扫描和 package.json 解析。
- 实现本地 JSON 配置。
- 实现 Git 状态查询、pull、分支列表、切分支。
- 实现项目启动、停止、重启和日志缓存。
- 实现项目列表、详情面板、日志面板和设置入口。

Success criteria:

- 能扫描 `D:/Projects` 一级前端项目。
- 能查看分支和 dirty 状态。
- 能启动并停止至少一个项目。
- 能看到启动日志和本地 URL。

#### Phase 3: Polish & Optimization

- 加入并发限制和任务状态栏。
- 补充错误态、空状态、加载态。
- 补齐单元测试和关键集成测试。
- 完善 README 使用说明。

Success criteria:

- `npm run lint`、`npm run typecheck`、`npm test` 通过。
- 主要异常路径有清晰提示。

## Alternative Approaches Considered

- Tauri：包体更轻，但第一版涉及大量动态命令和子进程管理，权限配置和 Rust/JS 边界会提高实现复杂度。
- 本地 Web 服务：开发最快，但桌面体验、窗口、托盘、退出确认和系统集成较弱。

## Acceptance Criteria

### Functional Requirements

| Criterion | Verification |
|-----------|--------------|
| 默认扫描 `D:/Projects/*/package.json` | 启动应用后项目列表出现本机一级前端项目 |
| 支持手动添加项目路径 | 在设置中添加路径后刷新列表出现项目 |
| 展示 Git 当前分支和 dirty 状态 | 对 clean/dirty 仓库运行状态刷新 |
| 支持 `git pull` | 点击 Pull 后任务状态显示成功或失败 |
| 支持切换已有本地分支 | 在详情面板选择分支并切换 |
| 默认启动命令为 `npm run dev` | 未配置项目点击启动时使用默认命令 |
| 支持项目级启动命令覆盖 | 修改命令后启动使用新命令 |
| 支持停止和重启项目 | 运行中项目可停止、重启 |
| 展示最近日志和本地 URL | 启动 Vite 项目后日志中识别 localhost URL |

### Non-Functional Requirements

- 扫描和 Git 状态刷新有并发限制。
- Renderer 不接受任意 shell 命令执行。
- UI 保持密集、清晰、可扫描。
- 错误信息保留关键 stderr 和退出码。

### Quality Gates

- 类型校验通过。
- lint 通过。
- 相关单元测试通过。
- 关键进程管理逻辑有测试覆盖。

## Success Metrics

- 打开应用后 5 秒内能看到项目列表基础信息。
- 常用项目启动流程不需要手动打开终端。
- 启动失败时能直接从日志定位命令或依赖问题。

## Dependencies & Prerequisites

- Node.js 和 npm 可用。
- 本机安装 Git。
- 目标项目具备 `package.json`。
- 对被扫描目录有读取权限。

## Risk Analysis & Mitigation

- Git 命令并发过高：加入并发限制，只刷新可见项目优先。
- Windows 下停止子进程不完整：优先使用进程树停止方案，并补测试。
- 启动命令差异大：默认 `npm run dev`，支持项目级覆盖。
- 命令执行安全：IPC 只接受项目 ID 和受控参数，不开放任意 shell。
- 日志过大：只保留最近 N 行，配置可调。

## Future Considerations

- 工作区预设和一键启动多个项目。
- 端口占用检测。
- 外部已运行 dev server 发现。
- Git 远端分支检出。
- GitLab MR/CI 聚合。
- SQLite 历史记录。

## Documentation Plan

- README：安装、启动、开发、使用说明。
- 设计文档：已写入 `docs/superpowers/specs/2026-07-09-project-launcher-design.md`。
- 计划文档：当前文件。

## Design System Reference

### Design Direction

- 开发者控制台风格。
- 高信息密度，少装饰。
- 明确状态色：成功、警告、失败、运行中、空闲。
- 表格和详情面板优先服务扫描、比较和重复操作。

### Components to Use

| Component | Notes |
|-----------|-------|
| Button | 启动、停止、重启、Pull、刷新 |
| Input | 搜索、启动命令、项目路径 |
| Select | 分支选择、状态筛选 |
| Table | 项目列表 |
| Tabs | 详情、日志、配置 |
| Toast/Inline Alert | 操作结果和错误提示 |

### States to Implement

- Default
- Hover
- Focus
- Disabled
- Loading
- Empty
- Error

## References & Research

### Internal References

- 设计文档：`docs/superpowers/specs/2026-07-09-project-launcher-design.md`

### External References

- Electron Process Model: https://electronjs.org/docs/latest/tutorial/process-model
- Electron IPC: https://electronjs.org/docs/latest/tutorial/ipc
- Electron utilityProcess: https://electronjs.org/docs/latest/api/utility-process
- Tauri Shell Plugin: https://v2.tauri.app/plugin/shell/
- Tauri Sidecar: https://v2.tauri.app/develop/sidecar/
