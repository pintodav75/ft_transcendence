import { createFileRoute } from '@tanstack/react-router';
import Index from '@/pages/index'

export const Route = createFileRoute('/')({
    component: Index
});