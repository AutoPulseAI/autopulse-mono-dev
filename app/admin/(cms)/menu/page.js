"use client";

import { useState, useEffect } from "react";
import {
  Row,
  Col,
  Button,
  Offcanvas,
  Badge,
  Alert,
  ListGroup,
  Form,
  Nav,
} from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";

const LOCATIONS = [
  { key: "header", label: "Header" },
  { key: "footer", label: "Footer" },
  { key: "footer2", label: "Footer (2nd column)" },
  { key: "legal", label: "Footer Legal" },
];

const emptyItem = { label: "", url: "", visible: true, target: "_self", location: "header" };

export default function MenuManagement() {
  const { fetchData } = useFetch();
  const [allItems, setAllItems] = useState([]);
  const [activeLocation, setActiveLocation] = useState("header");
  const [editItem, setEditItem] = useState(null);
  const [formData, setFormData] = useState(emptyItem);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });

  const items = allItems.filter((item) => (item.location || "header") === activeLocation);

  const authHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem("token")}`,
    "Content-Type": "application/json",
  });

  const showAlert = (message, variant = "success") => {
    setAlert({ show: true, message, variant });
    setTimeout(() => setAlert({ show: false, message: "", variant: "success" }), 5000);
  };

  const fetchItems = async () => {
    try {
      const res = await fetchData("/api/menu?all=1", { headers: authHeaders() });
      const data = await res.json();
      setAllItems(data.items || []);
    } catch (error) {
      console.error("Error fetching menu items:", error);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const openForm = (item = null) => {
    setEditItem(item);
    setFormData(
      item
        ? {
            label: item.label,
            url: item.url,
            visible: item.visible,
            target: item.target,
            location: item.location || "header",
          }
        : { ...emptyItem, location: activeLocation }
    );
    setShow(true);
  };

  const handleClose = () => {
    setShow(false);
    setEditItem(null);
    setFormData(emptyItem);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.label.trim() || !formData.url.trim()) {
      showAlert("Label and URL are required", "danger");
      return;
    }
    setSaving(true);
    try {
      const url = editItem ? `/api/menu/${editItem._id}` : "/api/menu";
      const res = await fetchData(url, {
        method: editItem ? "PUT" : "POST",
        headers: authHeaders(),
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("save failed");
      showAlert(editItem ? "Menu item updated" : "Menu item added");
      handleClose();
      fetchItems();
    } catch (error) {
      showAlert("Failed to save menu item", "danger");
    }
    setSaving(false);
  };

  const move = async (index, direction) => {
    const other = index + direction;
    if (other < 0 || other >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[other]] = [reordered[other], reordered[index]];
    try {
      await Promise.all(
        reordered.map((item, i) =>
          fetchData(`/api/menu/${item._id}`, {
            method: "PUT",
            headers: authHeaders(),
            body: JSON.stringify({ order: i }),
          })
        )
      );
      fetchItems();
    } catch (error) {
      showAlert("Failed to reorder", "danger");
    }
  };

  const toggleVisible = async (item) => {
    try {
      await fetchData(`/api/menu/${item._id}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ visible: !item.visible }),
      });
      fetchItems();
    } catch (error) {
      showAlert("Failed to update visibility", "danger");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetchData(`/api/menu/${deleteId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("delete failed");
      showAlert("Menu item deleted");
      fetchItems();
    } catch (error) {
      showAlert("Failed to delete menu item", "danger");
    }
    setDeleteId(null);
  };

  return (
    <>
      <div className="page_content cms-page">
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <div className="d-flex align-items-center">
                <h4 className="page_title mb-0">Navigation Menu</h4>
                <Button
                  variant="custom"
                  size="sm"
                  onClick={() => openForm()}
                  className="ms-auto text-nowrap"
                >
                  <i className="fa-regular fa-plus me-2"></i>Add Menu Item
                </Button>
              </div>
            </div>
          </div>
        </div>

        {alert.show && (
          <Alert variant={alert.variant} dismissible onClose={() => setAlert({ ...alert, show: false })}>
            {alert.message}
          </Alert>
        )}

        <Nav
          variant="pills"
          activeKey={activeLocation}
          onSelect={(key) => setActiveLocation(key)}
          className="mb-3"
        >
          {LOCATIONS.map((loc) => (
            <Nav.Item key={loc.key}>
              <Nav.Link eventKey={loc.key}>
                {loc.label}
                <Badge bg="secondary" className="ms-2">
                  {allItems.filter((i) => (i.location || "header") === loc.key).length}
                </Badge>
              </Nav.Link>
            </Nav.Item>
          ))}
        </Nav>

        <Row>
          <Col>
            <ListGroup className="data_list">
              <ListGroup.Item className="data_list_head d-none d-md-block">
                <Row>
                  <Col md={1}>Order</Col>
                  <Col md={3}>Label</Col>
                  <Col md={3}>URL</Col>
                  <Col md={2}>Visible</Col>
                  <Col md={3} className="text-end">Actions</Col>
                </Row>
              </ListGroup.Item>

              {items.length === 0 && (
                <ListGroup.Item className="text-center text-muted py-4">
                  No items in this menu yet. Add one to get started.
                </ListGroup.Item>
              )}

              {items.map((item, index) => (
                <ListGroup.Item key={item._id}>
                  <Row className="align-items-center">
                    <Col md={1} className="mb-2 mb-md-0">
                      <div className="d-flex align-items-center gap-1">
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                          title="Move up"
                        >
                          <i className="fa-solid fa-chevron-up"></i>
                        </Button>
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          disabled={index === items.length - 1}
                          onClick={() => move(index, 1)}
                          title="Move down"
                        >
                          <i className="fa-solid fa-chevron-down"></i>
                        </Button>
                      </div>
                    </Col>
                    <Col md={3} className="mb-2 mb-md-0">
                      <strong>{item.label}</strong>
                      {item.target === "_blank" && (
                        <i className="fa-regular fa-arrow-up-right-from-square ms-2 text-muted" title="Opens in new tab"></i>
                      )}
                    </Col>
                    <Col md={3} className="mb-2 mb-md-0">
                      <code>{item.url}</code>
                    </Col>
                    <Col md={2} className="mb-2 mb-md-0">
                      <Form.Check
                        type="switch"
                        checked={item.visible}
                        onChange={() => toggleVisible(item)}
                        label={
                          <Badge bg={item.visible ? "success" : "secondary"}>
                            {item.visible ? "Visible" : "Hidden"}
                          </Badge>
                        }
                      />
                    </Col>
                    <Col md={3} className="text-md-end">
                      <Button
                        variant="outline-primary"
                        size="sm"
                        className="me-1 mb-1"
                        onClick={() => openForm(item)}
                      >
                        <i className="fa-regular fa-pen-to-square me-1"></i>Edit
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        className="mb-1"
                        onClick={() => setDeleteId(item._id)}
                      >
                        <i className="fa-regular fa-trash"></i>
                      </Button>
                    </Col>
                  </Row>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </Col>
        </Row>
      </div>

      <Offcanvas show={show} onHide={handleClose} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>{editItem ? "Edit Menu Item" : "Add Menu Item"}</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>Menu Location</Form.Label>
              <Form.Select
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              >
                {LOCATIONS.map((loc) => (
                  <option key={loc.key} value={loc.key}>
                    {loc.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Label</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g. Pricing"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>URL</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g. /pricing or https://example.com"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                required
              />
              <Form.Text muted>Use a relative path like /pricing for site pages.</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Open In</Form.Label>
              <Form.Select
                value={formData.target}
                onChange={(e) => setFormData({ ...formData, target: e.target.value })}
              >
                <option value="_self">Same tab</option>
                <option value="_blank">New tab</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-4">
              <Form.Check
                type="switch"
                label="Visible in menu"
                checked={formData.visible}
                onChange={(e) => setFormData({ ...formData, visible: e.target.checked })}
              />
            </Form.Group>
            <div className="d-flex gap-2">
              <Button variant="custom" type="submit" disabled={saving}>
                {saving ? "Saving..." : editItem ? "Update" : "Add"}
              </Button>
              <Button variant="outline-secondary" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </Form>
        </Offcanvas.Body>
      </Offcanvas>

      <DeleteConfirmModal
        show={!!deleteId}
        onHide={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Menu Item"
        message="Are you sure you want to remove this item from the menu?"
      />
    </>
  );
}
