import { useEffect, useState } from "react";
import AppShell from "../components/layout/AppShell";
import { fetchPersonas } from "../lib/api";
import type { ContentPersona } from "../lib/types";
import type { PageId } from "../App";

interface PersonasPageProps {
  onNavigate: (page: PageId) => void;
}

export default function PersonasPage({ onNavigate }: PersonasPageProps) {
  const [personas, setPersonas] = useState<ContentPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetchPersonas()
      .then(setPersonas)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell costUsd={null} runStatus="idle" activePage="personas" onNavigate={onNavigate}>
      <div className="fade-up" style={{ marginBottom: 24 }}>
        <h1 className="page-title">Personas</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
          Broker brand profiles used by the content pipeline. Each persona shapes
          how the same news event is written for a specific audience.
        </p>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-muted)", padding: 40, textAlign: "center" }}>
          Loading personas...
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 20 }}>
          {personas.map((p) => (
            <PersonaCard
              key={p.id}
              persona={p}
              isExpanded={expanded === p.id}
              onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────

interface PersonaCardProps {
  persona: ContentPersona;
  isExpanded: boolean;
  onToggle: () => void;
}

function PersonaCard({ persona, isExpanded, onToggle }: PersonaCardProps) {
  const p = persona;
  const hasBg = p.companyBackground && p.companyBackground.length > 0;

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        transition: "border-color 0.15s",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          background: "var(--bg-elevated)",
          borderBottom: "1px solid var(--border)",
          cursor: "pointer",
        }}
        onClick={onToggle}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-heading)", marginBottom: 4 }}>
              {p.name}
            </h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              <Tag>{p.regionalVariant}</Tag>
              <Tag>CTA: {p.ctaPolicy ?? "n/a"}</Tag>
              <Tag>{p.jurisdictions?.length ?? 0} jurisdictions</Tag>
            </div>
          </div>
          <span style={{ color: "var(--text-muted)", fontSize: 18, lineHeight: 1, userSelect: "none" }}>
            {isExpanded ? "−" : "+"}
          </span>
        </div>
      </div>

      {/* Brand voice — always visible */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
        <SectionLabel>Brand Voice</SectionLabel>
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, fontStyle: "italic" }}>
          {p.brandVoice}
        </p>
      </div>

      {/* Company background — always visible, highlighted if missing */}
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          background: hasBg ? "rgba(91, 141, 239, 0.03)" : "rgba(251, 191, 36, 0.05)",
        }}
      >
        <SectionLabel>
          Company Background
          {!hasBg && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 11,
                color: "var(--warning)",
                fontWeight: 500,
                fontStyle: "normal",
              }}
            >
              ⚠ Not configured — outputs will lack brand-specific facts
            </span>
          )}
        </SectionLabel>
        {hasBg ? (
          <ul style={{ paddingLeft: 16, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8, margin: 0 }}>
            {p.companyBackground!.map((fact, i) => (
              <li key={i}>{fact}</li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: 12, color: "var(--warning)", fontStyle: "italic", margin: 0 }}>
            No company background facts defined. The conformance pass cannot weave in brand-specific
            references (like founding year, team size, awards, or proprietary tools).
          </p>
        )}
      </div>

      {/* Personality tags — always visible */}
      <div style={{ padding: "12px 20px", borderBottom: isExpanded ? "1px solid var(--border)" : "none" }}>
        <SectionLabel>Personality Tags</SectionLabel>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {p.personalityTags.map((tag) => (
            <Tag key={tag} accent>{tag}</Tag>
          ))}
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <>
          {/* Audience profile */}
          <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
            <SectionLabel>Audience Profile</SectionLabel>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
              {p.audienceProfile || "Not defined"}
            </p>
          </div>

          {/* Brand positioning */}
          <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
            <SectionLabel>Brand Positioning</SectionLabel>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
              {p.brandPositioning || "Not defined"}
            </p>
          </div>

          {/* Preferred angles */}
          {p.preferredAngles && p.preferredAngles.length > 0 && (
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
              <SectionLabel>Preferred Angles</SectionLabel>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {p.preferredAngles.map((angle) => (
                  <Tag key={angle}>{angle}</Tag>
                ))}
              </div>
            </div>
          )}

          {/* Jurisdictions */}
          {p.jurisdictions && p.jurisdictions.length > 0 && (
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
              <SectionLabel>Jurisdictions</SectionLabel>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {p.jurisdictions.map((j) => (
                  <Tag key={j}>{j}</Tag>
                ))}
              </div>
            </div>
          )}

          {/* Forbidden claims */}
          {p.forbiddenClaims && p.forbiddenClaims.length > 0 && (
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
              <SectionLabel>Forbidden Claims</SectionLabel>
              <ul style={{ paddingLeft: 16, fontSize: 12, color: "var(--danger)", lineHeight: 1.7, margin: 0 }}>
                {p.forbiddenClaims.map((claim, i) => (
                  <li key={i}>{claim}</li>
                ))}
              </ul>
            </div>
          )}

          {/* CTA library */}
          {p.ctaLibrary && p.ctaLibrary.length > 0 && (
            <div style={{ padding: "12px 20px" }}>
              <SectionLabel>CTA Library</SectionLabel>
              <ul style={{ paddingLeft: 16, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7, margin: 0 }}>
                {p.ctaLibrary.map((cta, i) => (
                  <li key={i}>{cta}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--accent)",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 4,
        background: accent ? "rgba(91, 141, 239, 0.12)" : "rgba(91, 141, 239, 0.06)",
        border: `1px solid ${accent ? "rgba(91, 141, 239, 0.25)" : "rgba(91, 141, 239, 0.12)"}`,
        color: accent ? "var(--accent)" : "var(--text-muted)",
        fontWeight: accent ? 500 : 400,
      }}
    >
      {children}
    </span>
  );
}
