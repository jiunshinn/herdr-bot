import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Api } from "./api";
import { App } from "./App";
import { bridge } from "./bridge";
import "./styles.css";

const config = await bridge.config();
const api = new Api(config);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>,
);
