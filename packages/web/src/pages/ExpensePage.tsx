import { formatMoney, type ExpenseEdit } from "@simple-expenses/shared";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Confirm, ErrorBox, Spinner, StatusPill } from "../components/common";
import { useDeleteExpense, useExpense, useFileUrl, useRescan, useSettings, useUpdateExpense } from "../hooks";

type Form = {
  date: string;
  merchant: string;
  company: string;
  category: string;
  currency: string;
  total: string;
  tax: string;
  paymentMethod: string;
  receiptNumber: string;
  notes: string;
};

export function ExpensePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const expense = useExpense(id);
  const file = useFileUrl(id);
  const settings = useSettings();
  const update = useUpdateExpense();
  const remove = useDeleteExpense();
  const rescan = useRescan();
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);

  const e = expense.data;
  useEffect(() => {
    if (e && !dirty) {
      setForm({
        date: e.date ?? "",
        merchant: e.merchant ?? "",
        company: e.company ?? "",
        category: e.category ?? "",
        currency: e.currency ?? settings.data?.defaultCurrency ?? "GBP",
        total: e.total?.toString() ?? "",
        tax: e.tax?.toString() ?? "",
        paymentMethod: e.paymentMethod ?? "",
        receiptNumber: e.receiptNumber ?? "",
        notes: e.notes ?? "",
      });
    }
  }, [e, dirty, settings.data?.defaultCurrency]);

  if (expense.isLoading || !form) return <Spinner />;
  if (expense.error || !e) return <ErrorBox error={expense.error ?? new Error("Not found")} />;

  const field = (k: keyof Form) => ({
    value: form[k],
    onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setDirty(true);
      setForm({ ...form, [k]: ev.target.value });
    },
  });

  function save(extra: ExpenseEdit = {}) {
    if (!form || !id) return;
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    const edit: ExpenseEdit = {
      date: form.date || null,
      merchant: form.merchant.trim() || null,
      company: form.company || null,
      category: form.category || null,
      currency: form.currency.trim().toUpperCase() || null,
      total: num(form.total),
      tax: num(form.tax),
      paymentMethod: form.paymentMethod.trim() || null,
      receiptNumber: form.receiptNumber.trim() || null,
      notes: form.notes.trim() || null,
      ...extra,
    };
    update.mutate({ id, edit }, { onSuccess: () => setDirty(false) });
  }

  const isPdf = e.file.contentType === "application/pdf";
  const busy = update.isPending || remove.isPending || rescan.isPending;

  return (
    <div>
      <div className="page-head">
        <h1>
          <Link to="/expenses" className="muted">Expenses</Link> / {e.merchant ?? e.file.originalFilename}
        </h1>
        <StatusPill status={e.status} />
      </div>
      <ErrorBox error={update.error ?? remove.error ?? rescan.error} />
      {e.status === "failed" && <p className="error">Extraction failed: {e.error}</p>}

      <div className="detail">
        <div className="preview card">
          {file.data ? (
            isPdf ? (
              <iframe title="Receipt" src={file.data.url} />
            ) : (
              <a href={file.data.url} target="_blank" rel="noreferrer">
                <img src={file.data.url} alt="Receipt" />
              </a>
            )
          ) : (
            <Spinner label="Loading file…" />
          )}
          <div className="muted small">
            {e.file.originalFilename} · {(e.file.size / 1024).toFixed(0)} KB
            {e.extraction && (
              <>
                {" "}· read by {e.extraction.provider}/{e.extraction.model} · {Math.round(e.extraction.confidence * 100)}% confidence
              </>
            )}
          </div>
          {e.extraction?.raw.notes && <p className="muted small">Note from extraction: {e.extraction.raw.notes}</p>}
        </div>

        <form
          className="card form"
          onSubmit={(ev) => {
            ev.preventDefault();
            save(e.status === "needs_review" || e.status === "failed" ? { status: "ready" } : {});
          }}
        >
          <div className="field-row">
            <label>
              Date
              <input type="date" {...field("date")} />
            </label>
            <label>
              Merchant
              <input type="text" {...field("merchant")} />
            </label>
          </div>
          <div className="field-row">
            <label>
              Company
              <select {...field("company")}>
                <option value="">—</option>
                {settings.data?.companies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                {form.company && !settings.data?.companies.includes(form.company) && <option value={form.company}>{form.company}</option>}
              </select>
            </label>
            <label>
              Type
              <select {...field("category")}>
                <option value="">—</option>
                {settings.data?.categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                {form.category && !settings.data?.categories.includes(form.category) && <option value={form.category}>{form.category}</option>}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label>
              Total
              <input type="number" step="0.01" inputMode="decimal" {...field("total")} />
            </label>
            <label>
              Tax
              <input type="number" step="0.01" inputMode="decimal" {...field("tax")} />
            </label>
            <label>
              Currency
              <input type="text" maxLength={3} {...field("currency")} />
            </label>
          </div>
          <div className="field-row">
            <label>
              Payment
              <input type="text" {...field("paymentMethod")} />
            </label>
            <label>
              Receipt no.
              <input type="text" {...field("receiptNumber")} />
            </label>
          </div>
          <label>
            Notes
            <textarea rows={3} {...field("notes")} />
          </label>

          {e.lineItems.length > 0 && (
            <details>
              <summary>{e.lineItems.length} line items</summary>
              <table className="table">
                <tbody>
                  {e.lineItems.map((l, i) => (
                    <tr key={i}>
                      <td>{l.description}</td>
                      <td className="num">{l.quantity ?? ""}</td>
                      <td className="num">{formatMoney(l.total ?? l.unit_price, e.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <div className="actions wrap">
            <button className="btn primary" type="submit" disabled={busy}>
              {e.status === "needs_review" || e.status === "failed" ? "Save & mark ready" : "Save"}
            </button>
            {dirty && e.status === "ready" && (
              <button className="btn" type="button" disabled={busy} onClick={() => save()}>Save only</button>
            )}
            <button className="btn" type="button" disabled={busy || e.status === "uploading"} onClick={() => update.mutate({ id: e.id, edit: { archived: !e.archived } })}>
              {e.archived ? "Unarchive" : "Archive"}
            </button>
            <button className="btn" type="button" disabled={busy || e.status === "scanning" || e.status === "uploading"} onClick={() => rescan.mutate(e.id)}>
              Re-scan
            </button>
            <Confirm message="Delete this expense and its file?" onConfirm={() => remove.mutate(e.id, { onSuccess: () => navigate("/expenses") })}>
              Delete
            </Confirm>
          </div>
        </form>
      </div>
    </div>
  );
}
