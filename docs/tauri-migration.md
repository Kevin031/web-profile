# Tauri 2.0 迁移记录

## 结果

Web Profile 已从 Electron 切换到 Tauri 2。默认开发、构建和便携打包命令均使用 Tauri，Electron 主进程、preload、专属脚本和直接依赖已删除。浏览器 Mock 模式继续由 `npm run web` 提供。

## Windows 验收

验收环境：Windows 11 x64、Rust 1.97.1 stable MSVC、Tauri 2.11、系统 WebView2。

- 前端：TypeScript、ESLint、Vitest 全部通过。
- Rust：`cargo fmt --check`、Clippy `-D warnings`、12 个测试全部通过。
- 进程集成测试：Node fixture 的 stdout、stderr、本地 URL、重启与 `taskkill /T /F` 进程树停止通过。
- Release 便携版和 NSIS 安装版均实际启动，保持运行超过 10 秒且窗口可响应。
- 两种版本均读取迁移后的配置并显示 44 个项目，关闭后没有遗留本次验收进程。
- NSIS 已在当前 Windows 用户下安装到 `%LOCALAPPDATA%/Web Profile`。

## 产物

| 产物 | 大小 |
| --- | ---: |
| Electron 旧便携目录 | 347.37 MiB |
| Tauri 便携 EXE | 11.99 MiB |
| Tauri NSIS 安装包 | 2.59 MiB |

便携交付体积相较 Electron 降低约 96.5%。Tauri 产物中不包含 Electron runtime。

## 性能基线

测量方式：从创建进程到主窗口句柄存在且进程响应，随后等待 10 秒记录整个应用进程树工作集。配置和扫描缓存均已建立，结果用于本机迁移前后比较，不代表跨机器基准。

| 实现 | 窗口可响应 | 10 秒工作集 | 进程数 |
| --- | ---: | ---: | ---: |
| Electron | 2474 ms | 482.14 MiB | 5 |
| Tauri | 1284 ms | 69.37 MiB | 1 |

本次测量中，Tauri 窗口可响应时间缩短约 48.1%，工作集降低约 85.6%。主要收益来自复用系统 WebView2，不再随应用携带和运行独立 Chromium/Node 桌面运行时；项目扫描、Git 和受管进程本身的业务耗时不会因迁移自动消失。

## 数据兼容

- 新配置：`%APPDATA%/com.webprofile.app/web-profile.config.json`
- 新缓存：`%LOCALAPPDATA%/com.webprofile.app/web-profile.projects.cache.json`
- 旧配置来源：`%APPDATA%/web-profile/web-profile.config.json`

首次迁移只复制可兼容配置，旧配置不删除，旧缓存不导入。迁移失败会返回明确错误，仍可用旧版本读取原文件。

