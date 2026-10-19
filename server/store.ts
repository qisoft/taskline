import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { asError } from "../shared/errors.js";
import type {
  ConnectionConfig,
  ImageAttachment,
  StoreTables,
} from "../shared/types.js";

export class Store {
  blobDirectory: string;
  db: DatabaseSync;
  constructor(public directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.blobDirectory = join(directory, "blobs");
    mkdirSync(this.blobDirectory, { recursive: true });
    this.db = new DatabaseSync(join(directory, "taskline.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    for (const table of [
      "tasks",
      "attempts",
      "groups",
      "settings",
      "events",
      "jobs",
      "threadTargets",
    ])
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL);`,
      );
    const projectsByGroup = new Map<string, Set<string>>();
    for (const task of this.list("tasks")) {
      if (!task.groupId || !task.projectId) continue;
      if (!projectsByGroup.has(task.groupId))
        projectsByGroup.set(task.groupId, new Set());
      projectsByGroup.get(task.groupId)!.add(task.projectId);
    }
    this.transaction(() => {
      for (const group of this.list("groups")) {
        const projects = projectsByGroup.get(group.id);
        if (!group.projectId && projects?.size === 1)
          this.put("groups", { ...group, projectId: [...projects][0] });
      }
    });
  }
  list<K extends keyof StoreTables>(table: K): StoreTables[K][] {
    return this.db
      .prepare(`SELECT data FROM ${table}`)
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
  get<K extends keyof StoreTables>(
    table: K,
    id: string | null | undefined,
  ): StoreTables[K] | null {
    if (!id) return null;
    const r = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    return r ? JSON.parse(r.data as string) : null;
  }
  require<K extends keyof StoreTables>(
    table: K,
    id: string | null | undefined,
  ): StoreTables[K] {
    const value = this.get(table, id);
    if (!value) throw Error("Not found: " + id);
    return value;
  }
  put<K extends keyof StoreTables>(
    table: K,
    value: StoreTables[K],
  ): StoreTables[K] {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(value.id, JSON.stringify(value));
    return value;
  }
  update<K extends keyof StoreTables>(
    table: K,
    id: string,
    patch: Partial<StoreTables[K]>,
  ): StoreTables[K] {
    const value = this.get(table, id);
    if (!value) throw Error("Not found: " + id);
    return this.put(table, {
      ...value,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }
  remove(table: keyof StoreTables, id: string) {
    this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (caught) {
      const e = asError(caught);
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  settings(id = "app") {
    return this.get("settings", id) ?? { id };
  }
  event(taskId: string, type: string, detail: unknown) {
    return this.put("events", {
      id: randomUUID(),
      taskId,
      type,
      detail,
      createdAt: new Date().toISOString(),
    });
  }
  saveImage(base64: string, name = "Screenshot.png", mimeType = "image/png") {
    const bytes = Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64");
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw Error("Image must be between 1 byte and 20 MB");
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType))
      throw Error("Unsupported image type");
    return this.saveImageBytes(bytes, name, mimeType);
  }
  saveImageBytes(
    bytes: Buffer,
    name: string,
    mimeType: string,
  ): ImageAttachment {
    const id = randomUUID();
    writeFileSync(join(this.blobDirectory, id), bytes);
    return { id, name, mimeType, sizeBytes: bytes.length, url: "/blobs/" + id };
  }
  image(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw Error("Invalid attachment");
    return readFileSync(join(this.blobDirectory, id));
  }
  config(): ConnectionConfig {
    const path = join(this.directory, "connection.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  }
  saveConfig(config: ConnectionConfig) {
    const path = join(this.directory, "connection.json");
    writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  close() {
    this.db.close();
  }
}
