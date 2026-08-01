import type { TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

// Calqué sur Input, en multi-ligne (pas de hauteur fixe h-12, padding vertical).
//
// 🔑 `border-border-control` et NON `border-border-subtle` : la bordure d'un champ de saisie
// n'est pas décorative, c'est elle qui dit où commence la zone où l'on tape, et WCAG 1.4.11
// lui impose 3:1. `border-subtle` ne donne que 1,30:1 contre la carte et 1,42:1 contre le
// fond du champ — le champ est alors sans contour pour qui voit mal. `border-control` donne
// 3,17:1 et 3,47:1. C'est le token que `Input` et `Select` portent déjà, et le commentaire
// qui le déclare dans `index.css` nomme les trois : input, select, textarea.
export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-control border border-border-control bg-surface-input px-4 py-3 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20 aria-invalid:border-arena-red aria-invalid:focus:border-arena-red aria-invalid:focus:ring-arena-red/20',
        className,
      )}
      {...props}
    />
  );
}
