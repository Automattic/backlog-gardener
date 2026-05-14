import sanitizeHtml from 'sanitize-html';

export function htmlToText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    textFilter: (text) => text.replace(/\s+/g, ' '),
  })
    .replace(/\s+/g, ' ')
    .trim();
}
