"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Puck } from "@measured/puck";
import "@measured/puck/puck.css";
import { Button, Spinner, Form, Offcanvas } from "react-bootstrap";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  TbChevronLeft,
  TbSettings,
  TbEye,
  TbDeviceFloppy,
  TbRocket,
} from "react-icons/tb";
import puckConfig from "@lib/puck/config";
import { getComponentMeta } from "@lib/puck/componentMeta";
import { normalizePuckData } from "@lib/puck/normalizeData";
import useFetch from "../../../../hooks/useFetch";
import "../../../../(frontpages)/front.css";
import "@lib/puck/puck-layout.css";
import "@lib/puck/elementor-theme.css";

/* ------------------------------------------------------------------ *
 * Responsive preview breakpoints (Elementor-style device switcher)   *
 * ------------------------------------------------------------------ */
const VIEWPORTS = [
  { width: 1280, height: "auto", label: "Desktop", icon: "Monitor" },
  { width: 768, height: "auto", label: "Tablet", icon: "Tablet" },
  { width: 390, height: "auto", label: "Mobile", icon: "Smartphone" },
];

/* ------------------------------------------------------------------ *
 * Elementor-style widget tile for the left component drawer          *
 * ------------------------------------------------------------------ */
function WidgetTile({ name }) {
  const meta = getComponentMeta(name);
  const label = puckConfig.components?.[name]?.label || name;
  const Icon = meta.icon;
  return (
    <div className="epb-tile" title={meta.description || label}>
      <span className="epb-tile__icon">
        <Icon />
      </span>
      <span className="epb-tile__label">{label}</span>
      {meta.description && <span className="epb-tile__desc">{meta.description}</span>}
    </div>
  );
}

const puckOverrides = {
  drawerItem: ({ name }) => <WidgetTile name={name} />,
};

export default function PageEditor() {
  const params = useParams();
  const router = useRouter();
  const { fetchData } = useFetch();
  const [page, setPage] = useState(null);
  const [data, setData] = useState({ content: [], root: { props: {} } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ title: "", slug: "", meta: {} });

  const pageId = params.id;

  const loadPage = useCallback(async () => {
    try {
      const res = await fetchData(`/api/pages/${pageId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const pageData = await res.json();
      if (!res.ok) throw new Error(pageData.error || "Failed to load page");
      setPage(pageData);
      setData(normalizePuckData(pageData.content || { content: [], root: { props: {} } }));
      setSettings({
        title: pageData.title,
        slug: pageData.slug,
        meta: pageData.meta || {},
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [pageId, fetchData]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const savePage = async (content, status) => {
    setSaving(true);
    try {
      const res = await fetchData(`/api/pages/${pageId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ content, status: status || page?.status }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || "Save failed");
      setPage(updated);
      toast.success(status === "published" ? "Page published!" : "Draft saved.");
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async (content) => {
    const ok = await savePage(content, "published");
    if (!ok) return;
    await fetchData(`/api/pages/${pageId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
  };

  const saveSettings = async () => {
    try {
      const res = await fetchData(`/api/pages/${pageId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(settings),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || "Save failed");
      setPage(updated);
      setShowSettings(false);
      toast.success("Settings saved.");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const previewUrl = useMemo(
    () => (page?.slug === "home" ? "/" : `/${page?.slug}`),
    [page?.slug]
  );

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "60vh" }}>
        <Spinner animation="border" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center gap-3" style={{ minHeight: "60vh" }}>
        <p className="text-muted mb-0">Page not found.</p>
        <Button variant="outline-secondary" onClick={() => router.push("/admin/pages")}>
          Back to Pages
        </Button>
      </div>
    );
  }

  return (
    <div className="elementor-editor page-editor-shell">
      <ToastContainer position="bottom-right" autoClose={2500} theme="colored" hideProgressBar />

      {/* --- Top app bar --- */}
      <header className="epb-appbar">
        <button className="epb-appbar__back" title="Back to pages" onClick={() => router.push("/admin/pages")}>
          <TbChevronLeft size={20} />
        </button>
        <div className="epb-appbar__brand">
          <span className="epb-appbar__logo">
            <TbRocket size={16} />
          </span>
          <div>
            <div className="epb-appbar__title">{page.title}</div>
            <div className="epb-appbar__subtitle">
              /{page.slug === "home" ? "" : page.slug}
            </div>
          </div>
        </div>

        <div className="epb-appbar__spacer" />

        <span className={`epb-status epb-status--${page.status === "published" ? "published" : "draft"}`}>
          {page.status}
        </span>

        <button className="epb-btn epb-btn--ghost epb-btn--icon" title="Page settings" onClick={() => setShowSettings(true)}>
          <TbSettings size={18} />
        </button>

        <a
          className={`epb-btn epb-btn--ghost ${page.status !== "published" ? "disabled" : ""}`}
          href={page.status === "published" ? previewUrl : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={page.status !== "published"}
          onClick={(e) => {
            if (page.status !== "published") e.preventDefault();
          }}
          style={page.status !== "published" ? { opacity: 0.5, pointerEvents: "none" } : undefined}
        >
          <TbEye size={17} /> Preview
        </a>

        <button className="epb-btn epb-btn--ghost" disabled={saving} onClick={() => savePage(data, "draft")}>
          <TbDeviceFloppy size={17} /> {saving ? "Saving…" : "Save Draft"}
        </button>

        <button className="epb-btn epb-btn--primary" disabled={saving} onClick={() => handlePublish(data)}>
          <TbRocket size={17} /> Publish
        </button>
      </header>

      {/* --- Builder canvas --- */}
      <div className="epb-canvas-wrap">
        <Puck
          config={puckConfig}
          data={data}
          onChange={setData}
          onPublish={handlePublish}
          overrides={puckOverrides}
          viewports={VIEWPORTS}
          iframe={{ enabled: true }}
        />
      </div>

      {/* --- Page settings --- */}
      <Offcanvas show={showSettings} onHide={() => setShowSettings(false)} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>Page Settings</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <Form.Group className="mb-3">
            <Form.Label>Title</Form.Label>
            <Form.Control
              value={settings.title}
              onChange={(e) => setSettings({ ...settings, title: e.target.value })}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Slug</Form.Label>
            <Form.Control
              value={settings.slug}
              onChange={(e) => setSettings({ ...settings, slug: e.target.value })}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Meta Title</Form.Label>
            <Form.Control
              value={settings.meta?.title || ""}
              onChange={(e) =>
                setSettings({ ...settings, meta: { ...settings.meta, title: e.target.value } })
              }
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Meta Description</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={settings.meta?.description || ""}
              onChange={(e) =>
                setSettings({ ...settings, meta: { ...settings.meta, description: e.target.value } })
              }
            />
          </Form.Group>
          <Button variant="custom" onClick={saveSettings}>
            Save Settings
          </Button>
        </Offcanvas.Body>
      </Offcanvas>
    </div>
  );
}
