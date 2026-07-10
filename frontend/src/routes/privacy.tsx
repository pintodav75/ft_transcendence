import { createFileRoute } from '@tanstack/react-router';
import Privacy from '@/pages/privacy';

export const Route = createFileRoute('/privacy')({
  component: Privacy,
});