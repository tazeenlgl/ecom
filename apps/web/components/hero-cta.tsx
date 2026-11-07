import Link from 'next/link';
import { ArrowIcon } from './icons';

/**
 * Hero call to action. In the editorial look it is a pill with the arrow in a circle (accent on a light pill, translucent white on
 * an accent pill); elsewhere it keeps the standard button.
 */
export function HeroCta({ href, label, onAccent = false, className = '' }: { href: string; label: string; onAccent?: boolean; className?: string }) {
  return (
    <Link href={href} className={`btn uppercase ed:gap-3 ed:py-2 ed:pr-2 ed:pl-6 ed:normal-case ed:tracking-[0.02em] ${className}`}>
      {label}
      <span className={`ed:inline-grid ed:h-9 ed:w-9 ed:place-items-center ed:rounded-full ${onAccent ? 'ed:bg-white/20 ed:text-accent-fg' : 'ed:bg-accent ed:text-accent-fg'}`}>
        <ArrowIcon width={16} height={16} />
      </span>
    </Link>
  );
}
