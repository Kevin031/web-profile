import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const buildArguments = process.platform === 'darwin'
  ? ['run', 'tauri', '--', 'build', '--bundles', 'app']
  : ['run', 'tauri', '--', 'build', '--no-bundle'];

const run = (command, arguments_) => {
  const result = spawnSync(command, arguments_, {
    cwd: rootDirectory,
    shell: process.platform === 'win32',
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run(npmCommand, buildArguments);
run(process.execPath, ['scripts/package-tauri-portable.mjs']);
