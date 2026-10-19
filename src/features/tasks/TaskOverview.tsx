import { ArrowUpRight, Check, Circle, CircleHelp, Send, X } from "lucide-react";
import type React from "react";
import type { Task } from "../../../shared/types.js";
import { ImagePreview } from "../images/ImageViewer.js";
import { ValidationImages } from "./ValidationImages.js";

export function TaskOverview({
  task,
  busy,
  answers,
  setAnswers,
  revision,
  setRevision,
  action,
}: {
  task: Task;
  busy: boolean;
  answers: Record<string, string>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  revision: string;
  setRevision: React.Dispatch<React.SetStateAction<string>>;
  action: (name: string, data?: unknown) => Promise<void>;
}) {
  const report = task.report;
  return (
    <>
      <section className="detail-section">
        <h3>Original prompt</h3>
        <p className="preserve-text">{task.originalPrompt || task.prompt}</p>
        {task.attachments?.map((a) => (
          <ImagePreview key={a.id} image={a} className="detail-image" />
        ))}
      </section>
      {task.questions?.length > 0 && (
        <section className="detail-section question-section">
          <h3>
            <CircleHelp size={15} /> T3 needs your input
          </h3>
          {task.questions.map((q) => (
            <div key={q.requestId}>
              {q.type === "approval_request" ? (
                <>
                  <p>{q.prompt || "Permission requested by the agent"}</p>
                  <div className="row">
                    <button
                      className="primary-button"
                      onClick={() =>
                        action("approve", {
                          requestId: q.requestId,
                          decision: "accept",
                        })
                      }
                    >
                      Allow once
                    </button>
                    <button
                      className="button"
                      onClick={() =>
                        action("approve", {
                          requestId: q.requestId,
                          decision: "decline",
                        })
                      }
                    >
                      Decline
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {q.questions.map((question) => (
                    <div className="question-field" key={question.id}>
                      <label>{question.question}</label>
                      {(question.options?.length ?? 0) > 0 && (
                        <select
                          aria-label={question.header || question.question}
                          value={answers[question.id] || ""}
                          onChange={(e) =>
                            setAnswers({
                              ...answers,
                              [question.id]: e.target.value,
                            })
                          }
                        >
                          <option value="">Choose…</option>
                          {question.options?.map((o) => (
                            <option key={o.label} value={o.value ?? o.label}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        placeholder="Your answer…"
                        value={answers[question.id] || ""}
                        onChange={(e) =>
                          setAnswers({
                            ...answers,
                            [question.id]: e.target.value,
                          })
                        }
                      />
                    </div>
                  ))}
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      q.questions.some(
                        (question) =>
                          question.required !== false &&
                          !answers[question.id]?.length,
                      )
                    }
                    onClick={() =>
                      action("answer", {
                        requestId: q.requestId,
                        answers: Object.fromEntries(
                          q.questions.map((question) => [
                            question.id,
                            answers[question.id] || "",
                          ]),
                        ),
                      })
                    }
                  >
                    Send answer to T3 <Send size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </section>
      )}
      {task.error && <div className="error">{task.error}</div>}
      {report && (
        <>
          <section className="detail-section">
            <h3>
              Result{" "}
              <span className="small muted">
                {task.reportState === "pending"
                  ? "Summarizing…"
                  : task.reportState === "error"
                    ? "Summary needs retry"
                    : "GPT-6 Luna"}
              </span>
            </h3>
            <p className="preserve-text">{report.summary}</p>
            {report.changes?.length > 0 && (
              <ul>
                {report.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
            {task.reportError && (
              <details>
                <summary className="attention">Summary error</summary>
                <p className="small">{task.reportError}</p>
              </details>
            )}
            <button className="text-button" onClick={() => action("report")}>
              Regenerate report
            </button>
          </section>
          {report.questions?.length > 0 && (
            <section className="detail-section">
              <h3>Questions for you</h3>
              {report.questions.map((q, i) => (
                <div className="report-question" key={i}>
                  <p>{q.text}</p>
                  <span className="small muted">
                    {q.scope === "group" ? "Epic decision" : "Task decision"} ·{" "}
                    {q.blocking ? "Blocking" : "Follow-up"}
                  </span>
                </div>
              ))}
            </section>
          )}
          <section className="detail-section">
            <h3>How it was tested</h3>
            {report.validation?.map((v, i) => (
              <div className="validation-row" key={i}>
                <span className={"validation-indicator " + v.outcome}>
                  {v.outcome === "passed" ? (
                    <Check size={13} />
                  ) : v.outcome === "failed" ? (
                    <X size={13} />
                  ) : (
                    <Circle size={12} />
                  )}
                </span>
                <div>
                  <strong>{v.label}</strong>
                  {v.command && <code>{v.command}</code>}
                  <span className="small muted">
                    {v.outcome.replaceAll("_", " ")} ·{" "}
                    {v.basis === "observed_output"
                      ? "Execution evidence"
                      : v.basis === "agent_reported"
                        ? "Reported by agent"
                        : "No evidence"}
                    {v.sourceRefs?.length > 0
                      ? " · " + v.sourceRefs.length + " sources"
                      : ""}
                  </span>
                </div>
              </div>
            ))}
            <ValidationImages record={task} />
          </section>
          {report.remainingWork?.length > 0 && (
            <section className="detail-section">
              <h3>Remaining work</h3>
              <ul>
                {report.remainingWork.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {["review", "failed", "done", "cancelled"].includes(task.status) && (
        <section className="detail-section">
          <h3>Request changes</h3>
          <textarea
            aria-label="Revision prompt"
            placeholder="Describe the follow-up or answer remaining questions…"
            value={revision}
            onChange={(e) => setRevision(e.target.value)}
          />
          <button
            className="button"
            disabled={!revision.trim() || busy}
            onClick={() => action("revision", { prompt: revision })}
          >
            Queue follow-up in this thread <ArrowUpRight size={14} />
          </button>
        </section>
      )}
    </>
  );
}
