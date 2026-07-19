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
      className={cn(
        'flex items-center justify-center overflow-hidden rounded-full text-text-secondary size-14',
        src ? 'bg-text-secondary' : 'bg-surface-card-strong',
        className,
      )}
    >
      {src ? (
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : (
        <span className="text-xs label-caps">{fallback}</span>
      )}
    </div>
  );
}
