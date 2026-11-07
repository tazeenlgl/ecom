export type AnnouncementPart = { text: string } | { label: string; href: string };

/**
 * The announcement is one configurable string. A link can be written inline as `[Shop now](/shop)`; only a path on this
 * site (`/…`, not `//…`) or an https address is accepted, anything else stays plain text.
 */
const LINK = /\[([^\]\n]{1,40})\]\((\/(?!\/)[^\s)]*|https:\/\/[^\s)]+)\)/g;

export function parseAnnouncement(text: string): AnnouncementPart[] {
  const parts: AnnouncementPart[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ label: m[1]!, href: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
