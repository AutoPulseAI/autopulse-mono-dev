"use client";
import { Button, ListGroup, Row, Col } from "react-bootstrap";
import { toast } from "react-toastify";
import useFetch from "../../../hooks/useFetch";
export default function EmailAccountList({ setEditEmailAccount, emailAccounts, fetchEmailAccounts }) {
    const { fetchData, error: fetchError, loading } = useFetch();
    const handleDelete = async (accountId) => {
        if (window.confirm("Are you sure you want to delete this email account?")) {
            try {
                const res = await fetchData(`/api/email-accounts/${accountId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
                    }
                });

                if (res.ok) {
                    toast.success("Email account deleted successfully");
                    fetchEmailAccounts(); // Refresh the list
                } else {
                    throw new Error("Failed to delete email account");
                }
            } catch (error) {
                toast.error(error.message);
                console.error("Delete error:", error);
            }
        }
    };
    return (
        <div className="w_card">
            <div className="w_card_list">
                <ListGroup as="ul" variant="flush">
                    <ListGroup.Item as="li" key="head" className="w_card_list_head border-bottom-0">
                        <Row className="align-items-center w-100 g-0">
                            <Col xl={10} lg={10} md={10} xs={12}>
                                <Row className="align-items-center">
                                    <Col xl={4} lg={4} md={4} xs={12}>
                                        <p className="label"><small>Account Name</small></p>
                                    </Col>
                                    <Col xl={5} lg={5} md={5} xs={12}>
                                        <p className="label"><small>Email</small></p>
                                    </Col>
                                    <Col xl={3} lg={3} md={3} xs={12}>
                                        <p className="label"><small>Event Type</small></p>
                                    </Col>                                    
                                </Row>
                            </Col>
                            <Col xl={1} lg={1} md={1} xs={6}>
                                <p className="label"><small>Status</small></p>
                            </Col>
                            <Col xl={1} lg={1} md={1} xs={6}>
                                <p className="p_bold text-center"><small>Action</small></p>
                            </Col>
                        </Row>
                    </ListGroup.Item>

                    {Array.isArray(emailAccounts) && emailAccounts.length > 0 ? (
                        emailAccounts.map((account) => (
                            <ListGroup.Item as="li" key={account._id} className="w_card_list_box d-flex align-items-center">
                                <Row className="align-items-center w-100 g-0">
                                    <Col xl={10} lg={10} md={10} xs={12}>
                                        <Row className="align-items-center">
                                            <Col xl={4} lg={4} md={4} xs={12}>
                                                <div className="w_card_list_box_label">
                                                    <p className="label"><small>Account Name:</small></p>
                                                    <p className="p_bold">{account.account_name}</p>
                                                </div>
                                            </Col>
                                            <Col xl={5} lg={5} md={5} xs={12}>
                                                <div className="w_card_list_box_label">
                                                    <p className="label"><small>Email:</small></p>
                                                    <p>{account.email_address}</p>
                                                </div>
                                            </Col>
                                            <Col xl={3} lg={3} md={3} xs={12}>
                                                <div className="w_card_list_box_label">
                                                    <p className="label"><small>Event Type:</small></p>
                                                    <p>{account.event_type}</p>
                                                </div>
                                            </Col>
                                        </Row>
                                    </Col>
                                    <Col xl={1} lg={1} md={1} xs={6}>
                                        <span className={`${account.active ? 'bg-custom' : 'bg-danger'} badge`} >
                                            {account.active ? 'Active' : 'Inactive'}
                                        </span>
                                    </Col>
                                    <Col xl={1} lg={1} md={1} xs={6}>
                                        <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                                            <Button
                                                variant="custom"
                                                size="sm"
                                                onClick={() => setEditEmailAccount(account)} // Trigger Edit Mode
                                            >
                                                <i className="fa-regular fa-pen-to-square"></i>
                                            </Button>
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() => handleDelete(account._id)}
                                            >
                                                <i className="fa-regular fa-trash"></i>
                                            </Button>
                                        </div>
                                    </Col>
                                </Row>
                            </ListGroup.Item>
                        ))
                    ) : (
                        <div className="text-center py-4">
                            No email accounts found.
                        </div>
                    )}
                </ListGroup>
            </div>
        </div>
    );
}