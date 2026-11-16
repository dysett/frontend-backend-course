import { createWriteStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yazl from 'yazl';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, '..', 'RESTful-сервіс.zip');
const zip = new yazl.ZipFile();
const excluded = new Set(['node_modules', '.env', '.data', '.git', 'coverage', '.test-temp', '.npm-cache']);
async function add(dir, relative = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.endsWith('.log')) continue;
    const rel = path.posix.join(relative, entry.name);
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) await add(absolute, rel);
    else if (entry.isFile()) zip.addFile(absolute, `restful-service/${rel}`);
  }
}
await add(root);
const output = createWriteStream(target);
zip.outputStream.pipe(output);
const complete = finished(output);
zip.end();
await complete;
console.log(`Архів для здачі: ${target}`);
