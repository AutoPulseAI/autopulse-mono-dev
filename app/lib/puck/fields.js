"use client";

import { useRef, useState } from "react";
import { Button, Form, Spinner } from "react-bootstrap";

export function ImageUploadField({ value, onChange, label = "Image" }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "pages");

      const token = localStorage.getItem("token");
      const res = await fetch("/api/upload/image", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Upload failed");
      }

      const url = data.images?.[0]?.url || data.url;
      if (url) onChange(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="mb-3">
      <Form.Label>{label}</Form.Label>
      {value && (
        <div className="mb-2">
          <img src={value} alt="Preview" style={{ maxWidth: "100%", maxHeight: 120, objectFit: "cover" }} />
        </div>
      )}
      <div className="d-flex gap-2">
        <Button
          variant="outline-secondary"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Spinner size="sm" animation="border" /> : "Upload Image"}
        </Button>
        {value && (
          <Button variant="outline-danger" size="sm" onClick={() => onChange("")}>
            Remove
          </Button>
        )}
      </div>
      <Form.Control
        ref={inputRef}
        type="file"
        accept="image/*"
        className="d-none"
        onChange={handleUpload}
      />
      <Form.Control
        type="text"
        size="sm"
        className="mt-2"
        placeholder="Or paste image URL"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <div className="text-danger small mt-1">{error}</div>}
    </div>
  );
}

export function RichTextField({ value, onChange, label = "Content" }) {
  const [mode, setMode] = useState("visual");
  const RichTextEditor = require("../../dealer/campaigns/components/RichTextEditor").default;

  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <Form.Label className="mb-0">{label}</Form.Label>
        <Button variant="link" size="sm" className="p-0" onClick={() => setMode(mode === "visual" ? "html" : "visual")}>
          {mode === "visual" ? "HTML source" : "Visual editor"}
        </Button>
      </div>
      {mode === "visual" ? (
        <RichTextEditor value={value || ""} onChange={onChange} />
      ) : (
        <Form.Control
          as="textarea"
          rows={12}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export function ColorField({ value, onChange, label = "Color" }) {
  return (
    <div className="mb-3">
      <Form.Label className="d-block small fw-semibold">{label}</Form.Label>
      <div className="d-flex gap-2 align-items-center">
        <input
          type="color"
          value={/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || "") ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 40, height: 34, border: "1px solid #e6e9ef", borderRadius: 6, padding: 2, background: "#fff", cursor: "pointer" }}
          aria-label={`${label} picker`}
        />
        <Form.Control
          size="sm"
          placeholder="#f7f8fb, transparent…"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        />
        {value ? (
          <Button variant="link" size="sm" className="p-0 text-muted text-nowrap" onClick={() => onChange("")}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AlignField({ value, onChange, label = "Alignment", options }) {
  const opts = options || [
    { value: "left", label: "Left" },
    { value: "center", label: "Center" },
    { value: "right", label: "Right" },
  ];
  return (
    <div className="mb-3">
      <Form.Label className="d-block small fw-semibold">{label}</Form.Label>
      <div className="epb-segment">
        {opts.map((o) => (
          <button
            key={o.value}
            type="button"
            className={value === o.value ? "is-active" : ""}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function createColorField(label = "Color") {
  return {
    type: "custom",
    render: ({ value, onChange }) => <ColorField value={value} onChange={onChange} label={label} />,
  };
}

export function createAlignField(label = "Alignment", options) {
  return {
    type: "custom",
    render: ({ value, onChange }) => (
      <AlignField value={value} onChange={onChange} label={label} options={options} />
    ),
  };
}

export function createImageField(label = "Image") {
  return {
    type: "custom",
    render: ({ value, onChange }) => (
      <ImageUploadField value={value} onChange={onChange} label={label} />
    ),
  };
}

export function createRichTextField(label = "Content") {
  return {
    type: "custom",
    render: ({ value, onChange }) => (
      <RichTextField value={value} onChange={onChange} label={label} />
    ),
  };
}
