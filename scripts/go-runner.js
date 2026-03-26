const { existsSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const repoRoot = process.cwd();
const waCoreDir = path.join(repoRoot, 'apps', 'wa-core');

function resolveGoBinary() {
  if (process.env.GO_BIN) {
    return process.env.GO_BIN;
  }

  const windowsGo = 'C:\\Program Files\\Go\\bin\\go.exe';
  if (process.platform === 'win32' && existsSync(windowsGo)) {
    return windowsGo;
  }

  const gitBashGo = '/c/Program Files/Go/bin/go.exe';
  if (existsSync(gitBashGo)) {
    return gitBashGo;
  }

  return 'go';
}

const result = spawnSync(resolveGoBinary(), args, {
  cwd: waCoreDir,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
