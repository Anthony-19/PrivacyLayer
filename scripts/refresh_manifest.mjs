import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(repoRoot, 'artifacts', 'zk');
const manifestPath = path.join(artifactsDir, 'manifest.json');

/**
 * Computes a deterministic SHA-256 checksum for a JSON object.
 */
function computeChecksum(obj) {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  return '0x' + createHash('sha256').update(str).digest('hex');
}

function main() {
  console.log('Refreshing ZK manifest...');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const circuits = ['withdraw', 'commitment'];

  for (const name of circuits) {
    const filePath = path.join(artifactsDir, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      console.warn(`Warning: Missing artifact for ${name}`);
      continue;
    }

    const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const checksum = computeChecksum(artifact);

    if (!manifest.circuits[name]) {
      manifest.circuits[name] = {
        path: `${name}.json`,
      };
    }
    manifest.circuits[name].checksum = checksum;
    
    // Hardcoded depths for this protocol version
    if (name === 'withdraw') {
      manifest.circuits[name].root_depth = 20;
    }
  }

  // Idempotent write
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Manifest updated at ${manifestPath}`);
}

main();
