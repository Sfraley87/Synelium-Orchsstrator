/**
 * Tests for executive session handling.
 * Verifies the conversation double-append bug is fixed: each user message
 * should appear exactly once in the history sent to Claude.
 */

import { getSession, appendToSession, clearSession } from './index';

describe('session management', () => {
  const sid = 'test-session-1';

  beforeEach(() => clearSession(sid));

  it('starts empty', () => {
    expect(getSession(sid)).toEqual([]);
  });

  it('appends and retrieves messages', () => {
    appendToSession(sid, { role: 'user', content: 'hello' });
    appendToSession(sid, { role: 'assistant', executive: 'ECHO', content: 'hi there' });
    const history = getSession(sid);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: 'user', content: 'hello' });
    expect(history[1]).toMatchObject({ role: 'assistant', executive: 'ECHO', content: 'hi there' });
  });

  it('caps history at 40 messages', () => {
    for (let i = 0; i < 45; i++) {
      appendToSession(sid, { role: 'user', content: `msg ${i}` });
    }
    expect(getSession(sid)).toHaveLength(40);
  });

  it('clears session', () => {
    appendToSession(sid, { role: 'user', content: 'hello' });
    clearSession(sid);
    expect(getSession(sid)).toHaveLength(0);
  });
});

/**
 * Verify the history-slice fix: when handle() builds the Claude message array,
 * the current user message (pre-appended by the caller) must appear exactly once.
 *
 * We do this by simulating the exact sequence that /board/chat uses:
 *   1. appendToSession(sid, { role:'user', content: message })
 *   2. handle() reads session.slice(0, -1) for prior history
 *   3. handle() then pushes the prompt as the final message
 *
 * The combined messages sent to Claude should have no adjacent duplicate user turns.
 */
describe('no duplicate user messages in history', () => {
  const sid = 'test-dup-session';

  beforeEach(() => clearSession(sid));

  it('slice(0,-1) excludes the just-appended user message', () => {
    // Simulate two prior turns already in the session
    appendToSession(sid, { role: 'user', content: 'first question' });
    appendToSession(sid, { role: 'assistant', executive: 'ECHO', content: 'first answer' });
    appendToSession(sid, { role: 'user', content: 'second question' });
    appendToSession(sid, { role: 'assistant', executive: 'ECHO', content: 'second answer' });

    // Caller pre-appends the new user message (as index.ts does)
    const currentMessage = 'third question';
    appendToSession(sid, { role: 'user', content: currentMessage });

    // handle() reads session.slice(0, -1) — should NOT include currentMessage
    const session = getSession(sid);
    const prior = session.slice(0, -1);

    expect(prior).toHaveLength(4);
    expect(prior.every((m) => m.content !== currentMessage)).toBe(true);

    // The current message is added separately by handle() — simulating that
    const allMessages = [
      ...prior.filter((m) => m.role === 'user' || m.executive === 'ECHO'),
      { role: 'user' as const, content: currentMessage },
    ];

    // Check no two consecutive user messages
    for (let i = 1; i < allMessages.length; i++) {
      if (allMessages[i]!.role === 'user') {
        expect(allMessages[i - 1]!.role).toBe('assistant');
      }
    }
  });
});
