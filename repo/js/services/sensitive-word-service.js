import { db } from '../core/db.js';
import { uuid, now } from '../core/utils.js';

const STORE = 'opsSensitiveWords';

/** In-memory cache of sensitive words: Map<lowercase_word, { id, word, severity }> */
let wordMap = new Map();
let loaded = false;

export const sensitiveWordService = {
  /**
   * Load all sensitive words from the DB into memory.
   * Must be called before check() will detect anything.
   */
  async loadWords() {
    const rows = await db.getAll(STORE);
    wordMap = new Map();
    for (const row of rows) {
      wordMap.set(row.word.toLowerCase(), {
        id: row.id,
        word: row.word,
        severity: row.severity
      });
    }
    loaded = true;
  },

  /**
   * Scan text against the loaded sensitive words.
   * Case-insensitive whole-word matching.
   * @param {string} text
   * @returns {{ hasSensitive: boolean, matches: Array<{ word: string, severity: string }> }}
   */
  check(text) {
    if (!loaded || wordMap.size === 0) {
      return { hasSensitive: false, matches: [] };
    }

    const lower = text.toLowerCase();
    const matches = [];

    for (const [key, entry] of wordMap) {
      if (lower.includes(key)) {
        matches.push({ word: entry.word, severity: entry.severity });
      }
    }

    return {
      hasSensitive: matches.length > 0,
      matches
    };
  },

  /**
   * Add a new sensitive word.
   * @param {string} word
   * @param {string} severity - e.g. 'low', 'medium', 'high'
   * @returns {object} The created record
   */
  async addWord(word, severity = 'medium') {
    const record = {
      id: uuid(),
      word,
      severity,
      createdAt: now()
    };
    await db.put(STORE, record);
    // Refresh the in-memory cache
    await this.loadWords();
    return record;
  },

  /**
   * Remove a sensitive word by ID.
   * @param {string} id
   */
  async removeWord(id) {
    await db.delete(STORE, id);
    await this.loadWords();
  },

  /**
   * List all sensitive words from the DB.
   * @returns {Array<object>}
   */
  async getWords() {
    return db.getAll(STORE);
  }
};
