import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cargoBin = join(homedir(), '.cargo', 'bin');
const cargoExecutable = join(cargoBin, process.platform === 'win32' ? 'cargo.exe' : 'cargo');

if (!existsSync(cargoExecutable)) {
  throw new Error(`未找到 Rust 工具链：${cargoExecutable}。请先使用 rustup 安装 Rust。`);
}

const pathEntries = (process.env.PATH ?? '').split(delimiter);
const environment = {
  ...process.env,
  PATH: pathEntries.includes(cargoBin)
    ? process.env.PATH
    : [cargoBin, process.env.PATH].filter(Boolean).join(delimiter)
};
const require = createRequire(import.meta.url);
const tauriCli = require.resolve('@tauri-apps/cli/tauri.js');
const result = spawnSync(process.execPath, [tauriCli, ...process.argv.slice(2)], {
  cwd: new URL('..', import.meta.url),
  env: environment,
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
