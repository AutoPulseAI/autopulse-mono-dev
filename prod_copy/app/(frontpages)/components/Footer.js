"use client";
import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Nav, Image } from 'react-bootstrap';

const FALLBACK_FOOTER = [
    { label: "Home", url: "/" },
    { label: "Pricing", url: "/pricing" },
    { label: "Book A Demo", url: "/book-a-demo" },
    { label: "Contact", url: "/contact" },
];
const FALLBACK_FOOTER2 = [
    { label: "Dealer", url: "/dealer" },
    { label: "Agency", url: "/agency" },
];
const FALLBACK_LEGAL = [
    { label: "Terms of Services", url: "/terms-of-services" },
    { label: "Privacy Policy", url: "/privacy-policy" },
];

const FALLBACK_SETTINGS = {
    address: "651 DeRose ln , freehold nj 07728",
    phone: "7186075434",
    email: "contact@autopulse.ai",
    social: {},
};

const SOCIAL_ICONS = [
    { key: "facebook", icon: "fa-brands fa-square-facebook" },
    { key: "instagram", icon: "fa-brands fa-square-instagram" },
    { key: "twitter", icon: "fa-brands fa-twitter" },
    { key: "linkedin", icon: "fa-brands fa-linkedin-in" },
    { key: "youtube", icon: "fa-brands fa-youtube" },
];

const Footer = () => {
    const [footerItems, setFooterItems] = useState(FALLBACK_FOOTER);
    const [footer2Items, setFooter2Items] = useState(FALLBACK_FOOTER2);
    const [legalItems, setLegalItems] = useState(FALLBACK_LEGAL);
    const [settings, setSettings] = useState(FALLBACK_SETTINGS);

    useEffect(() => {
        fetch("/api/menu?location=footer,footer2,legal")
            .then((res) => res.json())
            .then((data) => {
                if (!data.items?.length) return;
                const byLocation = (loc) => data.items.filter((i) => i.location === loc);
                const footer = byLocation("footer");
                const footer2 = byLocation("footer2");
                const legal = byLocation("legal");
                if (footer.length) setFooterItems(footer);
                if (footer2.length) setFooter2Items(footer2);
                if (legal.length) setLegalItems(legal);
            })
            .catch(() => {});

        fetch("/api/site-settings")
            .then((res) => res.json())
            .then((data) => {
                if (data.settings) setSettings(data.settings);
            })
            .catch(() => {});
    }, []);

    const socialLinks = SOCIAL_ICONS.filter((network) => settings.social?.[network.key]);

    const linkProps = (item) =>
        item.target === "_blank" ? { target: "_blank", rel: "noopener noreferrer" } : {};

    return (
        <footer className="footer_main">
            <Container>
                <Row className="align-items-start section_padding">
                    <Col lg={9} md={8} className="">
                        <div className='footer_left'>
                            <Image
                                src="/Images/logo-w.png"
                                alt="Logo"
                                width="157"
                            />
                            {settings.address && (
                                <p>
                                    <small>
                                        <span className='d-block text-white'>Address:</span>
                                        <span className='d-block'>{settings.address}</span>
                                    </small>
                                </p>
                            )}
                            {(settings.phone || settings.email) && (
                                <p>
                                    <small>
                                        <span className='d-block text-white'>Contact:</span>
                                        {settings.phone && (
                                            <span className='d-block'><a href={`tel:${settings.phone}`}>{settings.phone}</a></span>
                                        )}
                                        {settings.email && (
                                            <span className='d-block'><a href={`mailto:${settings.email}`}>{settings.email}</a></span>
                                        )}
                                    </small>
                                </p>
                            )}
                        </div>
                    </Col>

                    <Col lg={3} md={4} className="">
                        <Row className="align-items-start">
                            <Col xs={6} className="">
                                <Nav className="flex-column">
                                    {footerItems.map((item) => (
                                        <Nav.Link
                                            key={`${item.url}-${item.label}`}
                                            href={item.url}
                                            className="text-light px-0 py-1"
                                            {...linkProps(item)}
                                        >
                                            {item.label}
                                        </Nav.Link>
                                    ))}
                                </Nav>
                            </Col>
                            <Col xs={6} className="">
                                <Nav className="flex-column">
                                    {footer2Items.map((item) => (
                                        <Nav.Link
                                            key={`${item.url}-${item.label}`}
                                            href={item.url}
                                            className="text-light px-0 py-1"
                                            {...linkProps(item)}
                                        >
                                            {item.label}
                                        </Nav.Link>
                                    ))}
                                </Nav>
                            </Col>
                        </Row>
                    </Col>

                    {socialLinks.length > 0 && (
                        <Col lg={12} md={12}>
                            <div className='footer_social'>
                                {socialLinks.map((network) => (
                                    <a
                                        key={network.key}
                                        href={settings.social[network.key]}
                                        target='_blank'
                                        rel='noopener noreferrer'
                                    >
                                        <i className={network.icon}></i>
                                    </a>
                                ))}
                            </div>
                        </Col>
                    )}
                </Row>

                <Row>
                    <Col md={6}>
                        <p className='mb-0 copyright_txt'><small>Copyright &copy; {new Date().getFullYear()} Autopulse AI. All rights reserved.</small></p>
                    </Col>
                    <Col md={6}>
                        <p className='mb-0 terms_privacy'><small>
                            {legalItems.map((item) => (
                                <a key={`${item.url}-${item.label}`} href={item.url} {...linkProps(item)}>
                                    {item.label}
                                </a>
                            ))}
                        </small></p>
                    </Col>
                </Row>
            </Container>
        </footer>
    );
};

export default Footer;
