import { cn } from '@/lib/utils'

// Minimal, dependency-free avatar (the new foundation dropped @radix-ui).
// Shows the image when `src` is set, otherwise a text fallback.
type AvatarProps = {
  src?: string
  alt?: string
  fallback: string
  className?: string
}

export function Avatar({ src, alt = '', fallback, className }: AvatarProps) {
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-card-strong text-text-secondary',
        className,
      )}
    >
      {src ? (
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : (
        <span className="text-xs label-caps">{fallback}</span>
      )}
    </div>
  )
}
