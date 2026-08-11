import { createFileRoute } from '@tanstack/react-router';

// Pathless layout for the two solo screens (`/solo` and `/solo/$ladderId`), exactly like
// `_authenticated.teams.tsx`: it renders its `<Outlet/>` and nothing else.
export const Route = createFileRoute('/_authenticated/solo')({});
