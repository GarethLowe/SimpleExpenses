import { expensesToCsv, formatMoney, type ReportTotals } from "@simple-expenses/shared";
import { useState } from "react";
import { useApi } from "../auth";
import { ErrorBox, Spinner } from "../components/common";
import { useReport } from "../hooks";
import { MONTHS, currentYear, downloadText, yearsAround } from "../utils";

export function ReportsPage() {
  const [year, setYear] = useState(currentYear());
  const report = useReport(year);
  const api = useApi();
  const [exporting, setExporting] = useState(false);
  const r = report.data;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

  async function exportCsv() {
    setExporting(true);
    try {
      const all = await api.allInYear(year);
      downloadText(`expenses-${year}.csv`, expensesToCsv(all));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Reports</h1>
        <div className="actions">
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {yearsAround(currentYear()).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button className="btn" disabled={exporting} onClick={() => void exportCsv()}>Export CSV</button>
        </div>
      </div>
      <ErrorBox error={report.error} />
      {report.isLoading && <Spinner />}
      {r && (
        <>
          <div className="stats">
            <Stat label="Total" value={formatMoney(r.overall.total, r.currency)} />
            <Stat label="Tax" value={formatMoney(r.overall.tax, r.currency)} />
            <Stat label="Receipts" value={String(r.overall.count)} />
            {Object.entries(r.otherCurrencies).map(([c, t]) => (
              <Stat key={c} label={`Also in ${c}`} value={formatMoney(t.total, c)} />
            ))}
          </div>

          <Breakdown title="By month" rows={months.map((m) => [MONTHS[Number(m.slice(5)) - 1] ?? m, r.byMonth[m]])} currency={r.currency} />
          <Breakdown title="By company" rows={sortRows(r.byCompany)} currency={r.currency} />
          <Breakdown title="By type" rows={sortRows(r.byCategory)} currency={r.currency} />

          <Matrix title="Company by month" data={r.byCompanyAndMonth} months={months} currency={r.currency} />
          <Matrix title="Type by month" data={r.byCategoryAndMonth} months={months} currency={r.currency} />
        </>
      )}
    </div>
  );
}

function sortRows(map: Record<string, ReportTotals>): Array<[string, ReportTotals | undefined]> {
  return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat card">
      <div className="muted small">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Breakdown({ title, rows, currency }: { title: string; rows: Array<[string, ReportTotals | undefined]>; currency: string | null }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <table className="table">
        <thead>
          <tr>
            <th></th>
            <th className="num">Count</th>
            <th className="num">Tax</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, t]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">{t?.count ?? 0}</td>
              <td className="num">{formatMoney(t?.tax ?? 0, currency)}</td>
              <td className="num">{formatMoney(t?.total ?? 0, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Matrix({ title, data, months, currency }: { title: string; data: Record<string, Record<string, ReportTotals>>; months: string[]; currency: string | null }) {
  const keys = Object.keys(data).sort();
  if (keys.length === 0) return null;
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="scroll-x">
        <table className="table compact">
          <thead>
            <tr>
              <th></th>
              {months.map((m) => (
                <th key={m} className="num">{MONTHS[Number(m.slice(5)) - 1]?.slice(0, 3)}</th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const row = data[k] ?? {};
              const total = Object.values(row).reduce((s, t) => s + t.total, 0);
              return (
                <tr key={k}>
                  <td>{k}</td>
                  {months.map((m) => (
                    <td key={m} className="num">{row[m] ? formatMoney(row[m]!.total, currency) : ""}</td>
                  ))}
                  <td className="num"><strong>{formatMoney(total, currency)}</strong></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
