import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

// Coordinate rotating OAuth credentials across editor windows on the same host.
// The lock contains no credentials and expires after an interrupted process.
export async function withLocalLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + 30000;
  while (true) {
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const info = await stat(path);
        if (Date.now() - info.mtimeMs > 120000) await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (Date.now() >= deadline) throw new Error('AI credentials are being updated in another editor window. Try again shortly.');
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    try {
      return await action();
    } finally {
      const owned = await handle.stat();
      await handle.close();
      try {
        const current = await stat(path);
        if (owned.ino === current.ino) await unlink(path);
      } catch {
        // A failed cleanup must not replace the result of the protected operation.
        // An orphaned lock expires on the next attempt.
      }
    }
  }
}
