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
        data-state={scrolled || menu !== null ? 'solid' : 'clear'}
        className={`site-header sticky top-0 z-40 transition-all duration-500 ease-out-expo ${scrolled ? 'border-b border-line bg-bg/85 backdrop-blur-xl' : 'bg-bg'}`}
        onMouseLeave={() => setMenu(null)}
      >
        <div className={`container-x grid grid-cols-[1fr_auto_1fr] items-center gap-2 ed:max-md:flex ed:max-md:gap-2 sm:gap-4 transition-all duration-500 ease-out-expo ${scrolled ? 'h-14 sm:h-16' : 'h-16 sm:h-20'}`}>
          <div className="flex items-center ed:max-md:shrink-0">
          <button className="btn-ghost -ml-2 rounded-full px-2! sm:-ml-3 sm:px-3! lg:hidden" aria-label="Open menu" onClick={() => setMobile(true)}>
            <MenuIcon />
          </button>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {items.map((item, i) => (
              <div key={item.href + item.label} onMouseEnter={() => setMenu(item.children?.length ? i : null)}>
                <Link
                  href={item.href}
                  aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'page' : undefined}
                  className="relative px-3 py-2 text-sm tracking-wide transition-colors hover:text-accent aria-[current=page]:font-medium aria-[current=page]:text-accent after:absolute after:inset-x-3 after:bottom-1 after:h-px after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-500 hover:after:scale-x-100 aria-[current=page]:after:scale-x-100"
                >
                  {item.label}
                </Link>
              </div>
            ))}
          </nav>
          </div>

          <Link href="/" className="flex items-center justify-center" aria-label={`${storeName} home`}>
            {logoUrl ? (
              <Image src={logoUrl} alt={storeName} width={150} height={50} className="site-logo h-8 w-auto object-contain sm:h-11" priority />
            ) : (
              <span className="whitespace-nowrap font-display text-2xl font-medium tracking-[0.14em] uppercase sm:text-3xl">{storeName}</span>
            )}
          </Link>

          <div className="flex items-center justify-end ed:max-md:min-w-0 ed:max-md:flex-1 ed:max-md:gap-1">
            <button type="button" className="hidden h-10 min-w-0 flex-1 items-center justify-between rounded-full border border-line bg-surface px-4 text-left text-sm text-muted ed:max-md:flex" aria-label="Search" onClick={() => setSearch(true)}>
              <span className="truncate">Search</span>
              <SearchIcon />
            </button>
            <button className="btn-ghost rounded-full px-2! sm:px-3! ed:max-md:hidden" aria-label="Search" onClick={() => setSearch(true)}>
              <SearchIcon />
            </button>
            <Link href={signedIn ? '/account' : '/login'} className="btn-ghost rounded-full px-2! sm:px-3! ed:max-md:hidden" aria-label={signedIn ? 'Your account' : 'Sign in'}>
              <UserIcon />
            </Link>
            <button className="btn-ghost relative rounded-full px-2! sm:px-3!" aria-label={`Bag, ${count} items`} onClick={() => setOpen(true)}>
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
              className="absolute inset-x-0 top-full hidden border-b border-line bg-bg/95 text-fg backdrop-blur-xl lg:block"
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
                {logoUrl ? <Image src={logoUrl} alt={storeName} width={150} height={50} className="h-9 w-auto object-contain" /> : <span className="font-display text-2xl">{storeName}</span>}
                <button className="btn-ghost rounded-full" aria-label="Close menu" onClick={() => setMobile(false)}>
                  <CloseIcon />
                </button>
              </div>
              <ul className="space-y-1">
                {items.map((item, i) => (
                  <motion.li key={item.href + item.label} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
                    <Link href={item.href} className="block py-3 font-display text-2xl hover:text-accent aria-[current=page]:text-accent" aria-current={pathname === item.href ? 'page' : undefined}>
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
