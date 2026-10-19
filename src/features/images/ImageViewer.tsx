import { X, ZoomIn, ZoomOut } from "lucide-react";
import type React from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ImageAttachment } from "../../../shared/types.js";

const ImageViewerContext = createContext<
  ((image: ImageAttachment) => void) | null
>(null);
export function ImageViewerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [image, setImage] = useState<ImageAttachment | null>(null);
  const [actualSize, setActualSize] = useState(false);
  const viewer = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!image) return;
    const previousFocus = document.activeElement;
    const root = document.getElementById("root")!;
    const wasInert = root.inert;
    root.inert = true;
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setImage(null);
      }
      if (event.key === "Tab") {
        const buttons = [...viewer.current!.querySelectorAll("button")];
        const index = buttons.findIndex(
          (button) => button === document.activeElement,
        );
        event.preventDefault();
        buttons[
          (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
        ].focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      root.inert = wasInert;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [image]);
  return (
    <ImageViewerContext.Provider
      value={(image) => {
        setActualSize(false);
        setImage(image);
      }}
    >
      {children}
      {image &&
        createPortal(
          <div
            className="image-viewer-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setImage(null);
            }}
          >
            <section
              ref={viewer}
              role="dialog"
              aria-modal="true"
              aria-label="Image viewer"
              className="image-viewer"
              onKeyDown={(e) => e.stopPropagation()}
            >
              <header>
                <strong>{image.name || "Screenshot"}</strong>
                <div className="row">
                  <button
                    className="button"
                    aria-label={
                      actualSize
                        ? "Fit image to window"
                        : "View image at actual size"
                    }
                    onClick={() => setActualSize(!actualSize)}
                  >
                    {actualSize ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
                    {actualSize ? "Fit" : "100%"}
                  </button>
                  <button
                    ref={closeButton}
                    className="icon-button"
                    aria-label="Close image viewer"
                    onClick={() => setImage(null)}
                  >
                    <X size={20} />
                  </button>
                </div>
              </header>
              <div
                className={
                  "image-viewer-stage" + (actualSize ? " actual-size" : "")
                }
              >
                <img src={image.url} alt={image.name || "Screenshot"} />
              </div>
            </section>
          </div>,
          document.body,
        )}
    </ImageViewerContext.Provider>
  );
}
export function ImagePreview({
  image,
  className,
  lazy = false,
  alt,
}: {
  image: ImageAttachment;
  className?: string;
  lazy?: boolean;
  alt?: string;
}) {
  const openImage = useContext(ImageViewerContext);
  return (
    <button
      type="button"
      className="image-preview-button"
      aria-label={"View image: " + (image.name || "Screenshot")}
      onClick={(event) => {
        event.stopPropagation();
        openImage?.(image);
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <img
        className={className}
        loading={lazy ? "lazy" : undefined}
        src={image.url}
        alt={alt || image.name}
      />
    </button>
  );
}
