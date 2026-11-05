'use client';

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Link as NavLink } from '@/lib/types';
import { useCart } from './cart-provider';
import { BagIcon, CloseIcon, MenuIcon, SearchIcon, UserIcon } from './icons';
import { SearchOverlay } from './search-overlay';

export function Header({ storeName, logoUrl, nav, signedIn }: { storeName: string; logoUrl?: string; nav: NavLink[]; signedIn: boolean }) {
  const { count, setOpen } = useCart();
  const pathname = usePathname();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 24));

  useEffect(() => {
    setMenu(null);
    setMobile(false);
    setSearch(false);
  }, [pathname]);

  const items = nav.length ? nav : [{ label: 'Shop all', href: '/shop' }];

  return (
    <>
      <header
        className={`sticky top-0 z-40 transition-all duration-500 ease-out-expo ${scrolled ? 'border-b border-line bg-bg/85 backdrop-blur-xl' : 'bg-bg'}`}
        onMouseLeave={() => setMenu(null)}
      >
        <div className={`container-x flex items-center gap-6 transition-all duration-500 ease-out-expo ${scrolled ? 'h-16' : 'h-20'}`}>
          <button className="btn-ghost -ml-3 rounded-full lg:hidden" aria-label="Open menu" onClick={() => setMobile(true)}>
            <MenuIcon />
          </button>

          <Link href="/" className="flex items-center gap-2 lg:mr-6" aria-label={`${storeName} home`}>
            {logoUrl ? (
              <Image src={logoUrl} alt={storeName} width={140} height={40} className="h-8 w-auto object-contain" priority />
            ) : (
              <span className="whitespace-nowrap font-display text-xl tracking-tight sm:text-2xl">{storeName}</span>
            )}
          </Link>

          <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Main">
            {items.map((item, i) => (
              <div key={item.href + item.label} onMouseEnter={() => setMenu(item.children?.length ? i : null)}>
                <Link
                  href={item.href}
                  className="relative px-3 py-2 text-sm tracking-wide after:absolute after:inset-x-3 after:bottom-1 after:h-px after:origin-left after:scale-x-0 after:bg-fg after:transition-transform after:duration-500 hover:after:scale-x-100"
                >
                  {item.label}
                </Link>
              </div>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button className="btn-ghost rounded-full" aria-label="Search" onClick={() => setSearch(true)}>
              <SearchIcon />
            </button>
            <Link href={signedIn ? '/account' : '/login'} className="btn-ghost rounded-full" aria-label={signedIn ? 'Your account' : 'Sign in'}>
              <UserIcon />
            </Link>
            <button className="btn-ghost relative rounded-full" aria-label={`Bag, ${count} items`} onClick={() => setOpen(true)}>
              <BagIcon />
              <AnimatePresence>
                {count > 0 && (
                  <motion.span
                    key={count}
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg"
                  >
                    {count}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </div>

        {/* Mega menu */}
        <AnimatePresence>
          {menu !== null && items[menu]?.children?.length ? (
            <motion.div
              key={menu}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="absolute inset-x-0 top-full hidden border-b border-line bg-bg/95 backdrop-blur-xl lg:block"
            >
              <div className="container-x grid grid-cols-4 gap-10 py-10">
                {items[menu]!.children!.map((col) => (
                  <div key={col.href + col.label}>
                    <Link href={col.href} className="font-display text-lg hover:opacity-70">
                      {col.label}
                    </Link>
                    {col.children?.length ? (
                      <ul className="mt-3 space-y-2">
                        {col.children.map((c) => (
                          <li key={c.href + c.label}>
                            <Link href={c.href} className="text-sm text-muted transition hover:text-fg">
                              {c.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </header>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobile && (
          <>
            <motion.div className="fixed inset-0 z-50 bg-fg/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobile(false)} />
            <motion.nav
              aria-label="Mobile"
              className="fixed inset-y-0 left-0 z-50 w-[85%] max-w-sm overflow-y-auto bg-bg p-6"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            >
              <div className="mb-8 flex items-center justify-between">
                <span className="font-display text-2xl">{storeName}</span>
                <button className="btn-ghost rounded-full" aria-label="Close menu" onClick={() => setMobile(false)}>
                  <CloseIcon />
                </button>
              </div>
              <ul className="space-y-1">
                {items.map((item, i) => (
                  <motion.li key={item.href + item.label} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
                    <Link href={item.href} className="block py-3 font-display text-2xl">
                      {item.label}
                    </Link>
                    {item.children?.length ? (
                      <ul className="mb-3 space-y-2 border-l border-line pl-4">
                        {item.children.map((c) => (
                          <li key={c.href + c.label}>
                            <Link href={c.href} className="text-sm text-muted">
                              {c.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </motion.li>
                ))}
              </ul>
              <div className="mt-10 border-t border-line pt-6 text-sm">
                <Link href={signedIn ? '/account' : '/login'}>{signedIn ? 'Your account' : 'Sign in'}</Link>
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>

      <SearchOverlay open={search} onClose={() => setSearch(false)} />
    </>
  );
}
