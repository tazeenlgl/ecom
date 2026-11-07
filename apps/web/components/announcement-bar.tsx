import Link from 'next/link';
import { parseAnnouncement } from '@/lib/announcement';

/**
 * One quiet line above the header. Text comes from the store's announcement setting; nothing here is invented.
 * An optional link is written inline in that setting as [label](/path).
 */
export function AnnouncementBar({ text }: { text: string }) {
  return (
    <div className="bg-accent px-4 py-2 text-center text-[11px] leading-snug font-medium tracking-[0.2em] text-accent-fg uppercase ed:text-xs ed:tracking-[0.04em] ed:normal-case sm:ed:py-2.5" role="region" aria-label="Announcement">
      {parseAnnouncement(text).map((part, i) =>
        'href' in part ? (
          part.href.startsWith('/') ? (
            <Link key={i} href={part.href} className="ml-2 inline-block py-1 underline underline-offset-4 hover:no-underline">
              {part.label}
            </Link>
          ) : (
            <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="ml-2 inline-block py-1 underline underline-offset-4 hover:no-underline">
              {part.label}
            </a>
          )
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </div>
  );
}
