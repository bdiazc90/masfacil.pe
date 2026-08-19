import fs from 'node:fs';
import path from 'node:path';

export function acquireExclusiveLock(lockPath, fsModule = fs) {
  fsModule.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  try { fsModule.writeFileSync(lockPath, `${process.pid}\n`, { flag: 'wx', mode: 0o600 }); }
  catch { throw new Error(`refresh concurrente rechazado; lock activo: ${lockPath}`); }
  return () => { if (fsModule.existsSync(lockPath)) fsModule.unlinkSync(lockPath); };
}
