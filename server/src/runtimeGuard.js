function ensureLinuxRuntime(entryName) {
  if (process.platform === 'linux') {
    return;
  }

  console.error(`[${entryName}] Windows Node.js runtime is not supported for this project.`);
  console.error('Run this command from WSL Ubuntu, or invoke it through npm so the WSL launcher can re-enter Linux.');
  console.error('Recommended command: /usr/bin/npm run upload:faces');
  process.exit(1);
}

module.exports = {
  ensureLinuxRuntime,
};
