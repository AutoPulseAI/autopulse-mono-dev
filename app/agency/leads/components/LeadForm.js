"use client";
import { useState } from "react";
import { Form, Button, Row, Col } from "react-bootstrap";

export default function LeadForm({ setEditLead, editLead }) {
    const [formData, setFormData] = useState(editLead || {
        name: "",
        accountId: "",
        emailAddress: "",
        emailLogin: "",
        xmlRouting: "",
        xmlRole: "",
        textRouting: "",
        pop3: "",
        autoResponse: "",
        createToDo: "",
        unlistedCallers: ""
    });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        console.log("Form Submitted:", formData);
        setEditLead(null); // Hide form after submit
    };

    return (
        <div className="w_card">
            <h3 className="w_card_title">{editLead.id ? "Edit Lead" : "Add New Lead"}</h3>
            <Form onSubmit={handleSubmit} as={Row}>
                <Form.Group controlId="name" as={Col} lg={4} md={6} className="mb-2">
                    <Form.Label>Account Name</Form.Label>
                    <Form.Control type="text" name="name" value={formData.name ?? ""} onChange={handleChange} required />
                </Form.Group>

                <Form.Group controlId="emailAddress" as={Col} lg={4} md={6} className="mb-2">
                    <Form.Label>Email Address</Form.Label>
                    <Form.Control type="email" name="email" value={formData.emailAddress ?? ""} onChange={handleChange} required />
                </Form.Group>

                <Form.Group controlId="emailLogin" as={Col} lg={4} md={6} className="mb-2">
                    <Form.Label>Email Login</Form.Label>
                    <Form.Control type="email" name="emailLogin" value={formData.emailLogin ?? ""} onChange={handleChange} required />
                </Form.Group>

                <Form.Group controlId="xmlRouting" as={Col} lg={4} md={6} className="mb-2">
                    <Form.Label>XML Routing Name</Form.Label>
                    <Form.Control type="text" name="xmlRouting" value={formData.xmlRouting ?? ""} onChange={handleChange} required />
                </Form.Group>

                <Form.Group controlId="xmlRole" as={Col} lg={4} md={6} className="mb-2">
                    <Form.Label>XML Role Name</Form.Label>
                    <Form.Control type="text" name="xmlRole" value={formData.xmlRole ?? ""} onChange={handleChange} required />
                </Form.Group>

                <Form.Group controlId="textRouting" as={Col} lg={4} md={6} className="mb-2">
                    <Form.Label>Text Routing Name</Form.Label>
                    <Form.Control type="text" name="textRouting" value={formData.textRouting ?? ""} onChange={handleChange} required />
                </Form.Group>

                <Form.Group controlId="pop3" as={Col} lg={4} md={6} className="mb-2">
                    <Form.Label>POP-3</Form.Label>
                    <Form.Control type="text" name="pop3" value={formData.pop3 ?? ""} onChange={handleChange} required />
                </Form.Group>

                <Form.Group controlId="autoResponse" as={Col} lg={4} md={6} className="mb-2">
                    <Form.Label>Auto Response</Form.Label>
                    <Form.Control type="text" name="autoResponse" value={formData.autoResponse ?? ""} onChange={handleChange} required />
                </Form.Group>

                <Form.Group controlId="createToDo" as={Col} lg={4} md={6} className="mb-2">
                    <Form.Label>Create To-Do</Form.Label>
                    <Form.Control type="text" name="createToDo" value={formData.createToDo ?? ""} onChange={handleChange} required />
                </Form.Group>

                <Form.Group controlId="unlistedCallers" as={Col} lg={4} md={6} className="mb-2">
                    <Form.Label>Add Unlisted Callers</Form.Label>
                    <Form.Control type="text" name="unlistedCallers" value={formData.unlistedCallers ?? ""} onChange={handleChange} required />
                </Form.Group>

                <div className="text-center mt-3" as={Col}>
                    <Button variant="custom" type="submit" className="me-2">Save</Button>
                    <Button variant="secondary" type="button" onClick={() => setEditLead(null)}>Cancel</Button>
                </div>
            </Form>
        </div>
    );
}