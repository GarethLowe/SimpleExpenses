import { useAuth } from "react-oidc-context";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { CapturePage } from "./pages/CapturePage";
import { ExpensePage } from "./pages/ExpensePage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { InboxPage } from "./pages/InboxPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  const auth = useAuth();

  if (auth.isLoading || auth.activeNavigator) {
    return <Centered>Signing in…</Centered>;
  }
  if (auth.error) {
    return (
      <Centered>
        <p className="error">Sign-in failed: {auth.error.message}</p>
        <button className="btn primary" onClick={() => void auth.signinRedirect()}>Try again</button>
      </Centered>
    );
  }
  if (!auth.isAuthenticated) {
    return (
      <Centered>
        <img src="/icons/icon.svg" alt="" width={72} height={72} />
        <h1>Simple Expenses</h1>
        <p>Snap receipts, let them be read for you, keep everything filed by month, company and type.</p>
        <button className="btn primary large" onClick={() => void auth.signinRedirect()}>Sign in</button>
      </Centered>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/inbox" replace />} />
        <Route path="/auth/callback" element={<Navigate to="/inbox" replace />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/capture" element={<CapturePage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/expenses/:id" element={<ExpensePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Route>
    </Routes>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="centered">
      <div className="centered-card">{children}</div>
    </div>
  );
}
