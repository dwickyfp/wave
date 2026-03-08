import { createRoot } from "react-dom/client";
import { EmmaPilotApp } from "./sidepanel-app";
import "./sidepanel.css";

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(<EmmaPilotApp />);
}
