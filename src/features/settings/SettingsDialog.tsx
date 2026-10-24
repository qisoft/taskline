import { useEffect, useState } from "react";
import { asError } from "../../../shared/errors.js";
import type { AppState, DesktopInfo } from "../../../shared/types.js";
import { Modal } from "../../components/Modal.js";
import { api } from "../../lib/api.js";

export function SettingsDialog({
  state,
  onClose,
  onRefresh,
  onError,
}: {
  state: AppState;
  onClose: () => void;
  onRefresh: () => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const [desktop, setDesktop] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    window.taskline?.desktopInfo().then(setDesktop);
  }, []);
  const [origin, setOrigin] = useState(state.connection.origin || "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(state.settings);
  const [autoOverrides, setAutoOverrides] = useState<
    Record<string, boolean | undefined>
  >({});
  async function connect(local: boolean) {
    setBusy(true);
    try {
      await api(
        local ? "/connect/local" : "/connect",
        local ? {} : { origin, token },
      );
      await onRefresh();
      setToken("");
    } catch (caught) {
      const e = asError(caught);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Settings" onClose={onClose} className="settings-modal">
      <div className="form-body">
        <h3>T3 Code connection</h3>
        <p className="muted small">
          Projects and threads are synced from your T3 environment.
        </p>
        <div className="row">
          <span
            className={
              "connection-dot " +
              (state.connection.connected ? "connected" : "")
            }
          />
          {state.connection.connected ? "Connected" : "Disconnected"}
          <button
            className="button"
            disabled={busy}
            onClick={() => connect(true)}
          >
            Connect local T3
          </button>
        </div>
        <label>
          Server address
          <input
            aria-label="T3 server address"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="http://127.0.0.1:3773"
          />
        </label>
        <label>
          Scoped T3 access token
          <input
            type="password"
            aria-label="T3 access token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter a token for another environment"
          />
        </label>
        <button
          className="button"
          disabled={busy || !origin || !token}
          onClick={() => connect(false)}
        >
          Connect environment
        </button>
        <hr />
        {desktop && (desktop.cliPath || desktop.cliError) && (
          <section aria-label="CLI installation">
            <h3>CLI command</h3>
            {desktop.cliError ? (
              <p className="error">{desktop.cliError}</p>
            ) : (
              <p className="muted small">
                <code>taskline</code> is installed. Open a new terminal to use
                it.
              </p>
            )}
          </section>
        )}
        <h3>Desktop and global shortcuts</h3>
        {desktop && (
          <div className="row small">
            <span>
              Screen recording:{" "}
              {desktop.screenRecording === "granted"
                ? "allowed"
                : "permission needed"}
            </span>
            {desktop.screenRecording !== "granted" && (
              <button
                className="button"
                onClick={() => window.taskline?.openScreenPermissions()}
              >
                Enable screen recording
              </button>
            )}
          </div>
        )}
        <label>
          Board shortcut
          <input
            aria-label="Board shortcut"
            value={settings.boardShortcut ?? "CommandOrControl+Shift+0"}
            onChange={(e) =>
              setSettings({ ...settings, boardShortcut: e.target.value })
            }
          />
        </label>
        {desktop?.boardRegistered === false && (
          <p className="muted small">
            Board shortcut is unavailable. Choose another combination.
          </p>
        )}
        <label>
          Text shortcut
          <input
            aria-label="Text shortcut"
            value={settings.textShortcut}
            onChange={(e) =>
              setSettings({ ...settings, textShortcut: e.target.value })
            }
          />
        </label>
        <label>
          Screenshot shortcut
          <input
            aria-label="Screenshot shortcut"
            value={settings.screenshotShortcut}
            onChange={(e) =>
              setSettings({ ...settings, screenshotShortcut: e.target.value })
            }
          />
        </label>
        {desktop?.platform === "darwin" && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.showInDock !== false}
              onChange={(e) =>
                setSettings({ ...settings, showInDock: e.target.checked })
              }
            />
            Always show Taskline in the Dock
          </label>
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) =>
              setSettings({ ...settings, launchAtLogin: e.target.checked })
            }
          />
          Start at login
        </label>
        <p className="muted small">
          Text entry accepts system dictation and your existing voice typing
          tool.
        </p>
        <hr />
        <h3>Project execution</h3>
        <p className="muted small">
          Project state controls tasks without an epic and the default for new
          epics. Existing epics keep their own state.
        </p>
        {state.projects.map((p) => {
          const policy = state.projectSettings.find(
            (s) => s.id === "project:" + p.id || s.id === p.id,
          );
          return (
            <div className="project-setting" key={p.id}>
              <span>{p.title}</span>
              <label className="small">
                Base
                <input
                  aria-label={"Base branch for " + p.title}
                  defaultValue={policy?.baseRef ?? "main"}
                  onBlur={async (e) => {
                    if (e.target.value.trim())
                      try {
                        await api(
                          "/projects/" + encodeURIComponent(p.id),
                          { baseRef: e.target.value.trim() },
                          "PATCH",
                        );
                        onRefresh();
                      } catch (caught) {
                        const e = asError(caught);
                        onError(e);
                      }
                  }}
                />
              </label>
              <label className="small">
                Parallel
                <input
                  type="number"
                  min="1"
                  max="16"
                  aria-label={"Parallel tasks for " + p.title}
                  defaultValue={policy?.concurrencyLimit ?? 2}
                  onBlur={async (e) => {
                    try {
                      await api(
                        "/projects/" + encodeURIComponent(p.id),
                        { concurrencyLimit: Number(e.target.value) },
                        "PATCH",
                      );
                      onRefresh();
                    } catch (caught) {
                      const e = asError(caught);
                      onError(e);
                    }
                  }}
                />
              </label>
              <label className="checkbox small">
                <input
                  type="checkbox"
                  aria-label={"Active project " + p.title}
                  checked={autoOverrides[p.id] ?? policy?.autoStart !== false}
                  disabled={autoOverrides[p.id] !== undefined}
                  onChange={async (e) => {
                    const autoStart = e.target.checked;
                    setAutoOverrides((current) => ({
                      ...current,
                      [p.id]: autoStart,
                    }));
                    try {
                      await api(
                        "/projects/" + encodeURIComponent(p.id),
                        { autoStart },
                        "PATCH",
                      );
                      await onRefresh();
                    } catch (caught) {
                      const e = asError(caught);
                      onError(e);
                    } finally {
                      setAutoOverrides((current) => ({
                        ...current,
                        [p.id]: undefined,
                      }));
                    }
                  }}
                />
                {(autoOverrides[p.id] ?? policy?.autoStart !== false)
                  ? "Active"
                  : "Paused"}
              </label>
            </div>
          );
        })}
        <p className="muted small">
          Local SQLite database
          <br />
          <code>{state.dataDir}</code>
        </p>
      </div>
      <footer>
        <button
          className="primary-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (window.taskline) await window.taskline.configure(settings);
              try {
                await api("/settings", settings, "PATCH");
              } catch (caught) {
                const e = asError(caught);
                if (window.taskline)
                  await window.taskline.configure(state.settings);
                throw e;
              }
              onRefresh();
              onClose();
            } catch (caught) {
              const e = asError(caught);
              onError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save settings
        </button>
      </footer>
    </Modal>
  );
}
