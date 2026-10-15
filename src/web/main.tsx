import { createRoot, type Root } from "react-dom/client";
import { App } from "./app";

const element = document.getElementById("root")!;
const root: Root = import.meta.hot
  ? (import.meta.hot.data.root ??= createRoot(element))
  : createRoot(element);
if (import.meta.hot) import.meta.hot.accept();
root.render(<App />);
