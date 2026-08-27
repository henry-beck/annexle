import { useMemo, useRef, useState } from "react";

// Text input with autocomplete against the full guessable pool (countries.json,
// all 241 — not just puzzle targets). Calls onGuess(name) on selection.
// `used` is the set of already-guessed names, filtered out of suggestions.
export default function GuessInput({ countries, used, onGuess, disabled }) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return countries
      .filter((c) => c.name.toLowerCase().includes(q) && !used.has(c.name))
      .slice(0, 6);
  }, [input, countries, used]);

  function submit(name) {
    if (disabled) return;
    const c = countries.find((x) => x.name === name);
    if (!c) return;
    onGuess(name);
    setInput("");
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          value={input}
          disabled={disabled}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && suggestions[0]) submit(suggestions[0].name);
          }}
          placeholder="Guess a country"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#e2e8f0",
            fontSize: 16, // >=16px so iOS Safari doesn't auto-zoom the page on focus
            outline: "none",
          }}
        />
        <button
          onClick={() => suggestions[0] && submit(suggestions[0].name)}
          disabled={disabled || !suggestions[0]}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "none",
            background: suggestions[0] ? "#059669" : "#1e293b",
            color: "#f8fafc",
            fontSize: 14,
            cursor: suggestions[0] ? "pointer" : "default",
          }}
        >
          Guess
        </button>
      </div>
      {open && suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            zIndex: 5,
            marginTop: 4,
            width: "100%",
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {suggestions.map((s) => (
            <button
              key={s.name}
              onClick={() => submit(s.name)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                border: "none",
                background: "transparent",
                color: "#e2e8f0",
                fontSize: 14,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1e293b")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
