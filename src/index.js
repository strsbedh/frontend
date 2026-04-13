import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

const root = ReactDOM.createRoot(document.getElementById("root"));
// CRITICAL: StrictMode disabled to prevent double WebSocket connections
// StrictMode runs useEffect twice in dev mode, causing duplicate viewer instances
root.render(<App />);
