import "@fontsource-variable/inter";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { ImageViewerProvider } from "./features/images/ImageViewer.js";
import "./style.css";

if (window.taskline) document.body.classList.add("desktop");

createRoot(document.getElementById("root")!).render(
  <ImageViewerProvider>
    <App />
  </ImageViewerProvider>,
);
