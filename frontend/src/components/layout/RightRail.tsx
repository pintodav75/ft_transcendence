export function RightRail() {
  return (
    <aside
      aria-label="Social"
      // w-78 = 312px, the social rail's width in the vsmode-home-demo maquette:
      // the placeholder is sized like the real thing so every page is laid out
      // against the space it will actually have once the rail is filled in.
      className="panel sticky top-4 hidden h-[calc(100dvh-2rem)] w-78 shrink-0 lg:block"
    />
  );
}
