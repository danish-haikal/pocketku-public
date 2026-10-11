/**
 * Public-repository-safe browser-only starting state.
 * All personal accounts, financing, income, and commitments live in private D1.
 * Older browser demo records remain in browser storage until the user clears them.
 */
import { type FinanceData } from './types';
export function createDemoData(): FinanceData {
  return { version:1, accounts:[], commitments:[], funding:[],income:[],transfers:[],settlements:[],shared:[],reminders:[] };
}
