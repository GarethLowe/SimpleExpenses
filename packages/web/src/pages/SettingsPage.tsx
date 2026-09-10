import type { Settings } from "@simple-expenses/shared";
import { useEffect, useState } from "react";
import { ErrorBox, Spinner } from "../components/common";
import { useSaveSettings, useSettings } from "../hooks";

export function SettingsPage() {
  const settings = useSettings();
  const save = useSaveSettings();
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);

  if (!form) return settings.error ? <ErrorBox error={settings.error} /> : <Spinner />;

  return (
    <div>
      <h1>Settings</h1>
      <ErrorBox error={save.error} />
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(form, { onSuccess: (s) => setForm(s) });
        }}
      >
        <ListEditor label="Companies" hint="Who each expense belongs to (your business, personal, a client)." values={form.companies} onChange={(companies) => setForm({ ...form, companies })} />
        <ListEditor label="Types" hint="Categories the scanner picks from. Keep them distinct and few." values={form.categories} onChange={(categories) => setForm({ ...form, categories })} />
        <div className="field-row">
          <label>
            Default company
            <select value={form.defaultCompany ?? ""} onChange={(e) => setForm({ ...form, defaultCompany: e.target.value || null })}>
              <option value="">—</option>
              {form.companies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Default currency
            <input type="text" maxLength={3} value={form.defaultCurrency} onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value.toUpperCase() })} />
          </label>
        </div>
        <div className="actions">
          <button className="btn primary" type="submit" disabled={save.isPending}>Save</button>
          {save.isSuccess && !save.isPending && <span className="muted">Saved.</span>}
        </div>
      </form>
    </div>
  );
}

function ListEditor({ label, hint, values, onChange }: { label: string; hint: string; values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft("");
  };
  return (
    <fieldset>
      <legend>{label}</legend>
      <p className="muted small">{hint}</p>
      <ul className="chips">
        {values.map((v) => (
          <li key={v} className="chip">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
          </li>
        ))}
      </ul>
      <div className="inline">
        <input type="text" value={draft} placeholder={`Add ${label.toLowerCase().replace(/s$/, "")}`} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn small" onClick={add}>Add</button>
      </div>
    </fieldset>
  );
}
