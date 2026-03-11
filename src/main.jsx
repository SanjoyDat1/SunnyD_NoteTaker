import React from "react";
import { createRoot } from "react-dom/client";
import SunnyDNotes from "../sunnyd.jsx";

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(err) {
    return { error: err };
  }
  componentDidCatch(err, info) {
    console.error("SunnyD render error:", err, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 24, fontFamily: "system-ui", maxWidth: 600,
          background: "#fff5f5", border: "1px solid #feb2b2", borderRadius: 8,
          margin: 24,
        }}>
          <h2 style={{ color: "#c53030", marginBottom: 12 }}>Something went wrong</h2>
          <pre style={{ overflow: "auto", fontSize: 12, color: "#742a2a" }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <p style={{ marginTop: 12, fontSize: 13, color: "#742a2a" }}>
            Check the browser console for details.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");
if (!root) {
  document.body.innerHTML = "<p>Root element not found. Check index.html.</p>";
} else {
  createRoot(root).render(
    <ErrorBoundary>
      <SunnyDNotes />
    </ErrorBoundary>
  );
}
