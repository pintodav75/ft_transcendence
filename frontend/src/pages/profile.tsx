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
  /**
   * ONE live region for the whole page, held here and lent to every section.
   *
   * It lives at page level rather than per section because two regions mounted at once compete
   * for the reader: it announces one, the other, or both in an unpredictable order. Every action
   * on this page — avatar, profile, password, 2FA, linking and unlinking a game account — goes
   * through this single `announce`.
   */
  const announcement = useAnnouncement();

  if (!user) return null;

  return (
    <div className="flex h-full w-full flex-col">
      {/* @container: the layout responds to the width of the CARD, not the viewport — the
          centre column is far narrower than the screen. */}
      <Card className="@container flex flex-1 flex-col gap-8 px-6 py-10 sm:px-8">
        {/* Mounted at all times and EMPTY at first: a region inserted together with its text is
            not reliably announced — the screen reader must already be watching it when it
            fills. `sr-only` is `position: absolute`, so an empty region costs no space. */}
        <p role="status" className="sr-only">
          {announcement.message}
        </p>

        <h1 className="text-3xl label-caps-black">Profile</h1>

        <div className="flex flex-1 flex-col justify-around gap-12 @lg:gap-8">
          {/* Row 1: identity (left) | profile (right) */}
          <div className="flex flex-col gap-8 @lg:flex-row @lg:items-start @lg:justify-evenly">
            {/* <div> and not <aside>: this is the page's PRIMARY identity, not side content —
                `aside` would take it out of the main reading flow. */}
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

          {/* <hr> rather than a bordered <div>: this is a thematic break, and the native
              element carries it into the accessibility tree. */}
          <hr className="border-border-subtle" />

          {/* Row 2: game accounts. Full width and NOT paired with a second section, unlike the
              rows around it — it carries four form rows, which half a column would crush. */}
          <LinkedAccounts announce={announcement.announce} />

          <hr className="border-border-subtle" />

          {/* Row 3: security (password | 2FA) */}
          <div className="flex flex-col gap-8 @lg:flex-row @lg:items-start @lg:justify-evenly">
            <PasswordChange announce={announcement.announce} />
            <TwoFactorSettings announce={announcement.announce} />
          </div>

          <hr className="border-border-subtle" />

          {/* Row 4: the way out. LAST and alone on its row, never paired — putting it beside an
              ordinary form would place the most destructive button of the app next to a Save. */}
          <DeleteAccount />
        </div>
      </Card>
    </div>
  );
}
