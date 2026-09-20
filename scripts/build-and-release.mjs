import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCurrentVersion, syncVersion, validateVersion } from './bump-version.mjs';
import { release } from './release-omni.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** 校验用户选择的发布版本，允许同版本重发但禁止降级。 @param {string} current @param {string} answer */
export function selectVersion(current, answer) {
  const selected = validateVersion(answer.trim());
  const left = current.split('.').map(Number);
  const right = selected.split('.').map(Number);
  const different = right.findIndex((value, index) => value !== left[index]);
  if (different !== -1 && right[different] < left[different]) throw new Error('发布版本不能低于当前版本');
  return selected;
}

/** 在交互终端要求用户明确输入版本号。 @param {string} current */
async function promptVersion(current) {
  if (!process.stdin.isTTY) throw new Error('请在交互终端运行 npm run publish:omni 并输入版本号');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return selectVersion(current, await prompt.question(`当前版本 ${current}，请输入发布版本（x.y.z）：`));
  } finally {
    prompt.close();
  }
}

/** 运行一个本地发布步骤，失败立即停止。 @param {string} command @param {string[]} args */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, shell: process.platform === 'win32', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 执行失败`);
}

/** 输入版本后完成校验、构建、ZIP 打包和 Omni Link 发布。 */
export async function buildAndRelease() {
  const current = await readCurrentVersion();
  const selected = await promptVersion(current);
  await syncVersion(selected);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['test']);
  run(npm, ['run', 'typecheck']);
  run(npm, ['run', 'lint']);
  // 直接调用 tauri 脚本，避免 npm run build 的 prebuild 再次递增版本。
  run(npm, ['run', 'tauri', '--', 'build']);
  run(process.execPath, ['scripts/package-tauri-portable.mjs']);
  await release();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAndRelease().catch((error) => {
    console.error(`一体化发布停止：${error.message}`);
    process.exitCode = 1;
  });
}
