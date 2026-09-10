import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useApi } from "../auth";
import { useSettings } from "../hooks";
import { uploadReceipt } from "../upload";

interface Job {
  id: number;
  name: string;
  progress: number;
  state: "queued" | "uploading" | "done" | "error";
  error?: string;
  expenseId?: string;
}

export function CapturePage() {
  const api = useApi();
  const qc = useQueryClient();
  const settings = useSettings();
  const [company, setCompany] = useState<string>("");
  const [project, setProject] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  const update = (id: number, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const created = files.map((f) => ({ id: nextId.current++, name: f.name, progress: 0, state: "queued" as const }));
    setJobs((js) => [...created, ...js]);
    // Sequential keeps memory low on phones; uploads are small anyway.
    for (let i = 0; i < files.length; i++) {
      const job = created[i]!;
      const file = files[i]!;
      update(job.id, { state: "uploading" });
      try {
        const expense = await uploadReceipt(api, file, {
          company: company || null,
          project: project || null,
          category: category || null,
          onProgress: (p) => update(job.id, { progress: p }),
        });
        update(job.id, { state: "done", progress: 1, expenseId: expense.id });
      } catch (err) {
        update(job.id, { state: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
    void qc.invalidateQueries({ queryKey: ["expenses"] });
  }

  return (
    <div>
      <h1>Capture receipts</h1>
      <div className="card">
        <div className="field-row">
          <label>
            Company
            <select value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">Default ({settings.data?.defaultCompany ?? "none"})</option>
              {settings.data?.companies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Project
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">{settings.data?.projects.length ? "Detect automatically" : "None"}</option>
              {settings.data?.projects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Detect automatically</option>
              {settings.data?.categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="capture-buttons">
          <button className="btn primary large" onClick={() => cameraRef.current?.click()}>📷 Take photo</button>
          <button className="btn large" onClick={() => filesRef.current?.click()}>📁 Choose files</button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }} />
        <input ref={filesRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }} />
        <p className="muted">Photos are downscaled on your device before upload. PDFs are sent as-is (max 20 MB).</p>
      </div>

      {jobs.length > 0 && (
        <div className="card">
          <h2>Uploads</h2>
          <ul className="jobs">
            {jobs.map((j) => (
              <li key={j.id} className={`job ${j.state}`}>
                <span className="job-name">{j.name}</span>
                {j.state === "uploading" && <progress value={j.progress} max={1} />}
                {j.state === "queued" && <span className="muted">Waiting</span>}
                {j.state === "done" && j.expenseId && <Link to={`/expenses/${j.expenseId}`}>Uploaded · scanning</Link>}
                {j.state === "error" && <span className="error">{j.error}</span>}
              </li>
            ))}
          </ul>
          <p>
            <Link to="/inbox" className="btn">Go to inbox</Link>
          </p>
        </div>
      )}
    </div>
  );
}
