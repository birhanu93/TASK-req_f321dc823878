import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// Polyfill crypto.randomUUID if not available
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {};
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto.randomUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  };
}
if (typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto.getRandomValues = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  };
}
if (typeof globalThis.crypto.subtle === 'undefined') {
  globalThis.crypto.subtle = {
    async importKey(format, keyData, algorithm, extractable, usages) {
      return { type: 'raw', keyData, algorithm };
    },
    async deriveBits(algorithm, key, length) {
      // Simple deterministic mock: hash based on password + salt
      const encoder = new TextEncoder();
      const data = new Uint8Array([...encoder.encode(JSON.stringify(key.keyData)), ...new Uint8Array(algorithm.salt)]);
      const result = new Uint8Array(length / 8);
      for (let i = 0; i < result.length; i++) {
        result[i] = data[i % data.length] ^ (i * 37 + 13);
      }
      return result.buffer;
    }
  };
}

// Polyfill BroadcastChannel
if (typeof globalThis.BroadcastChannel === 'undefined') {
  class MockBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
    }
    postMessage(msg) {
      // Simulate broadcast to self (for testing)
      if (this.onmessage) {
        setTimeout(() => {
          if (this.onmessage) this.onmessage({ data: msg });
        }, 0);
      }
    }
    close() {
      this.onmessage = null;
    }
  }
  globalThis.BroadcastChannel = MockBroadcastChannel;
}

// Polyfill structuredClone if not available
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

// Note: IndexedDB cleanup is handled per-test-file, not globally,
// because fake-indexeddb and the db.js module cache need careful coordination.

// Reset localStorage between tests
afterEach(() => {
  localStorage.clear();
});
