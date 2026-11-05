import type { Metadata } from 'next';
import { Cormorant_Garamond, Montserrat } from 'next/font/google';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import './globals.css';

const body = Montserrat({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const heading = Cormorant_Garamond({ subsets: ['latin'], variable: '--font-heading', display: 'swap', weight: ['500', '600', '700'] });

export const metadata: Metadata = { title: { default: 'TAZEEN Admin', template: '%s | TAZEEN Admin' }, robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded focus:bg-fg focus:px-4 focus:py-2 focus:text-bg">
          Skip to content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
