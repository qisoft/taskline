import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const limit = 20 * 1024 * 1024;
const imageExtension = /\.(?:png|jpe?g|webp|gif|avif|bmp)(?:[?#].*)?$/i;
export function imageMime(bytes) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (/^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    /avif|avis/.test(bytes.toString("ascii", 8, 32))
  )
    return "image/avif";
  if (bytes.toString("ascii", 0, 2) === "BM") return "image/bmp";
  return null;
}
export function imageReferences(evidence) {
  const refs = new Map();
  for (const item of evidence) {
    if (
      ![
        "assistant",
        "assistant_message",
        "command_execution",
        "tool_result",
        "file_change",
      ].includes(item.type)
    )
      continue;
    const add = (value, explicit = false) => {
      const ref = value
        .trim()
        .replace(/^<|>$/g, "")
        .replace(/[.,;]$/, "");
      if (!ref || (!explicit && !imageExtension.test(ref))) return;
      if (!refs.has(ref)) refs.set(ref, { reference: ref, evidenceIds: [] });
      const ids = refs.get(ref).evidenceIds;
      if (!ids.includes(item.id)) ids.push(item.id);
    };
    const text = typeof item.text === "string" ? item.text : "";
    const spans = [];
    const mark = (match) =>
      spans.push([match.index, match.index + match[0].length]);
    for (const match of text.matchAll(
      /(!?)\[([^\]]*)\]\(\s*(<[^>]+>|[^\n]+?)\s*\)/g,
    )) {
      mark(match);
      add(
        match[3].replace(/\s+["'][^"']*["']$/, ""),
        match[1] === "!" || /screenshot|screen capture|скрин/i.test(match[2]),
      );
    }
    for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      mark(match);
      add(match[1], true);
    }
    for (const match of text.matchAll(/`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'/g)) {
      mark(match);
      add(match[1] ?? match[2] ?? match[3]);
    }
    for (const match of text.matchAll(
      /(?:https?:\/\/|file:\/\/)[^\s<>"'`]+|\/(?:[^\s<>"'`()]+\/)*[^\s<>"'`()]+\.(?:png|jpe?g|webp|gif|avif|bmp)\b/gi,
    ))
      if (!spans.some(([a, b]) => match.index >= a && match.index < b))
        add(match[0].replace(/\)$/, ""));
    for (const change of item.payload?.changes ?? [])
      if (change.path) add(change.path);
  }
  return [...refs.values()].slice(0, 32);
}
async function download(reference, config) {
  let url = new URL(reference, config.origin);
  const signal = AbortSignal.timeout(10000);
  for (let redirects = 0; redirects < 5; redirects++) {
    if (!["http:", "https:"].includes(url.protocol))
      throw Error("Unsupported image URL");
    const headers = {};
    if (
      config.origin &&
      url.origin === new URL(config.origin).origin &&
      config.token
    ) {
      headers.Authorization = "Bearer " + config.token;
      headers["x-t3-orchestration-protocol"] = "2";
    }
    const response = await fetch(url, { headers, redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get("location"), url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Error("Image request returned HTTP " + response.status);
    }
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      throw Error("Image exceeds 20 MB");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw Error("Image exceeds 20 MB");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw Error("Too many image redirects");
}
export async function collectValidationImages(store, attempt, config = {}) {
  const images = new Map(),
    issues = [];
  const refs = imageReferences(attempt.evidence ?? []);
  for (let start = 0; start < refs.length; start += 4) {
    const results = await Promise.all(
      refs.slice(start, start + 4).map(async (source) => {
        try {
          const ref = source.reference;
          const remote = /^https?:\/\//i.test(ref) || /^\/api\//.test(ref);
          let path = remote
            ? null
            : ref.startsWith("file:")
              ? fileURLToPath(ref)
              : resolve(attempt.workspace || ".", ref);
          let bytes;
          if (remote) bytes = await download(ref, config);
          else {
            try {
              bytes = await readFile(path);
            } catch (error) {
              if (
                error.code !== "ENOENT" ||
                !/%[0-9a-f]{2}/i.test(ref) ||
                ref.startsWith("file:")
              )
                throw error;
              path = resolve(attempt.workspace || ".", decodeURIComponent(ref));
              bytes = await readFile(path);
            }
          }
          const mimeType = imageMime(bytes);
          if (!bytes.length || bytes.length > limit)
            throw Error("Image must be between 1 byte and 20 MB");
          if (!mimeType)
            throw Error("The reference did not contain a supported image");
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          return {
            bytes,
            mimeType,
            sha256,
            name: basename(
              remote ? new URL(ref, config.origin).pathname : path,
            ),
            source: { ...source, kind: remote ? "url" : "file" },
          };
        } catch (error) {
          if (
            error.code === "ENOENT" &&
            source.reference === basename(source.reference) &&
            attempt.attachments?.some((a) => a.name === source.reference)
          )
            return { skipped: true };
          return { issue: { ...source, message: error.message } };
        }
      }),
    );
    for (const result of results) {
      if (result.skipped) continue;
      if (result.issue) {
        issues.push(result.issue);
        continue;
      }
      const existing = images.get(result.sha256);
      if (existing) existing.sources.push(result.source);
      else
        images.set(result.sha256, {
          ...store.saveImageBytes(result.bytes, result.name, result.mimeType),
          sha256: result.sha256,
          sources: [result.source],
        });
    }
  }
  return {
    validationImages: [...images.values()],
    validationImageIssues: issues,
    validationArtifactsCollectedAt: new Date().toISOString(),
  };
}
