"use client";
import { useState, useEffect } from "react";
import { Button, ListGroup, Row, Col } from "react-bootstrap";
import { formatTimestamp } from "../../../utils/dateUtils";
import useFetch from "../../../hooks/useFetch";

export default function EmailConversationsList({ dealer_id, searchSender, searchRecipient, searchText, onEmailSelect }) {
    const [emails, setEmails] = useState([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const { fetchData, error: fetchError, loading } = useFetch();

    useEffect(() => {
        fetchEmails();
    }, [page, searchSender, searchRecipient, searchText]); // 🔹 Trigger fetch when search inputs change

    // 🔹 Fetch Emails with Search Filters
    const fetchEmails = async () => {
        try {
            const response = await fetchData(
                `/api/conversations?dealer_id=${dealer_id}&sender=${searchSender}&recipient=${searchRecipient}&text=${searchText}&page=${page}`
            );
            const data = await response.json();
            setEmails(data.emails);
            setTotalPages(data.totalPages);
        } catch (error) {
            console.error("Error fetching emails:", error);
        }
    };

    return (
        <div className="position-relative">
            <Row>
                <Col>
                    <div className="w_card">
                        <div className="w_card_list">
                            <ListGroup as="ul" variant="flush">
                                <ListGroup.Item as="li" key="head" className="w_card_list_head border-bottom-0">
                                    <Row className="align-items-center w-100 row_chk_ms g-0">
                                        <Col xl={11} lg={10} sm={9} xs={12}>
                                            <Row className="align-items-center">
                                                <Col xl={3}><p className="label"><small>From</small></p></Col>
                                                <Col xl={4}><p className="label"><small>To</small></p></Col>
                                                <Col xl={3}><p className="label"><small>Subject</small></p></Col>
                                                <Col xl={2}><p className="label"><small>Timestamp</small></p></Col>
                                            </Row>
                                        </Col>
                                        <Col xl={1} className="text-center"><p className="p_bold"><small>Action</small></p></Col>
                                    </Row>
                                </ListGroup.Item>

                                {emails.length > 0 ? (
                                    emails.map((email) => (
                                        <ListGroup.Item
                                            as="li"
                                            key={email._id}
                                            onClick={() => onEmailSelect(email)}
                                            className="w_card_list_box d-flex align-items-center list_a"
                                        >
                                            <Row className="align-items-center w-100 g-0">
                                                <Col xl={11}>
                                                    <Row className="align-items-center">
                                                        <Col xl={3}><p className="p_bold">{email.sender}</p></Col>
                                                        <Col xl={4}><p className="p_bold">{email.recipient}</p></Col>
                                                        <Col xl={3}><p>{email.subject}</p></Col>
                                                        <Col xl={2}><p>{formatTimestamp(email.timestamp)}</p></Col>
                                                    </Row>
                                                </Col>
                                                <Col xl={1} className="text-end">
                                                    <Button variant="custom" size="sm" onClick={() => onEmailSelect(email)}>📩</Button>
                                                </Col>
                                            </Row>
                                        </ListGroup.Item>
                                    ))
                                ) : (
                                    <p>No conversations found.</p>
                                )}
                            </ListGroup>
                        </div>
                    </div>
                </Col>
            </Row>

            {/* Pagination */}
            <div className="d-flex justify-content-center mt-3">
                {[...Array(totalPages)].map((_, index) => (
                    <Button
                        key={index}
                        variant={index + 1 === page ? "custom" : "secondary"}
                        size="sm"
                        onClick={() => setPage(index + 1)}
                        className="mx-1"
                    >
                        {index + 1}
                    </Button>
                ))}
            </div>
        </div>
    );
}
