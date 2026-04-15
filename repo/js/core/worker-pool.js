const workers = new Map();
let workersAvailable = typeof Worker !== 'undefined';

function getWorker(name) {
  if (!workersAvailable) return null;
  if (workers.has(name)) return workers.get(name);
  let url;
  switch (name) {
    case 'csv': url = '/js/workers/csv-worker.js'; break;
    case 'snapshot': url = '/js/workers/snapshot-worker.js'; break;
    case 'export': url = '/js/workers/export-worker.js'; break;
    case 'report': url = '/js/workers/report-worker.js'; break;
    default: throw new Error(`Unknown worker: ${name}`);
  }
  try {
    const w = new Worker(url);
    workers.set(name, w);
    return w;
  } catch {
    workersAvailable = false;
    return null;
  }
}

export function postToWorker(name, type, payload, onProgress) {
  const worker = getWorker(name);
  if (!worker) return null; // caller must use fallback
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const handler = (e) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress' && onProgress) {
        onProgress(msg.payload);
        return;
      }
      worker.removeEventListener('message', handler);
      if (msg.type.endsWith('-error')) {
        reject(new Error(msg.error));
      } else {
        resolve(msg.payload);
      }
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ type, id, payload });
  });
}

export function terminateAll() {
  for (const [, w] of workers) w.terminate();
  workers.clear();
}

export function isAvailable() {
  return workersAvailable;
}
