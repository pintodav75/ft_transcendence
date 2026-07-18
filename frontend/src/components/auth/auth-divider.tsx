type AuthDividerProps = {
  label?: string;
};

export function AuthDivider({ label = 'Or continue with' }: AuthDividerProps) {
  return (
    <div className="flex items-center gap-3 text-xs text-text-muted">
      <span className="h-px flex-1 bg-border-subtle" />
      <span className="whitespace-nowrap">{label}</span>
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}
