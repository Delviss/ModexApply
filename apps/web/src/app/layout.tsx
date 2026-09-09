import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@modex/ui/tokens.css';
import '@modex/ui/styles.css';

export const metadata: Metadata = {
  title: {
    default: 'Modex Apply',
    template: '%s · Modex Apply',
  },
  description:
    'Apply directly to verified universities, with help from students who already study there.',
  openGraph: {
    siteName: 'Modex Apply',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-root">{children}</body>
    </html>
  );
}
