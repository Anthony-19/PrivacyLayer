import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const baselinesPath = path.join(repoRoot, 'artifacts', 'zk', 'constraint_baselines.json');
const nargo = process.env.NARGO_BIN || 'nargo';

function runNargoInfoJson(pkg) {
  const result = spawnSync(
    nargo,
    ['info', '--package', pkg, '--json'],
    { cwd: path.join(repoRoot, 'circuits'), encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(`nargo info failed for ${pkg}`);
    return null;
  }
  return JSON.parse(result.stdout);
}

function mainOpCount(program) {
  const f = (program?.functions || []).find((g) => g.name === 'main');
  return f ? f.opcodes : null;
}

function main() {
  console.log('Updating constraint baselines...');
  const baselines = JSON.parse(fs.readFileSync(baselinesPath, 'utf8'));

  const versionResult = spawnSync(nargo, ['--version'], { encoding: 'utf8' });
  if (versionResult.status === 0) {
    baselines.nargo.version_line = versionResult.stdout.split('\n')[0]?.trim();
  }

  for (const pkg of ['withdraw', 'commitment']) {
    const out = runNargoInfoJson(pkg);
    if (!out) continue;
    const prog = (out.programs || [])[0];
    const count = mainOpCount(prog);
    if (count !== null) {
      console.log(`  ${pkg}: ${count} opcodes`);
      baselines.circuits[pkg].acir_opcodes = count;
    }
  }

  fs.writeFileSync(baselinesPath, JSON.stringify(baselines, null, 2) + '\n');
  console.log('Baselines updated.');
}

main();
