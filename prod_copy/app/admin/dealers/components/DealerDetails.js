"use client";
import { Button, ListGroup, Row, Col } from "react-bootstrap";
import { formatTimestamp } from "../../../utils/dateUtils";
import useFetch from "../../../hooks/useFetch";

export default function DealerDetails({ selectedDealer }) {
  const { fetchData, error: fetchError, loading } = useFetch();

  const handleDelete = async (dealerId) => {
    const res = await fetchData("/api/dealers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" ,'Authorization': `Bearer ${localStorage.getItem('token')}`},
      body: JSON.stringify({ dealerId }),
    });

    if (res.ok) {
      fetchDealers();
    }
  };

  console.log(selectedDealer);


  return (
    <Row className="gx-xl-3 gx-md-2 dealer_details">
      {/* Franchise Details */}
      <Col lg={12}>
        <div className="w_card pb-0">
          {/* <h3 className="w_card_title">Dealer Details</h3> */}
          <Row className="gx-3">
            <Col lg={3} md={3}>
              <label>Dealer Name</label>
              <p>{selectedDealer.name || "N/A"}</p>
            </Col>
            <Col lg={3} md={3}>
              <label>Dealer Email</label>
              <p>{selectedDealer.email || "N/A"}</p>
            </Col>
            <Col lg={3} md={3}>
              <label>Domain Name</label>
              <p>{selectedDealer.dealer_account_information?.sanitized_domain || "N/A"}</p>
            </Col>
            <Col lg={3} md={3}>
              <label>Created At</label>
              <p>{formatTimestamp(selectedDealer.createdAt) || "N/A"}</p>
            </Col>
          </Row>
        </div>
      </Col>

      {/* Dealership Details */}
      <Col lg={4} md={6}>
        <div className="w_card pb-0">
          <h3 className="w_card_title">Dealership Details</h3>
          <Row className="gx-3">
            <Col lg={12} md={12}>
              <label>Company Name</label>
              <p>{selectedDealer.dealer_account_information?.organization_name || "N/A"}</p>
            </Col>
            <Col lg={12} md={12}>
              <label>Store Name</label>
              <p>{selectedDealer.dealer_account_information?.store_name || "N/A"}</p>
            </Col>
            <Col lg={12} md={12}>
              <label>Domain Name</label>
              <p>{selectedDealer.dealer_account_information?.domain_name || "N/A"}</p>
            </Col>
            <Col lg={6} md={6}>
              <label>SMS Conversation Phone No</label>
              <p>{selectedDealer.dealer_account_information?.sms_conversion_phone || "N/A"}</p>
            </Col>
            <Col lg={6} md={6}>
              <label>Website URL</label>
              <p>{selectedDealer.dealer_account_information?.store_website || "N/A"}</p>
            </Col>
          </Row>
        </div>
      </Col>

      {/* Account Holder Contact Details */}
      <Col lg={4} md={6}>
        <div className="w_card pb-0">
          <h3 className="w_card_title">Account Holder Contact Details</h3>
          <Row className="gx-3">
            <Col lg={12} md={12}>
              <label>Contact Person Name</label>
              <p>{selectedDealer.dealer_account_information?.contact_person || "N/A"}</p>
            </Col>
            <Col lg={12} md={12}>
              <label>Role</label>
              <p>{selectedDealer.dealer_account_information?.contact_person_role || "N/A"}</p>
            </Col>
            <Col lg={12} md={12}>
              <label>Email</label>
              <p>{selectedDealer.dealer_account_information?.store_contact_mail || "N/A"}</p>
            </Col>
            <Col lg={12} md={12}>
              <label>Contact Number</label>
              <p>{selectedDealer.dealer_account_information?.store_contact_number || "N/A"}</p>
            </Col>

          </Row>
        </div>
      </Col>

      {/* Store Address */}
      <Col lg={4} md={6}>
        <div className="w_card pb-0">
          <h3 className="w_card_title">Store Address</h3>
          <Row className="gx-3">
            <Col lg={12} md={12}>
              <label>Address</label>
              <p>{selectedDealer.dealer_account_information?.store_address || "N/A"}</p>
            </Col>
            <Col lg={6} md={4} xs={4}>
              <label>City</label>
              <p>{selectedDealer.dealer_account_information?.store_city || "N/A"}</p>
            </Col>
            <Col lg={6} md={4} xs={4}>
              <label>State</label>
              <p>{selectedDealer.dealer_account_information?.store_state || "N/A"}</p>
            </Col>
            <Col lg={6} md={4} xs={4}>
              <label>Zip Code</label>
              <p>{selectedDealer.dealer_account_information?.store_postal || "N/A"}</p>
            </Col>
            <Col lg={6} md={6} xs={4}>
              <label>Country</label>
              <p>{selectedDealer.dealer_account_information?.store_country || "N/A"}</p>
            </Col>
            <Col lg={12} md={6} xs={8}>
              <label>Contact Number</label>
              <p>{selectedDealer.dealer_account_information?.alternative_contact_number || "N/A"}</p>
            </Col>
          </Row>
        </div>
      </Col>

      {/* Manager Contact Details */}
      <Col lg={4} md={6}>
        <div className="w_card pb-0">
          <h3 className="w_card_title">Manager Contact Details</h3>
          <Row className="gx-3">
            <Col lg={12} md={12}>
              <label>Name</label>
              <p>{selectedDealer.dealer_account_information?.general_manager || "N/A"}</p>
            </Col>
            <Col lg={12} md={12}>
              <label>Email</label>
              <p>{selectedDealer.dealer_account_information?.general_manager_email || "N/A"}</p>
            </Col>
            <Col lg={12} md={12}>
              <label>Contact Number</label>
              <p>{selectedDealer.dealer_account_information?.general_manager_phone || "N/A"}</p>
            </Col>
          </Row>
        </div>
      </Col>

      {/* AI Bot Name */}
      <Col lg={3} md={3}>
        <div className="w_card pb-0">
          <h3 className="w_card_title">AI Bot Name</h3>
          <Row className="gx-3">
            <Col lg={12} md={12}>
              <label>AI Bot Name</label>
              <p>{selectedDealer.dealer_account_information?.ai_bot_name || "N/A"}</p>
            </Col>
          </Row>
        </div>
      </Col>

      {/* Social Media */}
      {/* <Col lg={4}>
        <div className="w_card pb-0">
          <h3 className="w_card_title">Social Media</h3>
          <Row className="gx-3">
            <Col lg={6} md={12}>
              <label>Website URL</label>
              <p>{selectedDealer.dealer_account_information?.store_website ? (
                <a
                  href={selectedDealer.dealer_account_information.store_website}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {selectedDealer.dealer_account_information.store_website}
                </a>
              ) : (
                "N/A"
              )}</p>
            </Col>
            <Col lg={6} md={12}>
              <label>Facebook Link</label>
              <p>{selectedDealer.dealer_account_information?.facebook_link ? (
                <a
                  href={selectedDealer.dealer_account_information.facebook_link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {selectedDealer.dealer_account_information.facebook_link}
                </a>
              ) : (
                "N/A"
              )}</p>
            </Col>
            <Col lg={6} md={12}>
              <label>Twitter Link</label>
              <p>{selectedDealer.dealer_account_information?.twitter_link ? (
                <a
                  href={selectedDealer.dealer_account_information.twitter_link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {selectedDealer.dealer_account_information.twitter_link}
                </a>
              ) : (
                "N/A"
              )}</p>
            </Col>
            <Col lg={6} md={12}>
              <label>Youtube Link</label>
              <p>{selectedDealer.dealer_account_information?.youtube_link ? (
                <a
                  href={selectedDealer.dealer_account_information.youtube_link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {selectedDealer.dealer_account_information.youtube_link}
                </a>
              ) : (
                "N/A"
              )}</p>
            </Col>
          </Row>
        </div>
      </Col> */}

      {/* Address */}
      <Col lg={5} md={9}>
        <div className="w_card pb-0">
          <h3 className="w_card_title">Store Opening Time</h3>
          <Row className="gx-0">
            <Col lg={4} xs={4}>
              <label>Day</label>
            </Col>
            <Col lg={4} xs={4}>
              <label>Openning Time</label>
            </Col>
            <Col lg={4} xs={4}>
              <label>Close Time</label>
            </Col>
          </Row>

          {Object.keys(selectedDealer.dealer_account_information?.weekly_availability || {}).length > 0 ? (
            Object.entries(selectedDealer.dealer_account_information.weekly_availability).map(([day, info]) => (
              <Row key={day} className="gx-0">
                <Col lg={4} xs={4}>
                  <p className="my-1 text-capitalize">{day}</p>
                </Col>
                {info.active ? (
                  <>
                    <Col lg={4} xs={4}>
                      <p className="my-1">{info.start || "N/A"}</p>
                    </Col>
                    <Col lg={4} xs={4}>
                      <p className="my-1">{info.end || "N/A"}</p>
                    </Col>
                  </>
                ) : (
                  <Col lg={8} xs={8}>
                    <p className="my-1 text-secondary">Closed</p>
                  </Col>
                )}
              </Row>
            ))
          ) : (
            <Row className="gx-0">
              <Col lg={12} xs={12}>
                <p className="text-muted py-4 text-center">No weekly availability info added</p>
              </Col>
            </Row>
          )}



          {/* <Row className="gx-3">
            <Col lg={4} xs={4}>
              <p>{selectedDealer.dealer_account_information?.weekly_availability?. || "N/A"}</p>
            </Col>
            <Col lg={4} xs={4}>
              <p>{selectedDealer.dealer_account_information?. || "N/A"}</p>
            </Col>
            <Col lg={4} xs={4}>
              <p>{selectedDealer.dealer_account_information?. || "N/A"}</p>
            </Col>
          </Row> */}
        </div>
      </Col>
    </Row>
  );
}
