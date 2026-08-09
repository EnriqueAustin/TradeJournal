import test from 'node:test';
import assert from 'node:assert/strict';

import { callLLM } from './ai.js';

test('callLLM aborts slow Ollama requests instead of hanging', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init = {}) => {
    return new Promise((_, reject) => {
      const signal = init.signal;
      if (!signal) {
        reject(new Error('missing fetch signal'));
        return;
      }
      signal.addEventListener('abort', () => {
        reject(new Error('Request timed out after 25ms'));
      }, { once: true });
    });
  };

  try {
    await assert.rejects(
      () => callLLM({
        system: 'test',
        prompt: 'test',
        provider: 'ollama',
        model: 'qwen3.5:9b',
        timeoutMs: 25,
      }),
      /timed out|Request timed out|aborted/i
    );
  } finally {
    global.fetch = originalFetch;
  }
});
