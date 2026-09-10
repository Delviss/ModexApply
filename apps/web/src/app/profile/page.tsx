import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardHeader, CompletenessMeter } from '@modex/ui';
import type { ProfileCompleteness, StudentProfile } from '@modex/contracts';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import { ProfileForm } from '@/components/profile-form';

export const metadata: Metadata = {
  title: 'Your profile',
  robots: { index: false },
};

interface ProfileResponse {
  profile: StudentProfile;
  completeness: ProfileCompleteness;
}

/**
 * The student profile (Phase 2 §1).
 *
 * Progressive by design: nothing here blocks search, and the meter shows what
 * is missing rather than scoring the student. The completeness panel is
 * deliberately in its own column, well away from anything about offers or
 * admission — the issue's rule is that it "sits nowhere near admission or offer
 * language", and layout is part of keeping that.
 */
export default async function ProfilePage() {
  const token = await sessionToken();
  if (token === null) redirect('/login?next=/profile');

  let data: ProfileResponse;
  try {
    data = await apiGetAs<ProfileResponse>('/me/profile', token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?next=/profile');
    throw error;
  }

  return (
    <main className="mx-profile">
      <header>
        <h1 className="mx-card__title">Your profile</h1>
        <p className="mx-card__description">
          Fill this in once. We use it to check which published requirements you already
          meet — never to guess what a university will decide.
        </p>
      </header>

      <div className="mx-profile__layout">
        <Card padding="lg">
          <CardHeader
            title="About you"
            description="Saved as you type. You can leave and come back."
          />
          <div className="mx-profile__form">
            <ProfileForm profile={data.profile} />
          </div>
        </Card>

        <aside className="mx-profile__aside">
          <Card padding="lg">
            <CompletenessMeter completeness={data.completeness} />
          </Card>
        </aside>
      </div>
    </main>
  );
}
