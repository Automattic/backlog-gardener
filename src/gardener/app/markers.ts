import type { BotMarker, BotMarkerType } from './types.js';

const MARKER_PREFIX = 'backlog-gardener';
const MARKER_TYPES: BotMarkerType[] = ['report', 'duplicate', 'needs-info', 'summary'];

export function renderBotMarker(marker: BotMarker): string {
  return `<!-- ${MARKER_PREFIX}:${marker.type}:v${marker.version} -->`;
}

export function parseBotMarkers(markdown: string): BotMarker[] {
  const markers: BotMarker[] = [];
  const pattern = /<!--\s*backlog-gardener:([a-z-]+):v(\d+)\s*-->/g;
  for (const match of markdown.matchAll(pattern)) {
    const type = match[1];
    const version = Number.parseInt(match[2] ?? '', 10);
    if (isBotMarkerType(type) && version === 1) markers.push({ type, version: 1 });
  }
  return markers;
}

export function hasBotMarker(markdown: string, type: BotMarkerType): boolean {
  return parseBotMarkers(markdown).some((marker) => marker.type === type);
}

export function appendBotMarker(body: string, marker: BotMarker): string {
  const trimmed = body.trimEnd();
  return `${trimmed}\n\n${renderBotMarker(marker)}\n`;
}

function isBotMarkerType(value: string | undefined): value is BotMarkerType {
  return MARKER_TYPES.includes(value as BotMarkerType);
}

export const REPORT_MARKER: BotMarker = { type: 'report', version: 1 };
