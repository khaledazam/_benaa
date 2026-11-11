import path from 'node:path';
import fs from 'node:fs';
/** Test fixture executable selection only; URI guards remain in each suite. */
export function isolatedTestMongod(): string {
  const binary = process.platform === 'win32'
    ? path.join(process.env.USERPROFILE || '', '.cache', 'mongodb-binaries', 'mongod-x64-win32-8.2.6.exe')
    : process.env.BENAA_TEST_MONGOD;
  if (!binary || !path.isAbsolute(binary) || !fs.existsSync(binary)) throw new Error('Explicit local isolated mongod executable is required');
  return binary;
}
