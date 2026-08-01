import { AvatarUploader } from '@/components/profile/AvatarUploader';
import { PasswordChange } from '@/components/profile/PasswordChange';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { TwoFactorSettings } from '@/components/profile/TwoFactorSettings';
import { Card } from '@/components/ui/card';
import { useAnnouncement } from '@/lib/use-announcement';
import { useAuthStore } from '@/stores/auth-store';

export function Profile() {
  // Garanti non-null : la route est sous la garde `_authenticated`.
  const user = useAuthStore((s) => s.user);
  /**
   * 🔑 UNE SEULE région live pour toute la page, tenue ici et prêtée aux quatre sections.
   *
   * Elle vit au niveau de la page et non dans chaque section parce que deux régions montées
   * en même temps se disputent la lecture : le lecteur d'écran en annonce une, l'autre, ou
   * les deux dans un ordre imprévisible. Les six actions de cette page (avatar, profil, mot
   * de passe, 2FA) passent donc toutes par le même `announce`.
   */
  const announcement = useAnnouncement();

  if (!user) return null;

  return (
    <div className="flex h-full w-full flex-col">
      {/* @container : le layout répond à la largeur de la CARTE, pas du viewport
          (la colonne centrale est bien plus étroite que l'écran). */}
      <Card className="@container flex flex-1 flex-col gap-8 px-6 py-10 sm:px-8">
        {/* Montée en permanence, et VIDE au départ : une région insérée en même temps que son
            texte n'est pas annoncée de façon fiable — le lecteur d'écran doit déjà la
            surveiller quand elle se remplit. `sr-only` est `position: absolute`, donc une
            région vide ne coûte aucune place. */}
        <p role="status" className="sr-only">
          {announcement.message}
        </p>

        <h1 className="text-3xl label-caps-black">Profile</h1>

        <div className="flex flex-1 flex-col justify-around gap-12 @lg:gap-8">
          {/* Ligne 1 : identité (gauche) | profil (droite) */}
          <div className="flex flex-col gap-8 @lg:flex-row @lg:items-start @lg:justify-evenly">
            {/* <div> et non <aside> : c'est l'identité PRINCIPALE de la page, pas un contenu
                annexe — `aside` la sortirait du flux de lecture principal. */}
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

          {/* <hr> plutôt qu'un <div> bordé : c'est une séparation thématique, et l'élément
              natif la porte dans l'arbre d'accessibilité. */}
          <hr className="border-border-subtle" />

          {/* Ligne 2 : sécurité (mot de passe | 2FA) */}
          <div className="flex flex-col gap-8 @lg:flex-row @lg:items-start @lg:justify-evenly">
            <PasswordChange announce={announcement.announce} />
            <TwoFactorSettings announce={announcement.announce} />
          </div>
        </div>
      </Card>
    </div>
  );
}
