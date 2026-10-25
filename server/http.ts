import type { IncomingMessage, ServerResponse } from "node:http";
import type { Answers, Task } from "../shared/types.js";
import type { LabelChanges } from "../shared/labels.js";
import type { ProjectInput } from "./projects.js";
export interface ApiInput
  extends Partial<Omit<Task, "questions">>, ProjectInput {
  addLabels?: LabelChanges["addLabels"];
  removeLabels?: LabelChanges["removeLabels"];
  origin: string;
  token: string;
  base64: string;
  name: string;
  mimeType: string;
  context?: string;
  acceptanceCriteria?: string;
  contextVersion?: number;
  decisions?: string[];
  requestId: string;
  answers: Answers;
  decision: string;
  blockerIds?: string[];
}
export const respond = (res: ServerResponse, value: unknown, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
export async function body(req: IncomingMessage): Promise<ApiInput> {
  let chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 30 * 1024 * 1024) throw Error("Request too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString();
  return JSON.parse(text || "{}");
}
