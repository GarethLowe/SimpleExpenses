import { formatMoney, type ExpenseStatus } from "@simple-expenses/shared";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Confirm, Empty, ErrorBox, ExpenseRow, Spinner } from "../components/common";
import { useBulk, useExpenses, useSettings } from "../hooks";
import { MONTHS, STATUS_LABEL, currentYear, groupByMonth, yearsAround } from "../utils";

export function ExpensesPage() {
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const bulk = useBulk();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState<string[]>([]); // cursors of loaded extra pages

  const year = params.get("year") ?? currentYear();
  const monthNum = params.get("month") ?? "";
  const company = params.get("company") ?? "";
  const category = params.get("category") ?? "";
  const status = (params.get("status") ?? "") as ExpenseStatus | "";
  const archived = (params.get("archived") ?? "false") as "true" | "false" | "all";
  const allYears = params.get("year") === "all";

  const filters = useMemo(
    () => ({
      ...(allYears ? {} : monthNum ? { month: `${year}-${monthNum}` } : { year }),
      ...(company ? { company } : {}),
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
      archived,
      limit: 100,
    }),
    [allYears, year, monthNum, company, category, status, archived],
  );
  const first = useExpenses(filters);
  const extra = useExpenses({ ...filters, cursor: pages[pages.length - 1] });
  const items = useMemo(() => {
    const all = [...(first.data?.items ?? [])];
    if (pages.length && extra.data) all.push(...extra.data.items);
    return all;
  }, [first.data, extra.data, pages.length]);
  const groups = useMemo(() => groupByMonth(items), [items]);
  const nextCursor = pages.length ? extra.data?.cursor : first.data?.cursor;

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "year") next.delete("month");
    setParams(next, { replace: true });
    setPages([]);
    setSelected(new Set());
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const ids = [...selected];
  const run = (action: Parameters<typeof bulk.mutate>[0]["action"]) => bulk.mutate({ ids, action }, { onSuccess: () => setSelected(new Set()) });

  return (
    <div>
      <div className="page-head">
        <h1>Expenses</h1>
        <Link to="/capture" className="btn primary">＋ Capture</Link>
      </div>

      <div className="filters card">
        <label>
          Year
          <select value={allYears ? "all" : year} onChange={(e) => set("year", e.target.value)}>
            {yearsAround(currentYear()).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
            <option value="all">All years</option>
          </select>
        </label>
        <label>
          Month
          <select value={monthNum} onChange={(e) => set("month", e.target.value)} disabled={allYears}>
            <option value="">All</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Company
          <select value={company} onChange={(e) => set("company", e.target.value)}>
            <option value="">All</option>
            {settings.data?.companies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={category} onChange={(e) => set("category", e.target.value)}>
            <option value="">All</option>
            {settings.data?.categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => set("status", e.target.value)}>
            <option value="">Any</option>
            {(Object.keys(STATUS_LABEL) as ExpenseStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <label>
          Archive
          <select value={archived} onChange={(e) => set("archived", e.target.value === "false" ? "" : e.target.value)}>
            <option value="false">Active</option>
            <option value="true">Archived</option>
            <option value="all">Both</option>
          </select>
        </label>
      </div>

      <ErrorBox error={first.error ?? bulk.error} />
      {first.isLoading && <Spinner />}
      {!first.isLoading && items.length === 0 && <Empty>No expenses match these filters.</Empty>}

      {groups.map((g) => (
        <section key={g.month ?? "none"} className="month-group">
          <div className="month-head">
            <h2>{g.label}</h2>
            <span className="muted">
              {g.items.length} · {formatMoney(g.total, g.currency)}
            </span>
            <button
              className="link"
              onClick={() => {
                const all = g.items.every((e) => selected.has(e.id));
                setSelected((s) => {
                  const n = new Set(s);
                  for (const e of g.items) all ? n.delete(e.id) : n.add(e.id);
                  return n;
                });
              }}
            >
              {g.items.every((e) => selected.has(e.id)) ? "Deselect all" : "Select all"}
            </button>
          </div>
          <ul className="list">
            {g.items.map((e) => (
              <ExpenseRow key={e.id} expense={e} selected={selected.has(e.id)} onSelect={(on) => toggle(e.id, on)} />
            ))}
          </ul>
        </section>
      ))}

      {nextCursor && (
        <p>
          <button className="btn" disabled={extra.isFetching} onClick={() => setPages((p) => [...p, nextCursor])}>
            Load more
          </button>
        </p>
      )}

      {ids.length > 0 && (
        <div className="bulkbar">
          <strong>{ids.length} selected</strong>
          <select defaultValue="" onChange={(e) => { if (e.target.value) run({ type: "move", company: e.target.value }); e.target.value = ""; }}>
            <option value="">Move to company…</option>
            {settings.data?.companies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) run({ type: "move", category: e.target.value }); e.target.value = ""; }}>
            <option value="">Set type…</option>
            {settings.data?.categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button className="btn small" onClick={() => run({ type: "mark_ready" })}>Mark ready</button>
          {archived === "true" ? (
            <button className="btn small" onClick={() => run({ type: "unarchive" })}>Unarchive</button>
          ) : (
            <button className="btn small" onClick={() => run({ type: "archive" })}>Archive</button>
          )}
          <Confirm className="btn small danger" message={`Delete ${ids.length} expense(s) and their files? This cannot be undone.`} onConfirm={() => run({ type: "delete" })}>
            Delete
          </Confirm>
          <button className="link" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
    </div>
  );
}
