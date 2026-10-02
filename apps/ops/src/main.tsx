import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { PrelaunchWorkspace } from "./PrelaunchWorkspace.js";
import { prelaunchEnabled } from "./prelaunch-api.js";
import { ControlledIdentityWorkspace } from "./ControlledIdentityWorkspace.js";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element for ops app");
}

const showPrelaunch = prelaunchEnabled && new URLSearchParams(window.location.search).get("workspace") === "prelaunch";
const showControlled = new URLSearchParams(window.location.search).get("workspace") === "controlled";
createRoot(rootElement).render(showControlled ? <ControlledIdentityWorkspace /> : showPrelaunch ? <PrelaunchWorkspace /> : <App />);
