import type { Metadata } from 'next';
import { Card, CardHeader } from '@modex/ui';
import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-login">
      <Card padding="lg">
        <CardHeader
          title="Sign in"
          description="Your profile and documents are yours. Modex never applies on your behalf without you."
        />
        <div className="mx-login__form">
          {/*
            `next` is validated in the form rather than trusted: an open
            redirect is one of the cheapest ways to turn a sign-in page into a
            phishing tool, and the value here comes from the URL.
          */}
          <LoginForm next={next} />
        </div>
      </Card>
    </main>
  );
}
