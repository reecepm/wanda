// Tiny className utility shared across components. Matches the project-wide
// pattern (clsx + tailwind-merge).

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
