"use client";
import 'aos/dist/aos.css';
import AOS from 'aos';
import { useEffect } from 'react';

import Header from './components/Header';
import Footer from './components/Footer';
import './front.css';

export default function FrontpagesLayout({ children }) {
    useEffect(() => {
        AOS.init({
            duration: 1000, // Animation duration in ms
            once: true, // Whether animation should happen only once
        });
    }, []);
    return (
        <>
            <Header />
            <main>{children}</main>
            <Footer />
        </>
    );
}