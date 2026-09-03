"use client";
import { Button, ListGroup, Row, Col } from "react-bootstrap";

export default function EmailAccountList({ setEditEmailAccount, emailAccounts, fetchEmailAccounts }) {
    return (
        <div className="w_card">
            <div className="w_card_list">
                <ListGroup as="ul" variant="flush">
                    <ListGroup.Item as="li" key="head" className="w_card_list_head border-bottom-0">
                        <Row className="align-items-center w-100 row_chk_ms">
                            <Col xl={11} lg={10} sm={9} xs={12}>
                                <Row className="align-items-center">
                                    <Col xl={3} lg={3} sm={3} xs={12}>
                                        <p className="label"><small>Account Name</small></p>
                                    </Col>
                                    <Col xl={4} lg={4} sm={4} xs={12}>
                                        <p className="label"><small>Email</small></p>
                                    </Col>
                                    <Col xl={3} lg={4} sm={4} xs={12}>
                                        <p className="label"><small>Event Type</small></p>
                                    </Col>
                                    <Col xl={2} lg={3} sm={3} xs={6}>
                                        <p className="label"><small>Status</small></p>
                                    </Col>
                                </Row>
                            </Col>
                            <Col xl={1} lg={2} sm={3} xs={6}>
                                <p className="p_bold text-center"><small>Action</small></p>
                            </Col>
                        </Row>
                    </ListGroup.Item>

                    {Array.isArray(emailAccounts) && emailAccounts.length > 0 ? (
                        emailAccounts.map((account) => (
                            <ListGroup.Item as="li" key={account._id} className="w_card_list_box d-flex align-items-center">
                                <Row className="align-items-center w-100">
                                    <Col xl={11} lg={10} sm={9} xs={12}>
                                        <Row className="align-items-center">
                                            <Col xl={3} lg={3} sm={3} xs={12}>
                                                {/* <p className="label"><small>Account Name</small></p> */}
                                                <p className="p_bold">{account.account_name}</p>
                                            </Col>
                                            <Col xl={4} lg={4} sm={4} xs={12}>
                                                {/* <p className="label"><small>Email Address</small></p> */}
                                                <p>{account.email_address}</p>
                                            </Col>
                                            <Col xl={3} lg={4} sm={4} xs={12}>
                                                {/* <p className="label"><small>POP3 Server</small></p> */}
                                                <p>{account.event_type}</p>
                                            </Col>
                                            <Col xl={2} lg={3} sm={3} xs={6}>
                                                {/* <p className="label"><small>Active</small></p> */}
                                                <p>{account.active ? <span className="text-success">Active</span> : <span className="text-danger">Inactive</span>}</p>
                                            </Col>
                                        </Row>
                                    </Col>
                                    <Col xl={1} lg={2} sm={3} xs={6}>
                                        <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                                            <Button
                                                variant="custom"
                                                size="sm"
                                                onClick={() => setEditEmailAccount(account)} // Trigger Edit Mode
                                            >
                                                <i className="fa-regular fa-pen-to-square"></i>
                                            </Button>
                                            <Button variant="secondary" size="sm">
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