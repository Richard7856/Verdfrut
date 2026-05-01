// Utilidad estándar para combinar clases Tailwind con resolución de conflictos.
// Uso: <div className={cn('p-4', isActive && 'bg-green-500', className)} />

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
