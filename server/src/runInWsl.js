const path = require('path');
const { spawnSync } = require('child_process');

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function parseUncPackagePath(packageJsonPath) {
  const uncPrefix = '\\\\wsl.localhost\\';
  if (!packageJsonPath || !packageJsonPath.startsWith(uncPrefix)) {
    return null;
  }

  const segments = packageJsonPath.slice(uncPrefix.length).split('\\').filter(Boolean);
  const [distro, ...rest] = segments;
  if (!distro || rest.length === 0) {
    return null;
  }

  return {
    distro,
    linuxPath: `/${rest.join('/')}`,
  };
}

function runInCurrentLinux(packageDir, relativeScript) {
  const scriptPath = path.resolve(packageDir, relativeScript);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: packageDir,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status === null ? 1 : result.status);
}

function runViaWsl(packageJsonPath, relativeScript) {
  const parsed = parseUncPackagePath(packageJsonPath);
  if (!parsed) {
    throw new Error(
      'This project must be launched from WSL. Open Ubuntu/WSL and run npm there, or use /usr/bin/npm inside WSL.'
    );
  }

  const packageDir = path.posix.dirname(parsed.linuxPath);
  const command = `cd ${shellEscape(packageDir)} && /usr/bin/node ${shellEscape(relativeScript)}`;
  const result = spawnSync('wsl.exe', ['-d', parsed.distro, 'bash', '-lc', command], {
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status === null ? 1 : result.status);
}

function runNodeScript(relativeScript) {
  const packageJsonPath = process.env.npm_package_json || path.resolve(__dirname, '..', 'package.json');
  const packageDir = path.dirname(packageJsonPath);

  if (process.platform === 'linux') {
    runInCurrentLinux(packageDir, relativeScript);
    return;
  }

  if (process.platform === 'win32') {
    runViaWsl(packageJsonPath, relativeScript);
    return;
  }

  throw new Error(`Unsupported runtime platform: ${process.platform}`);
}

module.exports = {
  runNodeScript,
};
