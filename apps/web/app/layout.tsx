import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Montserrat } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CartDrawer } from '@/components/cart-drawer';
import { CartProvider } from '@/components/cart-provider';
import { Header } from '@/components/header';
import { themeStyle } from '@/lib/format';
import { ApiError } from '@/lib/errors';
import { getCustomer, getNavigation, getStore, pageExists } from '@/lib/server-api';
import './globals.css';

// No brand fonts were supplied. The TAZEEN wordmark is a wide geometric sans, so Montserrat carries the UI and
// Cormorant Garamond gives the headings an elegant, editorial feel. Swap here if brand fonts are provided.
const body = Montserrat({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const heading = Cormorant_Garamond({ subsets: ['latin'], variable: '--font-heading', display: 'swap', weight: ['400', '500', '600'] });

/** Unknown or unverified hosts get a plain page instead of an error. */
async function storeOrNull() {
  try {
    return await getStore();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 421 || err.status === 400)) return null;
    throw err;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const store = await storeOrNull();
  if (!store) return { title: 'Store not found', robots: { index: false } };
  return {
    title: { default: store.name, template: store.settings.seo?.titleTemplate?.includes('%s') ? store.settings.seo.titleTemplate : `%s | ${store.name}` },
    description: store.settings.seo?.defaultDescription,
    icons: store.settings.faviconUrl ? [{ url: store.settings.faviconUrl }] : undefined,
    openGraph: { siteName: store.name, type: 'website' },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#5b277a' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const store = await storeOrNull();
  if (!store) {
    return (
      <html lang="en" className={`${body.variable} ${heading.variable}`}>
        <body className="flex min-h-dvh items-center justify-center p-8 text-center">
          <div>
            <h1 className="display-title text-4xl">This store isn’t available</h1>
            <p className="mt-3 text-muted">Check the web address and try again.</p>
          </div>
        </body>
      </html>
    );
  }
  const [nav, customer, hasShipping, hasReturns] = await Promise.all([getNavigation(), getCustomer(), pageExists('shipping-policy'), pageExists('return-policy')]);
  const { settings } = store;

  return (
    <html lang={store.locale?.split('-')[0] || 'en'} className={`${body.variable} ${heading.variable}`} style={themeStyle(settings.theme)}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded focus:bg-fg focus:px-4 focus:py-2 focus:text-bg">
          Skip to content
        </a>
        <CartProvider>
          {settings.announcement && (
            <div className="overflow-hidden bg-accent py-2 text-xs tracking-[0.16em] text-accent-fg uppercase">
              <div className="marquee flex w-max gap-16 whitespace-nowrap">
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} aria-hidden={i > 0}>
                    {settings.announcement}
                  </span>
                ))}
              </div>
            </div>
          )}
          <Header storeName={store.name} logoUrl={settings.logoUrl} nav={nav} signedIn={Boolean(customer)} />
          <main id="main">{children}</main>
          <CartDrawer />
        </CartProvider>

        <footer className="mt-24 border-t-2 border-accent bg-surface [&_a:hover]:text-accent [&_a]:transition-colors">
          <div className="container-x grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="font-display text-3xl font-medium tracking-wide text-accent">{store.name}</p>
              {settings.seo?.defaultDescription && <p className="mt-3 max-w-xs text-sm text-muted">{settings.seo.defaultDescription}</p>}
            </div>
            <div>
              <p className="eyebrow mb-4">Shop</p>
              <ul className="space-y-2 text-sm">
                <li><Link href="/shop">All products</Link></li>
                {nav.filter((n) => n.href !== '/shop').slice(0, 4).map((n) => (
                  <li key={n.href + n.label}><Link href={n.href}>{n.label}</Link></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="eyebrow mb-4">Help</p>
              <ul className="space-y-2 text-sm">
                <li><Link href="/faqs">FAQs</Link></li>
                {hasShipping && <li><Link href="/pages/shipping-policy">Shipping</Link></li>}
                {hasReturns && <li><Link href="/pages/return-policy">Returns</Link></li>}
                <li><Link href="/account/orders">Track an order</Link></li>
              </ul>
            </div>
            <div>
              <p className="eyebrow mb-4">Contact</p>
              <ul className="space-y-2 text-sm">
                {settings.contact?.email && <li><a href={`mailto:${settings.contact.email}`}>{settings.contact.email}</a></li>}
                {settings.contact?.phone && <li><a href={`tel:${settings.contact.phone}`}>{settings.contact.phone}</a></li>}
                {Object.entries(settings.social ?? {}).map(([name, url]) => (
                  <li key={name} className="capitalize"><a href={url} target="_blank" rel="noopener noreferrer">{name}</a></li>
                ))}
              </ul>
            </div>
          </div>
          <div className="container-x flex flex-col justify-between gap-2 border-t border-line py-6 text-xs text-muted sm:flex-row">
            <p>© {new Date().getFullYear()} {store.brand.name}</p>
            <p className="space-x-4">
              <Link href="/pages/privacy-policy">Privacy</Link>
              <Link href="/pages/terms">Terms</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
