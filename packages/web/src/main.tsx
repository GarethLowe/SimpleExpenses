import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { AppProviders } from "./auth";
import { loadConfig } from "./config";
import "./styles.css";

registerSW({ immediate: true });

const root = createRoot(document.getElementById("root")!);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // One retry with a delay covers a cold-start blip without hammering the API on real errors.
      retry: 1,
      retryDelay: 2000,
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    },
  },
});

loadConfig()
  .then((config) => {
    root.render(
      <StrictMode>
        <AppProviders config={config}>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </QueryClientProvider>
        </AppProviders>
      </StrictMode>,
    );
  })
  .catch((err: unknown) => {
    root.render(
      <div className="page">
        <h1>Simple Expenses</h1>
        <p className="error">{err instanceof Error ? err.message : String(err)}</p>
      </div>,
    );
  });
