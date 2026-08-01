import { cn } from '@/lib/utils';

// Minimal, dependency-free avatar (the new foundation dropped @radix-ui).
// Shows the image when `src` is set, otherwise a text fallback.
type AvatarProps = {
  src?: string | null;
  alt?: string;
  fallback?: string;
  className?: string;
};

export function Avatar({ src, alt = '', fallback = '?', className }: AvatarProps) {
  return (
    <div
      // 🔑 `text-xs` VIT ICI, PAS SUR LE `<span>`, et c'est ce qui le rend surchargeable :
      // `cn` passe par tailwind-merge, donc un appelant qui donne `text-2xl` gagne, et le
      // repli l'hérite. Écrite en dur sur le `<span>`, la taille était imposée à tout le
      // monde — 12 px d'initiales au centre d'un cercle de 80 px sur les trois en-têtes de
      // dossier. ⚠️ La corriger en RETIRANT `text-xs` (tentative de [F-PLAYER]) déplace le
      // problème sur les 20 autres appels, qui comptent dessus : la valeur par défaut reste,
      // seul le point d'ancrage change.
      className={cn(
        'flex items-center justify-center overflow-hidden rounded-full text-text-secondary text-xs size-14',
        src ? 'bg-text-secondary' : 'bg-surface-card-strong',
        className,
      )}
    >
      {src ? (
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : (
        <span className="label-caps">{fallback}</span>
      )}
    </div>
  );
}
