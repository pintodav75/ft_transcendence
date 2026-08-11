import { createFileRoute } from '@tanstack/react-router';

// Pathless layout for the two game screens (`/games` and `/games/$gameId`), exactly like
// `_authenticated.solo.tsx` and `_authenticated.teams.tsx`: it renders its `<Outlet/>` and
// nothing else.
export const Route = createFileRoute('/_authenticated/games')({});
