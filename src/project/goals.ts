// Writing goals: words per day and an optional total for the project, kept in
// goals.json in the project folder (so they travel with the project).

export interface DayLog {
  /** Total manuscript words when the day's count started (or was reset). */
  base: number;
  /** Total at the last update, for the history chart. */
  last: number;
}

export interface Goals {
  formatVersion: 1;
  daily: number;
  /** Target length of the whole manuscript in words (0 = none). */
  project: number;
  /** Optional deadline, YYYY-MM-DD. */
  deadline: string | null;
  days: Record<string, DayLog>;
}

export const GOALS_FILE = "goals.json";

export function emptyGoals(): Goals {
  return { formatVersion: 1, daily: 1000, project: 0, deadline: null, days: {} };
}

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Record the current total; the first observation of a day sets its starting point. */
export function observe(g: Goals, total: number, today = dayKey()): Goals {
  const day = g.days[today];
  if (day && day.last === total) return g;
  return { ...g, days: { ...g.days, [today]: { base: day?.base ?? total, last: total } } };
}

export function wordsToday(g: Goals, total: number, today = dayKey()): number {
  const day = g.days[today];
  return day ? Math.max(0, total - day.base) : 0;
}

/** Set today's count to any number (0 = start the day over). */
export function resetToday(g: Goals, total: number, value = 0, today = dayKey()): Goals {
  return { ...g, days: { ...g.days, [today]: { base: total - Math.max(0, value), last: total } } };
}

export function history(g: Goals, days = 7, today = new Date()): { day: string; words: number }[] {
  const out: { day: string; words: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    const log = g.days[k];
    out.push({ day: k, words: log ? Math.max(0, log.last - log.base) : 0 });
  }
  return out;
}

export interface WeekDay {
  key: string;
  /** Built from the computer's own calendar (never parsed from text). */
  date: Date;
  words: number;
  today: boolean;
  future: boolean;
}

/**
 * The first day of the week on this computer: 1 = Monday … 7 = Sunday.
 * Uses the system locale's week information where the browser engine has it.
 */
export function firstDayOfWeek(locale = typeof navigator !== "undefined" ? navigator.language : "en-US"): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info?.firstDay) return info.firstDay;
    const region = loc.maximize().region ?? "";
    // Regions whose weeks start on Sunday (where week info is unavailable).
    if (/^(US|CA|MX|BR|JP|KR|TW|HK|IL|PH|ZA|AU|IN|SA|AE|CO|PE|VE|GT|HN|NI|PA|DO|PR|SV|BZ|JM|KE|MO|BD|PK|NP|TH|ID|KH|LA|MM|BT|AR|UM|AS|GU|VI|WS|ZW)$/.test(region)) return 7;
  } catch {
    /* fall through */
  }
  return 1;
}

/** This calendar week, starting on the computer's first day of the week. */
export function calendarWeek(g: Goals, today = new Date(), firstDay = firstDayOfWeek()): WeekDay[] {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow = t.getDay() === 0 ? 7 : t.getDay(); // 1 = Monday … 7 = Sunday
  const back = (dow - firstDay + 7) % 7;
  const out: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    // Day arithmetic with the Date constructor stays correct across month ends and clock changes.
    const date = new Date(t.getFullYear(), t.getMonth(), t.getDate() - back + i);
    const key = dayKey(date);
    const log = g.days[key];
    out.push({ key, date, words: log ? Math.max(0, log.last - log.base) : 0, today: i === back, future: i > back });
  }
  return out;
}

/** Words per day needed to reach the project goal by the deadline. */
export function perDayToDeadline(g: Goals, total: number, today = new Date()): number | null {
  if (!g.project || !g.deadline) return null;
  const end = new Date(g.deadline + "T23:59:59");
  const days = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
  if (days <= 0) return null;
  return Math.max(0, Math.ceil((g.project - total) / days));
}
