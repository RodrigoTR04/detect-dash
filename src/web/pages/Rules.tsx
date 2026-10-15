import { useEffect, useState } from "react";
import { api, type Rule } from "../api";
import { useApi } from "../hooks/useApi";
import { Region, Severity } from "../components/common";
import { mitreUrl } from "../logic";
export function Rules() {
  const result = useApi<{ rules: Rule[] }>("/rules");
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (result.data) setRules(result.data.rules);
  }, [result.data]);
  async function toggle(rule: Rule) {
    setBusy((s) => new Set(s).add(rule.id));
    setErrors((s) => ({ ...s, [rule.id]: "" }));
    setRules((rows) =>
      rows.map((r) =>
        r.id === rule.id ? { ...r, enabled: !rule.enabled } : r,
      ),
    );
    try {
      await api(`/rules/${encodeURIComponent(rule.id)}`, undefined, {
        enabled: !rule.enabled,
      });
    } catch (e) {
      setRules((rows) => rows.map((r) => (r.id === rule.id ? rule : r)));
      setErrors((s) => ({
        ...s,
        [rule.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(rule.id);
        return next;
      });
    }
  }
  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h1>Rules</h1>
          <p className="subtitle">
            Detection logic running against incoming events.
          </p>
        </div>
      </div>
      <section className="panel">
        <Region {...result}>
          {rules.length ? (
            <div className="table-scroll">
              <table className="rules-table">
                <thead>
                  <tr>
                    {[
                      "Rule",
                      "Description",
                      "Kind",
                      "Severity",
                      "MITRE",
                      "Open / total",
                      "Enabled",
                    ].map((h) => (
                      <th scope="col" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.name}</th>
                      <td>{r.description}</td>
                      <td>{r.kind}</td>
                      <td>
                        <Severity value={r.severity} />
                      </td>
                      <td>
                        <a
                          href={mitreUrl(r.mitre)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.mitre}
                        </a>
                      </td>
                      <td className="numeric">
                        {r.alerts_open} / {r.alerts_total}
                      </td>
                      <td>
                        <button
                          className="switch"
                          role="switch"
                          aria-checked={r.enabled}
                          aria-label={`Enable ${r.name}`}
                          disabled={busy.has(r.id)}
                          onClick={() => toggle(r)}
                        >
                          <span />
                          {r.enabled ? "On" : "Off"}
                        </button>
                        {errors[r.id] && (
                          <div className="error" role="alert">
                            {errors[r.id]}{" "}
                            <button onClick={() => toggle(r)}>Retry</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="state">No rules available.</p>
          )}
        </Region>
      </section>
    </>
  );
}
