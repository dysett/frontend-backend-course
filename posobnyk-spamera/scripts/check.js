import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import pug from 'pug';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : file.endsWith('.js') ? [file] : [];
  });
}
for (const file of ['src', 'scripts', 'public', 'test'].flatMap(files)) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
pug.compileFile(path.resolve('views/index.pug'));
pug.compileFile(path.resolve('views/emails/message.pug'));
console.log('Синтаксис JavaScript та шаблони Pug перевірено.');
