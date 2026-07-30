import { createFileRoute } from '@tanstack/react-router';

// Pathless layout for the two solo screens (`/solo` and `/solo/$ladderId`), exactly like
// `_authenticated.teams.tsx`: it renders its `<Outlet/>` and nothing else. The guard and the
// app shell already live on `_authenticated`.
export const Route = createFileRoute('/_authenticated/solo')({});
