"use client";
import { useState, useEffect } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import { Button, ListGroup, Row, Col, Offcanvas, Form } from "react-bootstrap";
import { useUser } from "../../context/UserContext";

export default function LeadList({ setEditLead }) {
    const [leads, setLeads] = useState([]);
    const [selectedItems, setSelectedItems] = useState([]);
    const [selectedLead, setSelectedLead] = useState(null);
    const [show, setShow] = useState(false);
    const [loading, setLoading] = useState(true);
    const { user, dealerParent } = useUser();

    // Determine active entity (parent if exists, otherwise user)
    const activeEntity = dealerParent || user;

    // Fetch leads from API
    useEffect(() => {
        if (!activeEntity?.id) return;

        const fetchLeads = async () => {
            try {
                setLoading(true);
                const response = await fetch(`/api/leads?dealer_id=${activeEntity.id}`);
                const data = await response.json();
                setLeads(data);
            } catch (error) {
                console.error("Error fetching leads:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchLeads();
    }, [activeEntity?.id]); // Re-fetch when activeEntity changes

    // Show details modal
    const handleShow = (lead) => {
        setSelectedLead(lead);
        setShow(true);
    };

    // Close details modal
    const handleClose = () => {
        setShow(false);
        setSelectedLead(null);
    };

    // Handle lead selection
    const handleCheckboxChange = (id) => {
        setSelectedItems((prev) =>
            prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
        );
    };

    const handleDelete = async (id) => {
        try {
            await fetch("/api/leads", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });

            setLeads(leads.filter((lead) => lead._id !== id));
        } catch (error) {
            console.error("Error deleting lead:", error);
        }
    };

    // Delete selected leads
    const handleDeleteSelected = async () => {
        try {
            await Promise.all(selectedItems.map((id) => fetch("/api/leads", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            })));

            setLeads(leads.filter((lead) => !selectedItems.includes(lead._id)));
            setSelectedItems([]);
        } catch (error) {
            console.error("Error deleting leads:", error);
        }
    };

    if (loading) {
        return (
            <div className="w_card">
                <div className="text-center py-4">Loading leads...</div>
            </div>
        );
    }

    return (
        <>
            <div className="w_card w_card_with_chk">
                <div className="d-flex align-items-center mb-2">
                    <h3 className="w_card_title mb-0">Lead List</h3>
                    {dealerParent && (
                        <span className="ms-2 text-muted"></span>
                    )}
                </div>

                <div className="w_card_list">
                    <ListGroup as="ul" variant="flush">
                        <ListGroup.Item as="li" key="head" className="w_card_list_head border-bottom-0">
                            <Row className="align-items-center w-100 row_chk_ms">
                                <Col xl={11} lg={10} sm={9} xs={12}>
                                    <Row className="align-items-center">
                                        <Col xl={3} lg={3} sm={3} xs={12}>
                                            <p className="label"><small>Name</small></p>
                                        </Col>
                                        <Col xl={3} lg={3} sm={3} xs={12}>
                                            <p className="label"><small>Email</small></p>
                                        </Col>
                                        <Col xl={3} lg={3} sm={3} xs={12}>
                                            <p className="label"><small>Phone</small></p>
                                        </Col>
                                        <Col xl={3} lg={3} sm={3} xs={12}>
                                            <p className="label"><small>Source</small></p>
                                        </Col>
                                    </Row>
                                </Col>
                                <Col xl={1} lg={2} sm={3} xs={6}>
                                    <p className="p_bold text-center"><small>Action</small></p>
                                </Col>
                            </Row>
                        </ListGroup.Item>

                        {leads.length > 0 ? (
                            leads.map((lead) => (
                                <ListGroup.Item as="li" key={lead._id} className="w_card_list_box d-flex align-items-center">
                                    <Row className="align-items-center w-100 row_chk_ms">
                                        <Col xl={11} lg={10} sm={9} xs={12}>
                                            <Row className="align-items-center">
                                                <Col xl={3} lg={3} sm={3} xs={12}>
                                                    <p className="p_bold">{lead.name}</p>
                                                </Col>
                                                <Col xl={3} lg={3} sm={3} xs={12}>
                                                    <p>{lead.email}</p>
                                                </Col>
                                                <Col xl={3} lg={3} sm={3} xs={12}>
                                                    <p>{lead.phone}</p>
                                                </Col>
                                                <Col xl={3} lg={3} sm={3} xs={12}>
                                                    <p>{lead.source}</p>
                                                </Col>
                                            </Row>
                                        </Col>
                                        <Col xl={1} lg={2} sm={3} xs={6}>
                                            <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                                                <Button variant="custom" size="sm" onClick={() => handleShow(lead)}>
                                                    <i className="fa-regular fa-eye"></i>
                                                </Button>
                                                <Button variant="secondary" size="sm" onClick={() => handleDelete(lead._id)}>
                                                    <i className="fa-regular fa-trash"></i>
                                                </Button>
                                            </div>
                                        </Col>
                                    </Row>
                                </ListGroup.Item>
                            ))
                        ) : (
                            <div className="text-center py-4">No leads found.</div>
                        )}
                    </ListGroup>
                </div>
            </div>

            {/* View Lead Offcanvas Modal */}
            <Offcanvas show={show} onHide={handleClose} placement="end">
                <Offcanvas.Header closeButton>
                    <Offcanvas.Title>Lead Details</Offcanvas.Title>
                </Offcanvas.Header>
                <Offcanvas.Body>
                    {selectedLead ? (
                        <div className="lead_offcanvas">
                            <p><strong>Name:</strong> <span>{selectedLead.name}</span></p>
                            <p><strong>Email:</strong> <span>{selectedLead.email}</span></p>
                            <p><strong>Phone:</strong> <span>{selectedLead.phone}</span></p>
                            <p><strong>Source:</strong> <span>{selectedLead.source}</span></p>
                            <p><strong>Created At:</strong> <span>{formatTimestamp(selectedLead.createdAt)}</span></p>
                        </div>
                    ) : (
                        <p>No lead selected.</p>
                    )}
                </Offcanvas.Body>
            </Offcanvas>
        </>
    );
}