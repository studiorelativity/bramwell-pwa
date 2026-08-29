// STAGE 07 — Supabase client. The ONLY file importing @supabase/supabase-js. DOM-free; never imports state.ts.
import type { DayNumber, Habit, HabitLog } from './types.ts'
const E = () => new Error('STAGE 07: not implemented')
export function signIn(): Promise<void> { throw E() }
export function signOut(): Promise<void> { throw E() }
export function isSignedIn(): boolean { throw E() }
export function listHabits(): Promise<Habit[]> { throw E() }
export function logsForRange(_from: DayNumber, _to: DayNumber): Promise<HabitLog[]> { throw E() }
export function upsertLog(_log: HabitLog): Promise<HabitLog> { throw E() }
export function deleteLog(_habitId: string, _day: DayNumber): Promise<void> { throw E() }
export function saveHabit(_habit: Omit<Habit, 'id'> & { id?: string }): Promise<Habit> { throw E() }
export function archiveHabit(_id: string): Promise<void> { throw E() }
