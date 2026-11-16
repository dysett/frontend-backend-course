import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let checked = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (file.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      checked++;
    } else if (file.endsWith('.json')) JSON.parse(await readFile(file, 'utf8'));
  }
}
for (const dir of ['src', 'scripts', 'test', 'postman', 'public']) await walk(path.join(root, dir));
console.log(`Синтаксис ${checked} JS-файлів і JSON-файли перевірено.`);
