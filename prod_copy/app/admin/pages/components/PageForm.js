"use client";

import { useState, useEffect } from "react";
import { Form, Button, Row, Col } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export default function PageForm({ page, onSaved, onCancel }) {
  const { fetchData, loading } = useFetch();
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    title: "",
    slug: "",
    status: "draft",
    showInNav: false,
    navOrder: 0,
    navLabel: "",
    pageType: "marketing",
    meta: { title: "", description: "", ogImage: "" },
  });

  useEffect(() => {
    if (page) {
      setForm({
        title: page.title || "",
        slug: page.slug || "",
        status: page.status || "draft",
        showInNav: page.showInNav || false,
        navOrder: page.navOrder || 0,
        navLabel: page.navLabel || "",
        pageType: page.pageType || "marketing",
        meta: {
          title: page.meta?.title || "",
          description: page.meta?.description || "",
          ogImage: page.meta?.ogImage || "",
        },
      });
    }
  }, [page]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name.startsWith("meta.")) {
      const key = name.split(".")[1];
      setForm((prev) => ({
        ...prev,
        meta: { ...prev.meta, [key]: value },
      }));
    } else {
      setForm((prev) => {
        const next = { ...prev, [name]: type === "checkbox" ? checked : value };
        if (name === "title" && !page) {
          next.slug = slugify(value);
        }
        return next;
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    try {
      const payload = {
        ...form,
        navLabel: form.navLabel || form.title,
      };

      const url = page ? `/api/pages/${page._id}` : "/api/pages";
      const method = page ? "PUT" : "POST";

      const res = await fetchData(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");

      onSaved(data, !page);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Form onSubmit={handleSubmit}>
      {error && <div className="alert alert-danger">{error}</div>}

      <Form.Group className="mb-3">
        <Form.Label>Title</Form.Label>
        <Form.Control name="title" value={form.title} onChange={handleChange} required />
      </Form.Group>

      <Form.Group className="mb-3">
        <Form.Label>Slug</Form.Label>
        <Form.Control
          name="slug"
          value={form.slug}
          onChange={handleChange}
          required
          placeholder="about-us"
        />
        <Form.Text>Use &quot;home&quot; for the homepage.</Form.Text>
      </Form.Group>

      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label>Page Type</Form.Label>
            <Form.Select name="pageType" value={form.pageType} onChange={handleChange}>
              <option value="marketing">Marketing</option>
              <option value="legal">Legal</option>
              <option value="custom">Custom</option>
            </Form.Select>
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label>Status</Form.Label>
            <Form.Select name="status" value={form.status} onChange={handleChange}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>

      <Form.Group className="mb-3">
        <Form.Check
          type="checkbox"
          name="showInNav"
          label="Show in navigation"
          checked={form.showInNav}
          onChange={handleChange}
        />
      </Form.Group>

      {form.showInNav && (
        <Row>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>Nav Label</Form.Label>
              <Form.Control name="navLabel" value={form.navLabel} onChange={handleChange} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>Nav Order</Form.Label>
              <Form.Control type="number" name="navOrder" value={form.navOrder} onChange={handleChange} />
            </Form.Group>
          </Col>
        </Row>
      )}

      <hr />
      <h6>SEO</h6>
      <Form.Group className="mb-3">
        <Form.Label>Meta Title</Form.Label>
        <Form.Control name="meta.title" value={form.meta.title} onChange={handleChange} />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Meta Description</Form.Label>
        <Form.Control as="textarea" rows={2} name="meta.description" value={form.meta.description} onChange={handleChange} />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>OG Image URL</Form.Label>
        <Form.Control name="meta.ogImage" value={form.meta.ogImage} onChange={handleChange} />
      </Form.Group>

      <div className="d-flex gap-2">
        <Button type="submit" variant="custom" disabled={loading}>
          {loading ? "Saving..." : page ? "Save Settings" : "Create & Open Vvveb Editor"}
        </Button>
        <Button variant="outline-secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Form>
  );
}
