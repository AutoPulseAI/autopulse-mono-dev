"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, ListGroup, Row, Col, Nav, Spinner, Pagination } from "react-bootstrap";
import { formatTimestamp } from "../../../utils/dateUtils";
import useFetch from "../../../hooks/useFetch";
import DateRangePickerComponent from "../../components/DateRangePicker";

// Component that uses useSearchParams - needs to be wrapped in Suspense
function EmailConversationsListContent({
    dealer_id,
    searchSender,
    searchRecipient,
    searchText,
    onEmailSelect,
    user,
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [conversations, setConversations] = useState([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [activeTab, setActiveTab] = useState(searchParams.get("type") || "email");
    const [dateRange, setDateRange] = useState({
        startDate: null,
        endDate: null
    });
    
    // State for page input (separate from actual page)
    const [pageInputValue, setPageInputValue] = useState('1');
    
    const { fetchData, error: fetchError, loading } = useFetch();

    // Initialize page from URL params
    useEffect(() => {
        const urlPage = searchParams.get("page");
        if (urlPage) {
            const pageNum = parseInt(urlPage);
            if (pageNum >= 1) {
                setPage(pageNum);
                setPageInputValue(pageNum.toString());
            }
        }
    }, [searchParams]);

    // Initialize date range from URL params
    useEffect(() => {
        const startDate = searchParams.get("startDate");
        const endDate = searchParams.get("endDate");
        if (startDate || endDate) {
            setDateRange({
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null
            });
        }
    }, [searchParams]);

    useEffect(() => {
        fetchConversations();
    }, [page, searchSender, searchRecipient, searchText, activeTab, dateRange]);

    const fetchConversations = async () => {
        try {
            let url = `/api/conversations?dealer_id=${dealer_id}&sender=${searchSender}&recipient=${searchRecipient}&text=${searchText}&communication_type=${activeTab}&page=${page}`;

            if (dateRange.startDate) {
                url += `&startDate=${dateRange.startDate.toISOString()}`;
            }
            if (dateRange.endDate) {
                url += `&endDate=${dateRange.endDate.toISOString()}`;
            }

            const response = await fetchData(url);
            const data = await response.json();
            setConversations(data.emails || []);
            setTotalPages(data.totalPages || 1);
            
            // Sync pageInputValue with the current page after API call
            setPageInputValue(page.toString());
        } catch (error) {
            console.error("Error fetching conversations:", error);
        }
    };

    const handleDateRangeChange = ({ startDate, endDate }) => {
        setDateRange({ startDate, endDate });
        setPage(1);
        setPageInputValue('1');
        updateURL({ page: 1, startDate, endDate });
    };

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        setPage(1);
        setPageInputValue('1');
        updateURL({ page: 1, type: tab });
    };

    const handlePageChange = (newPage) => {
        if (newPage < 1) return;
        
        setPage(newPage);
        setPageInputValue(newPage.toString());
        updateURL({ page: newPage });
    };

    const updateURL = (params) => {
        const newSearchParams = new URLSearchParams(searchParams.toString());
        
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
                newSearchParams.set(key, value.toString());
            } else {
                newSearchParams.delete(key);
            }
        });
        
        router.push(`/dealer/conversations?${newSearchParams.toString()}`, undefined, { shallow: true });
    };

    const createPaginationItems = () => {
        const items = [];
        const maxVisiblePages = 5;
        let startPage = Math.max(1, page - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
        
        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }
        
        for (let i = startPage; i <= endPage; i++) {
            items.push(
                <Pagination.Item
                    key={i}
                    active={i === page}
                    onClick={() => handlePageChange(i)}
                >
                    {i}
                </Pagination.Item>
            );
        }
        
        return items;
    };

    if (loading) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ height: '200px' }}>
                <Spinner animation="border" variant="dark" />
                <span className="ms-3">Loading conversations...</span>
            </div>
        );
    }

    if (fetchError) {
        return (
            <div className="alert alert-danger" role="alert">
                Error loading conversations: {fetchError}
            </div>
        );
    }

    return (
        <div className="conversations_list">
            <Row>
                <Col xl={12}>
                    <div className="w_card">
                        <div className="w_card_head">
                            <Row className="align-items-center">
                                <Col xl={12} md={6}>
                                    <div className="d-flex justify-content-end gap-2 mb-2">
                                        <div className="d-flex align-items-center mb-2">
                                            <h3 className="w_card_title mb-0">Conversation List</h3>
                                        </div>

                                        <Nav variant="pills" activeKey={activeTab} onSelect={handleTabChange} className="mx-auto">
                                            <Nav.Item>
                                                <Nav.Link eventKey="email">Email</Nav.Link>
                                            </Nav.Item>
                                            <Nav.Item>
                                                <Nav.Link eventKey="sms">SMS</Nav.Link>
                                            </Nav.Item>
                                        </Nav>

                                        <DateRangePickerComponent
                                            onDateRangeChange={handleDateRangeChange}
                                            startDate={dateRange.startDate}
                                            endDate={dateRange.endDate}
                                        />
                                    </div>
                                </Col>
                            </Row>
                        </div>
                        <div className="w_card_body">
                            <ListGroup>
                                {conversations.length > 0 ? (
                                    conversations.map((conv) => (
                                        <ListGroup.Item
                                            key={conv._id}
                                            action
                                            onClick={() => onEmailSelect(conv)}
                                            className="w_card_list_box d-flex align-items-center a_link"
                                        >
                                            <Row className="align-items-center w-100 g-0">
                                                <Col xl={11} lg={11} md={11} xs={12}>
                                                    <Row className="align-items-center">
                                                        <Col xl={3} md={3}>
                                                            <p className="p_bold">{conv.sender}</p>
                                                        </Col>
                                                        <Col xl={4} md={4}>
                                                            <p>{conv.recipient}</p>
                                                        </Col>
                                                        <Col xl={3} md={3}>
                                                            <div className="w_card_list_box_label">
                                                                <p className="label"><small>{activeTab === "email" ? "Subject" : "Message"}:</small></p>
                                                                <p className="text-truncate">
                                                                    {activeTab === "email"
                                                                        ? conv.subject
                                                                        : conv.mail_content?.substring(0, 50) + (conv.mail_content?.length > 50 ? "..." : "")}
                                                                </p>
                                                            </div>
                                                        </Col>
                                                        <Col xl={2} md={2}>
                                                            <div className="w_card_list_box_label">
                                                                <p className="label"><small>Conversation Start date:</small></p>
                                                                <p>{formatTimestamp(conv.timestamp || conv.date)}</p>
                                                            </div>
                                                        </Col>
                                                    </Row>
                                                </Col>
                                                <Col xl={1} lg={1} md={1} xs={12} className="text-center d-none d-md-flex">
                                                    <Button variant="custom" size="sm" onClick={() => onEmailSelect(conv)} className="mx-auto"><i className="fa-regular fa-envelope-open"></i></Button>
                                                </Col>
                                            </Row>
                                        </ListGroup.Item>
                                    ))
                                ) : (
                                    <p className="text-center mt-3">No {activeTab} conversations found.</p>
                                )}
                            </ListGroup>
                        </div>
                    </div>
                </Col>
            </Row>

            {totalPages > 1 && (
                <div className="d-flex justify-content-center align-items-center pb-3 gap-3 flex-wrap">
                    <Pagination className="mb-0">
                        <Pagination.Prev
                            onClick={() => handlePageChange(page - 1)}
                            disabled={page === 1}
                        />
                        {createPaginationItems()}
                        <Pagination.Next
                            onClick={() => handlePageChange(page + 1)}
                            disabled={page === totalPages}
                        />
                    </Pagination>
                    
                    {/* Page Input Box */}
                    <div className="d-flex align-items-center gap-2 flex-wrap justify-content-center">
                        <span className="text-muted small">Go to page:</span>
                        <input
                            type="number"
                            min="1"
                            value={pageInputValue}
                            onChange={(e) => {
                                setPageInputValue(e.target.value);
                            }}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                    const page = parseInt(e.target.value);
                                    if (page >= 1) {
                                        handlePageChange(page);
                                    }
                                }
                            }}
                            className="form-control form-control-sm text-center"
                            style={{ width: '80px' }}
                            placeholder="Page #"
                        />
                        <span className="text-muted small">of {totalPages}</span>
                        <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={() => {
                                const page = parseInt(pageInputValue);
                                if (page >= 1) {
                                    handlePageChange(page);
                                }
                            }}
                            disabled={!pageInputValue || parseInt(pageInputValue) < 1}
                        >
                            Go
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Main component with Suspense boundary
export default function EmailConversationsList(props) {
    return (
        <Suspense fallback={
            <div className="d-flex justify-content-center align-items-center" style={{ height: '200px' }}>
                <Spinner animation="border" variant="dark" />
                <span className="ms-3">Loading conversations list...</span>
            </div>
        }>
            <EmailConversationsListContent {...props} />
        </Suspense>
    );
}