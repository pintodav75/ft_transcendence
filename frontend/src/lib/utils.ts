import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Used wherever a value is legitimately UNKNOWN (no score, no Elo delta, no date, no win rate). */
export const EM_DASH = '—'
