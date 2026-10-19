import type { Rectangle } from "../shared/types.js";

let start: { x: number; y: number } | null = null;
let rectangle: Rectangle | null = null;
const box = document.getElementById("selection")!;
window
  .taskline!.regionImage()
  .then(
    (image) =>
      ((document.getElementById("screen") as HTMLImageElement).src =
        image ?? ""),
  );
document.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  document.getElementById("hint")!.hidden = true;
});
document.addEventListener("mousemove", (e) => {
  if (!start) return;
  rectangle = {
    x: Math.min(start.x, e.clientX),
    y: Math.min(start.y, e.clientY),
    width: Math.abs(e.clientX - start.x),
    height: Math.abs(e.clientY - start.y),
  };
  Object.assign(box.style, {
    display: "block",
    left: rectangle.x + "px",
    top: rectangle.y + "px",
    width: rectangle.width + "px",
    height: rectangle.height + "px",
  });
});
document.addEventListener("mouseup", () => {
  if (rectangle && rectangle.width > 8 && rectangle.height > 8)
    window.taskline!.finishRegion(rectangle);
  else window.taskline!.cancelRegion();
});
