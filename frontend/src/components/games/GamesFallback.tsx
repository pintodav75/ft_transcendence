type GamesFallbackProps = {
  variant: 'loading' | 'error';
};

// Shared loading/error placeholder for the game collection components.
export function GamesFallback({ variant }: GamesFallbackProps) {
  const text = variant === 'loading' ? 'Loading...' : 'Games not available.';
  return <p className="text-white/60">{text}</p>;
}
