"use client";
import { useState } from "react";
import LeadList from "./components/LeadList";
import LeadForm from "./components/LeadForm";
import { Button } from "react-bootstrap";


export default function LeadManagement() {
    const [editLead, setEditLead] = useState(null);
  
    return (
        <div className="page_content">
            {/* Page Header */}
            <div className="page_head">
                <div className="row align-items-center">
                    <div className="col col-12">
                        <div className="d-flex align-items-center">
                            {editLead && (
                                <Button variant="secondary" size="sm" onClick={() => setEditLead(null)} className="me-2"><i className="fa-solid fa-arrow-left"></i></Button>
                            )}
                            <h3 className="page_title mb-0">Manage Leads</h3>
                            {/* {!editLead && (
                                <Button variant="custom" size="sm" onClick={() => setEditLead({})} className="ms-auto">
                                    <i className="fa-solid fa-plus me-2"></i>Add Lead
                                </Button>
                            )} */}
                        </div>
                    </div>
                </div>
            </div>

            <div className="page_body">

                {editLead ? (
                    <LeadForm setEditLead={setEditLead} editLead={editLead} />
                ) : (
                    <LeadList setEditLead={setEditLead} />
                )}

            </div>
        </div>
    );
}
