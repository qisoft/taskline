import { asError } from "../shared/errors.js";
import type { CliValues } from "./options.js";
export function createTransport(v: CliValues, base: string) {
  async function api<T = unknown>(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) {
    let response;
    try {
      response = await fetch(base + "/api" + path, {
        method,
        headers:
          body === undefined ? {} : { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(65000),
      });
    } catch (caught) {
      const error = asError(caught);
      throw Error(
        "Taskline is unavailable at " +
          base +
          ". Open Taskline or run taskline start. " +
          error.message,
      );
    }
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "HTTP " + response.status);
    return data as T;
  }
  const emit = (data: unknown) =>
    console.log(
      v.json
        ? JSON.stringify(data, null, 2)
        : Array.isArray(data)
          ? data.length
            ? data
                .map((item: unknown) => {
                  const row = item as {
                    code?: string;
                    id?: string;
                    mode?: string;
                    status?: string;
                    priority?: string;
                    blockingTaskIds?: string[];
                    title?: string;
                    name?: string;
                  };
                  return [
                    row.code || row.id,
                    row.status === "done"
                      ? "done"
                      : row.mode || row.status || "",
                    ...(row.priority
                      ? [
                          row.priority,
                          row.blockingTaskIds?.length
                            ? "blocked by " +
                              row
                                .blockingTaskIds!.map(
                                  (id) => "TL-" + id.slice(0, 4).toUpperCase(),
                                )
                                .join(",")
                            : "",
                        ]
                      : []),
                    row.title || row.name || "",
                  ].join("\t");
                })
                .join("\n")
            : "No items"
          : JSON.stringify(data, null, 2),
    );
  return { api, emit };
}
