import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export class Store {
  constructor(directory) {
    this.directory = directory;
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
    ])
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL);`,
      );
  }
  list(table) {
    return this.db
      .prepare(`SELECT data FROM ${table}`)
      .all()
      .map((r) => JSON.parse(r.data));
  }
  get(table, id) {
    const r = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    return r ? JSON.parse(r.data) : null;
  }
  put(table, value) {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(value.id, JSON.stringify(value));
    return value;
  }
  update(table, id, patch) {
    const value = this.get(table, id);
    if (!value) throw Error("Not found: " + id);
    return this.put(table, {
      ...value,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }
  remove(table, id) {
    this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  settings(id = "app") {
    return this.get("settings", id) ?? { id };
  }
  event(taskId, type, detail) {
    return this.put("events", {
      id: randomUUID(),
      taskId,
      type,
      detail,
      createdAt: new Date().toISOString(),
    });
  }
  saveImage(base64, name = "Screenshot.png", mimeType = "image/png") {
    const bytes = Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64");
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw Error("Image must be between 1 byte and 20 MB");
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType))
      throw Error("Unsupported image type");
    return this.saveImageBytes(bytes, name, mimeType);
  }
  saveImageBytes(bytes, name, mimeType) {
    const id = randomUUID();
    writeFileSync(join(this.blobDirectory, id), bytes);
    return { id, name, mimeType, sizeBytes: bytes.length, url: "/blobs/" + id };
  }
  image(id) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw Error("Invalid attachment");
    return readFileSync(join(this.blobDirectory, id));
  }
  config() {
    const path = join(this.directory, "connection.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  }
  saveConfig(config) {
    const path = join(this.directory, "connection.json");
    writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  close() {
    this.db.close();
  }
}
