// app/not-found.js
"use client";
import Link from "next/link";
import { Col, Container, Row } from "react-bootstrap";

export default function NotFound() {
  return (
    <div className="not_found_main vh-100">
        <Container>
            <Row className="justify-content-center">
                <Col xl={9} lg={9}>
                    <div className="not_found_inn">
                        <img src="Images/404.png" alt="404" className="w-100" />
                        <h1>This page could not be found.</h1>
                        <a href="/">
                            <i className="fa-regular fa-arrow-left me-2"></i>Back To Home
                        </a>
                    </div>
                </Col>
            </Row>
        </Container>

    </div>
  );
}
