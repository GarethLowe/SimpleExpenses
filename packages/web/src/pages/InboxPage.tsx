import { formatMoney } from "@simple-expenses/shared";
import { Link } from "react-router-dom";
import { Empty, ErrorBox, Spinner, StatusPill } from "../components/common";
import { useBulk, useInbox, useRescan } from "../hooks";
import { shortDate } from "../utils";

export function InboxPage() {
  const inbox = useInbox();
  const bulk = useBulk();
  const rescan = useRescan();

  const review = inbox.items.filter((e) => e.status === "needs_review");
  const failed = inbox.items.filter((e) => e.status === "failed");
  const active = inbox.items.filter((e) => e.status === "scanning" || e.status === "uploading");
  const confident = review.filter((e) => e.extraction && e.extraction.confidence >= 0.8 && e.date && e.total && e.merchant);

  return (
    <div>
      <div className="page-head">
        <h1>Inbox</h1>
        <div className="actions">
          <Link to="/capture" className="btn primary">＋ Capture</Link>
          {confident.length > 0 && (
            <button className="btn" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: confident.map((e) => e.id), action: { type: "mark_ready" } })}>
              Accept {confident.length} confident
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={inbox.error ?? bulk.error} />
      {inbox.isLoading && <Spinner />}

      {active.length > 0 && (
        <section>
          <h2>In progress</h2>
          <ul className="list">
            {active.map((e) => (
              <li key={e.id} className="row">
                <Link to={`/expenses/${e.id}`} className="row-main">
                  <strong>{e.file.originalFilename}</strong> <StatusPill status={e.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>To review ({review.length})</h2>
        {review.length === 0 && !inbox.isLoading && <Empty>Nothing waiting. Capture a receipt to get started.</Empty>}
        <ul className="list">
          {review.map((e) => {
            const conf = e.extraction?.confidence ?? 0;
            return (
              <li key={e.id} className="row review">
                <Link to={`/expenses/${e.id}`} className="row-main">
                  <div className="row-title">
                    <strong>{e.merchant ?? e.file.originalFilename}</strong>
                    <span className={`pill conf-${conf >= 0.8 ? "high" : conf >= 0.5 ? "mid" : "low"}`}>{Math.round(conf * 100)}%</span>
                  </div>
                  <div className="row-sub muted">
                    {shortDate(e.date)} · {e.company ?? "No company"}{e.project ? ` · ${e.project}` : ""} · {e.category ?? "Uncategorised"}
                  </div>
                </Link>
                <div className="row-amount">{formatMoney(e.total, e.currency)}</div>
                <button className="btn small" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: [e.id], action: { type: "mark_ready" } })}>
                  Accept
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {failed.length > 0 && (
        <section>
          <h2>Failed ({failed.length})</h2>
          <ul className="list">
            {failed.map((e) => (
              <li key={e.id} className="row">
                <Link to={`/expenses/${e.id}`} className="row-main">
                  <div className="row-title"><strong>{e.file.originalFilename}</strong></div>
                  <div className="row-sub error">{e.error}</div>
                </Link>
                <button className="btn small" disabled={rescan.isPending} onClick={() => rescan.mutate(e.id)}>Retry</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
