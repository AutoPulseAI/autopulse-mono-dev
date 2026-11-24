"use client";
// The Desk Log's stage and outcome menus (24 Nov 2026: the browser's own list painted every option in full colour -
// hard on the eyes and hard to read). The button keeps its colour, as in the design; the list is white, each option
// with a small colour dot and dark text, a tick on the current one and a soft highlight on hover. Keyboard: arrows +
// Enter (react-bootstrap Dropdown).
import { Dropdown } from "react-bootstrap";

export default function ColorPick({ value, options, onPick, style, dark, disabled, label, empty, title }) {
  const current = options.find((o) => o.value === value);
  return (
    <Dropdown className="dl_cpick" onSelect={(v) => { if (v !== value) onPick(v); }}>
      <Dropdown.Toggle size="sm" disabled={disabled} className={`dl_cpick_btn${dark ? " dark" : ""}`} style={style}
        aria-label={label} title={title || current?.label || empty}>
        <span className="dl_cpick_text">{current?.label || empty}</span>
      </Dropdown.Toggle>
      <Dropdown.Menu className="dl_cpick_menu" popperConfig={{ strategy: "fixed" }} renderOnMount>
        {options.map((o) => (
          <Dropdown.Item key={o.value} eventKey={o.value} active={false} className={o.value === value ? "on" : ""}>
            <span className="dl_cpick_dot" style={{ background: o.dot || "transparent", borderColor: o.dot ? o.dot : "#adb5bd" }} />
            <span className="flex-grow-1">{o.label}</span>
            {o.value === value && <i className="fa-solid fa-check" aria-hidden="true" />}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}
