// Simple IndexedDB cache for model files
class ModelCache {
  constructor() {
    this.dbName = 'piper-tts-cache';
    this.storeName = 'models';
    this.version = 3; // Increment version to trigger upgrade
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        let store;
        if (!db.objectStoreNames.contains(this.storeName)) {
          store = db.createObjectStore(this.storeName, { keyPath: 'url' });
        } else {
          store = event.target.transaction.objectStore(this.storeName);
        }

        if (!store.indexNames.contains('timestamp')) {
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!store.indexNames.contains('contentHash')) {
          store.createIndex('contentHash', 'contentHash', { unique: false });
        }
      };
    });
  }

  /**
   * Calculate a simple hash of the file content for change detection
   * Uses first 1KB + last 1KB + total size as a fingerprint
   */
  async calculateContentHash(arrayBuffer) {
    try {
      // Use SubtleCrypto for SHA-256 hash (more reliable)
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
      // Fallback: simple hash using size + first/last bytes
      const view = new Uint8Array(arrayBuffer);
      const size = view.length;
      const firstBytes = Array.from(view.slice(0, Math.min(100, size))).join(',');
      const lastBytes = Array.from(view.slice(Math.max(0, size - 100), size)).join(',');
      return `${size}-${firstBytes}-${lastBytes}`;
    }
  }

  async get(url) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(url);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          resolve({
            data: result.data,
            contentHash: result.contentHash || null,
            timestamp: result.timestamp || null,
          });
          return;
        }
        resolve(null);
      };
    });
  }

  async set(url, data, contentHash) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put({
        url,
        data,
        contentHash: contentHash || null,
        timestamp: Date.now()
      });
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async delete(url) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(url);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clear() {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

export async function isCached(url) {
  const cache = new ModelCache();
  return Boolean(await cache.get(url));
}

export async function areUrlsCached(urls) {
  const results = await Promise.all(urls.map((url) => isCached(url)));
  return results.every(Boolean);
}

async function downloadToCache(url, onProgress) {
  const cache = new ModelCache();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length')) || 0;
  let data;

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      received += value.byteLength;
      onProgress?.({ url, received, total: contentLength });
    }

    data = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    data = data.buffer;
  } else {
    data = await response.arrayBuffer();
    onProgress?.({ url, received: data.byteLength, total: contentLength });
  }

  const contentHash = await cache.calculateContentHash(data);
  await cache.set(url, data, contentHash);
  onProgress?.({ url, received: data.byteLength, total: contentLength || data.byteLength });

  return new Response(data, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

export async function installUrls(urls, onProgress) {
  let completedBytes = 0;
  let totalBytes = 0;
  const progressByUrl = new Map();

  const reportProgress = (progress) => {
    const previous = progressByUrl.get(progress.url) || { received: 0, total: 0 };
    completedBytes += progress.received - previous.received;
    totalBytes += progress.total - previous.total;
    progressByUrl.set(progress.url, progress);

    onProgress?.({
      url: progress.url,
      received: completedBytes,
      total: totalBytes,
      percent: totalBytes > 0 ? Math.min(100, (completedBytes / totalBytes) * 100) : null,
    });
  };

  for (const url of urls) {
    await downloadToCache(url, reportProgress);
  }
}

export async function removeUrls(urls) {
  const cache = new ModelCache();
  await Promise.all(urls.map((url) => cache.delete(url)));
}

// Cached fetch function for model files
export async function cachedFetch(url) {
  const cache = new ModelCache();
  const cached = await cache.get(url);

  if (cached) {
    return new Response(cached.data, { status: 200 });
  }

  return downloadToCache(url);
}

export default ModelCache;
