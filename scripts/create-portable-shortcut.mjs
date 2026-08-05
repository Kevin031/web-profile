import { rename, rm, stat } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { log } from 'node:console';
import process from 'node:process';

const appName = 'Web Profile';
const rootDirectory = resolve(import.meta.dirname, '..');
const architecture = arch() === 'arm64' ? 'arm64' : 'x64';
const portableDirectory = resolve(rootDirectory, 'release', `${appName}-portable-${architecture}`);

if (platform() === 'win32') {
  const powershell = spawnSync('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    resolve(import.meta.dirname, 'create-portable-shortcut.ps1'),
    '-Architecture',
    architecture
  ], { stdio: 'inherit' });
  process.exit(powershell.status ?? 1);
}

if (platform() !== 'darwin') {
  throw new Error(`暂不支持在 ${platform()} 上安装便携版应用。`);
}

const portableApp = resolve(portableDirectory, `${appName}.app`);
const applicationsDirectory = '/Applications';
const installedApp = resolve(applicationsDirectory, `${appName}.app`);
const stagedApp = resolve(applicationsDirectory, `.${appName}.app.installing`);

await stat(portableApp).catch(() => {
  throw new Error(`未找到 portable 应用：${portableApp}`);
});
await stat(applicationsDirectory).catch(() => {
  throw new Error(`未找到应用程序目录：${applicationsDirectory}`);
});
await rm(stagedApp, { recursive: true, force: true });

const ditto = spawnSync('ditto', [portableApp, stagedApp], { stdio: 'inherit' });
if (ditto.error) {
  throw ditto.error;
}
if (ditto.status !== 0) {
  await rm(stagedApp, { recursive: true, force: true });
  throw new Error(`复制应用失败，ditto 退出码：${ditto.status ?? 1}`);
}

await rm(installedApp, { recursive: true, force: true });
await rename(stagedApp, installedApp);

log(`Application installed: ${installedApp}`);
