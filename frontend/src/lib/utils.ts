import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Used wherever a value is legitimately UNKNOWN (no score, no Elo delta, no date, no win
 * rate). Neutral on purpose: both `lib/ladders.ts` and `lib/team-detail.ts` format missing
 * values, and hosting the constant in either of them would make the other import a domain
 * it has nothing to do with.
 */
export const EM_DASH = '—'
