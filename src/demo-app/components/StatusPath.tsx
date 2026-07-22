import type { CSSProperties } from "react";

export type StatusPathStepState = "done" | "current" | "pending" | "issue";

export type StatusPathStep = {
  key: string;
  label: string;
  state: StatusPathStepState;
  detail?: string;
};

export default function StatusPath({
  steps,
  compact = false,
  className = "",
}: {
  steps: StatusPathStep[];
  compact?: boolean;
  className?: string;
}) {
  const activeIndex = steps.findIndex((step) => step.state === "current" || step.state === "issue");
  let fallbackIndex = 0;
  steps.forEach((step, index) => {
    if (step.state === "done") fallbackIndex = index;
  });
  const currentIndex = activeIndex >= 0 ? activeIndex : fallbackIndex;
  const progress = steps.length <= 1 ? 0 : (currentIndex / (steps.length - 1)) * 100;
  const minStepWidth = compact ? 72 : 92;

  return (
    <div
      className={`status-path${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}
      style={{
        "--status-path-count": steps.length,
        "--status-path-progress": `${progress}%`,
      } as CSSProperties}
      aria-label="Status"
    >
      <div className="status-path-rail" style={{ minWidth: `${steps.length * minStepWidth}px` }}>
        <div className="status-path-track"><span /></div>
        <ol className="status-path-list" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(${minStepWidth}px, 1fr))` }}>
          {steps.map((step) => (
            <li className={`status-path-step ${step.state}`} key={step.key} title={step.detail || step.label}>
              <span className="status-path-dot" />
              <strong>{step.label}</strong>
              {step.detail && !compact && <small>{step.detail}</small>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
