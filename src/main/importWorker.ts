// Разбор и импорт .mrpack/.zip вне UI-потока Electron.
import { parentPort } from 'worker_threads';
import { importLocalModpack, inspectLocalModpack } from './importModpack';
import { armDownloads, cancelActiveDownloads, isDownloadCancelled } from './modrinthDownload';
import { getInstanceRoot, getLauncherDataDir } from './paths';

type WorkerMsg = {
  op: 'inspect' | 'import' | 'cancel';
  archivePath?: string;
  appDataDir?: string;
  defaultLoaderVersions?: Record<string, string>;
  deferDone?: boolean;
};

parentPort?.on('message', async (msg: WorkerMsg) => {
  if (msg?.op === 'cancel') {
    cancelActiveDownloads();
    return;
  }
  try {
    if (!msg || !msg.archivePath) {
      parentPort?.postMessage({ ok: false, error: 'bad_request' });
      return;
    }
    if (msg.op === 'inspect') {
      const inspect = inspectLocalModpack(msg.archivePath);
      parentPort?.postMessage({ ok: true, inspect });
      return;
    }
    armDownloads();
    const result = await importLocalModpack({
      archivePath: msg.archivePath,
      appDataDir: msg.appDataDir || getLauncherDataDir(),
      getInstanceRoot,
      sendProgress: (data) => parentPort?.postMessage({ progress: data }),
      defaultLoaderVersions: msg.defaultLoaderVersions,
      deferDone: msg.deferDone,
    });
    parentPort?.postMessage({ ok: true, result });
  } catch (err) {
    if (isDownloadCancelled(err)) {
      parentPort?.postMessage({ ok: false, error: 'cancelled', cancelled: true });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    parentPort?.postMessage({ ok: false, error: message });
  }
});
