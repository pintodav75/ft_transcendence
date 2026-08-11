import { AvatarUploader } from '@/components/profile/AvatarUploader';
import { DeleteAccount } from '@/components/profile/DeleteAccount';
import { LinkedAccounts } from '@/components/profile/LinkedAccounts';
import { PasswordChange } from '@/components/profile/PasswordChange';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { TwoFactorSettings } from '@/components/profile/TwoFactorSettings';
import { Card } from '@/components/ui/card';
import { useAnnouncement } from '@/lib/use-announcement';
import { useAuthStore } from '@/stores/auth-store';

export function Profile() {
  // Guaranteed non-null: the route sits behind the `_authenticated` guard.
  const user = useAuthStore((s) => s.user);
  /** ONE live region for the whole page, held here and lent to every section. */
  const announcement = useAnnouncement();

  if (!user) return null;

  return (
    <div className="flex h-full w-full flex-col">

      <Card className="@container flex flex-1 flex-col gap-8 px-6 py-10 sm:px-8">

        <p role="status" className="sr-only">
          {announcement.message}
        </p>

        <h1 className="text-3xl label-caps-black">Profile</h1>

        <div className="flex flex-1 flex-col justify-around gap-12 @lg:gap-8">
          {/* Row 1: identity (left) | profile (right) */}
          <div className="flex flex-col gap-8 @lg:flex-row @lg:items-start @lg:justify-evenly">

            <div className="flex flex-col items-center gap-4 text-center @lg:mt-6 @lg:w-56 @lg:shrink-0">
              <AvatarUploader announce={announcement.announce} />
              <div className="flex flex-col items-center">
                <span className="text-xl font-semibold text-text-primary">
                  {user.displayName ?? user.pseudo}
                </span>
                <span className="text-text-secondary">@{user.pseudo}</span>
              </div>
            </div>
            <ProfileForm announce={announcement.announce} />
          </div>

          <hr className="border-border-subtle" />

          <LinkedAccounts announce={announcement.announce} />

          <hr className="border-border-subtle" />

          {/* Row 3: security (password | 2FA) */}
          <div className="flex flex-col gap-8 @lg:flex-row @lg:items-start @lg:justify-evenly">
            <PasswordChange announce={announcement.announce} />
            <TwoFactorSettings announce={announcement.announce} />
          </div>

          <hr className="border-border-subtle" />

          <DeleteAccount />
        </div>
      </Card>
    </div>
  );
}
