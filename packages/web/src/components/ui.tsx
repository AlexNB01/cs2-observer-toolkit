import type { ReactNode } from "react";

export function Card(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card-header">
        <h2>{props.title}</h2>
        {props.description && <p className="card-description">{props.description}</p>}
      </header>
      <div className="card-body">{props.children}</div>
    </section>
  );
}

export function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="row">
      <span className="row-label">
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </span>
      <span className="row-control">{props.children}</span>
    </label>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <input
      type="checkbox"
      className="toggle"
      checked={props.checked}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.checked)}
    />
  );
}

export function ComingSoon(props: { section: string; bullets: string[] }) {
  return (
    <div className="coming-soon">
      <p>
        Not built yet — placeholder for spec section <strong>{props.section}</strong>. Planned controls:
      </p>
      <ul>
        {props.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

export function StatusBadge(props: { ok: boolean; okLabel: string; badLabel: string }) {
  return <span className={`status-badge ${props.ok ? "ok" : "bad"}`}>{props.ok ? props.okLabel : props.badLabel}</span>;
}
