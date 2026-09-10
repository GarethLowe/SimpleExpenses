const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number) as [number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function monthOf(date: string | null): string | null {
  return date && isIsoDate(date) ? date.slice(0, 7) : null;
}

export function yearOf(date: string | null): string | null {
  return date && isIsoDate(date) ? date.slice(0, 4) : null;
}

/**
 * Best-effort normalisation of the many date formats found on receipts into
 * YYYY-MM-DD. Ambiguous numeric forms (01/02/2024) are read as day-first unless
 * `monthFirst` is set. Returns null when nothing parseable is found.
 */
export function normaliseDate(input: string | null | undefined, opts: { monthFirst?: boolean } = {}): string | null {
  if (!input) return null;
  const s = input.trim();
  if (isIsoDate(s)) return s;

  // 2024-03-05T10:00:00 or 2024/03/05
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return build(m[1]!, m[2]!, m[3]!);

  // 05/03/2024, 05-03-24, 5.3.2024
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = expandYear(m[3]!);
    let day: number;
    let month: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else if (opts.monthFirst) {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }
    return build(year, month, day);
  }

  // 5 March 2024, 05 Mar 24, March 5, 2024
  const months = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  m = /(\d{1,2})\s*([A-Za-z]{3,9})\.?,?\s*(\d{2,4})/.exec(s);
  if (m) {
    const mi = months.indexOf(m[2]!.slice(0, 3).toLowerCase());
    if (mi >= 0) return build(expandYear(m[3]!), mi + 1, Number(m[1]));
  }
  m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{2,4})/.exec(s);
  if (m) {
    const mi = months.indexOf(m[1]!.slice(0, 3).toLowerCase());
    if (mi >= 0) return build(expandYear(m[3]!), mi + 1, Number(m[2]));
  }
  return null;
}

function expandYear(y: string): string {
  return y.length === 2 ? `20${y}` : y;
}

function build(y: string | number, mo: string | number, d: string | number): string | null {
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
