import path from "node:path";

export function assetPath(directory: string, pathname: string, paths = path) {
  const file = paths.join(
    directory,
    pathname === "/" ? "index.html" : pathname,
  );
  const relative = paths.relative(directory, file);
  const safe =
    relative !== ".." &&
    !relative.startsWith(".." + paths.sep) &&
    !paths.isAbsolute(relative);
  return safe ? file : null;
}
