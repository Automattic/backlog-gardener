import { describe, expect, it } from 'vitest';

import { appendBotMarker, hasBotMarker, parseBotMarkers, renderBotMarker } from '../../src/gardener/app/markers.js';

describe('bot markers', () => {
  it('renders and parses supported markers', () => {
    const marker = renderBotMarker({ type: 'duplicate', version: 1 });

    expect(marker).toBe('<!-- backlog-gardener:duplicate:v1 -->');
    expect(parseBotMarkers(`body\n${marker}`)).toEqual([{ type: 'duplicate', version: 1 }]);
  });

  it('detects appended markers', () => {
    const body = appendBotMarker('hello', { type: 'report', version: 1 });

    expect(body).toContain('hello');
    expect(hasBotMarker(body, 'report')).toBe(true);
    expect(hasBotMarker(body, 'summary')).toBe(false);
  });
});
