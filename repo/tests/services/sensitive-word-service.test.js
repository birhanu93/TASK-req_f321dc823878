import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll } from '../helpers.js';
import { db } from '../../js/core/db.js';
import { sensitiveWordService } from '../../js/services/sensitive-word-service.js';

beforeEach(async () => {
  await resetAll();
});

describe('sensitive-word-service', () => {
  // ---------------------------------------------------------------
  // check (before loading)
  // ---------------------------------------------------------------
  describe('check (before loading)', () => {
    it('should return no matches when words have not been loaded', () => {
      const result = sensitiveWordService.check('some bad text');
      expect(result.hasSensitive).toBe(false);
      expect(result.matches).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // loadWords
  // ---------------------------------------------------------------
  describe('loadWords', () => {
    it('should load words from the database into memory', async () => {
      await db.put('opsSensitiveWords', { id: 'w1', word: 'badword', severity: 'high', createdAt: 1 });
      await db.put('opsSensitiveWords', { id: 'w2', word: 'rude', severity: 'medium', createdAt: 2 });

      await sensitiveWordService.loadWords();

      const result = sensitiveWordService.check('this is a badword');
      expect(result.hasSensitive).toBe(true);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].word).toBe('badword');
    });

    it('should clear previous cache and reload', async () => {
      await db.put('opsSensitiveWords', { id: 'w1', word: 'alpha', severity: 'low', createdAt: 1 });
      await sensitiveWordService.loadWords();

      // Remove from DB and reload
      await db.delete('opsSensitiveWords', 'w1');
      await sensitiveWordService.loadWords();

      const result = sensitiveWordService.check('alpha is here');
      expect(result.hasSensitive).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // addWord
  // ---------------------------------------------------------------
  describe('addWord', () => {
    it('should add a word and refresh the cache', async () => {
      const record = await sensitiveWordService.addWord('forbidden', 'high');
      expect(record).toHaveProperty('id');
      expect(record.word).toBe('forbidden');
      expect(record.severity).toBe('high');
      expect(record).toHaveProperty('createdAt');

      // Should be detectable immediately after add
      const result = sensitiveWordService.check('this is forbidden content');
      expect(result.hasSensitive).toBe(true);
    });

    it('should persist the word in the database', async () => {
      const record = await sensitiveWordService.addWord('stored', 'low');
      const stored = await db.get('opsSensitiveWords', record.id);
      expect(stored).toBeTruthy();
      expect(stored.word).toBe('stored');
    });

    it('should default severity to medium', async () => {
      const record = await sensitiveWordService.addWord('defaultsev');
      expect(record.severity).toBe('medium');
    });
  });

  // ---------------------------------------------------------------
  // check (after loading)
  // ---------------------------------------------------------------
  describe('check', () => {
    beforeEach(async () => {
      await sensitiveWordService.addWord('spam', 'low');
      await sensitiveWordService.addWord('offensive', 'high');
    });

    it('should detect sensitive words case-insensitively', () => {
      const result = sensitiveWordService.check('This is SPAM content');
      expect(result.hasSensitive).toBe(true);
      expect(result.matches.some(m => m.word === 'spam')).toBe(true);
    });

    it('should return severity for each match', () => {
      const result = sensitiveWordService.check('spam and offensive text');
      expect(result.matches).toHaveLength(2);
      const spamMatch = result.matches.find(m => m.word === 'spam');
      const offensiveMatch = result.matches.find(m => m.word === 'offensive');
      expect(spamMatch.severity).toBe('low');
      expect(offensiveMatch.severity).toBe('high');
    });

    it('should return no matches for clean text', () => {
      const result = sensitiveWordService.check('this is perfectly fine text');
      expect(result.hasSensitive).toBe(false);
      expect(result.matches).toEqual([]);
    });

    it('should detect multiple occurrences as a single match', () => {
      const result = sensitiveWordService.check('spam spam spam');
      expect(result.hasSensitive).toBe(true);
      // The check iterates wordMap entries, so each word appears once in matches
      expect(result.matches.filter(m => m.word === 'spam')).toHaveLength(1);
    });

    it('should detect words embedded in other text', () => {
      // The check uses includes(), so substring matches work
      const result = sensitiveWordService.check('antispammer');
      expect(result.hasSensitive).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // removeWord
  // ---------------------------------------------------------------
  describe('removeWord', () => {
    it('should remove a word and refresh the cache', async () => {
      const record = await sensitiveWordService.addWord('removeme', 'medium');
      // Verify it detects first
      let result = sensitiveWordService.check('removeme');
      expect(result.hasSensitive).toBe(true);

      await sensitiveWordService.removeWord(record.id);

      result = sensitiveWordService.check('removeme');
      expect(result.hasSensitive).toBe(false);
    });

    it('should remove the word from the database', async () => {
      const record = await sensitiveWordService.addWord('dbremove', 'low');
      await sensitiveWordService.removeWord(record.id);
      const stored = await db.get('opsSensitiveWords', record.id);
      expect(stored).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // getWords
  // ---------------------------------------------------------------
  describe('getWords', () => {
    it('should list all words from the database', async () => {
      await sensitiveWordService.addWord('word1', 'low');
      await sensitiveWordService.addWord('word2', 'high');
      await sensitiveWordService.addWord('word3', 'medium');

      const words = await sensitiveWordService.getWords();
      expect(words).toHaveLength(3);
      const wordNames = words.map(w => w.word).sort();
      expect(wordNames).toEqual(['word1', 'word2', 'word3']);
    });

    it('should return empty array when no words exist', async () => {
      const words = await sensitiveWordService.getWords();
      expect(words).toEqual([]);
    });
  });
});
