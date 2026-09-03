import type { Metadata } from "next";
import Script from "next/script";
import { LoaderProvider } from "./context/LoaderContext"; // Import LoaderProvider
import { Noto_Sans } from 'next/font/google';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../public/fontawesome/css/all.min.css'; 
import "./globals.css";

const notoSans = Noto_Sans({
  variable: "--font",
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: "Autopulse.Ai | Keeping your dealership's lead management alive",
  description: "Keeping your dealership's lead management alive",
  other: {
    'facebook-domain-verification': '4a36g7esf57o2pdlirp8tq23qz059o',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} > */}
     
      <body className={`${notoSans.className} antialiased`} >
        {/* Meta Pixel - runs on all pages (front, login, app) for PageView and conversion tracking */}
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '2078929099398758');
            fbq('track', 'PageView');
          `}
        </Script>
        <noscript>
          <img
            height={1}
            width={1}
            style={{ display: 'none' }}
            src="https://www.facebook.com/tr?id=2078929099398758&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>

        {/* Google Tag Manager - base snippet */}
        <Script id="gtm-base" strategy="afterInteractive">
          {`
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','GTM-5GW89MQG');
          `}
        </Script>

        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-5GW89MQG"
            height={0}
            width={0}
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>

        {/* Google Analytics (GA4) - runs on all pages */}
        <Script
          id="ga4-src"
          src="https://www.googletagmanager.com/gtag/js?id=G-5QVZBCWKZJ"
          strategy="afterInteractive"
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-5QVZBCWKZJ');
          `}
        </Script>

        {/* Global error handler for cross-origin frame errors */}
        <Script
          id="cross-origin-error-handler"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              // Suppress harmless cross-origin frame errors
              window.addEventListener('error', function(e) {
                if (e.message && (
                  e.message.includes('cross-origin frame') ||
                  e.message.includes('toJSON') ||
                  e.message.includes('Blocked a frame')
                )) {
                  e.preventDefault();
                  e.stopPropagation();
                  console.warn('Suppressed cross-origin error:', e.message);
                  return false;
                }
              }, true);
            `,
          }}
        />
        <LoaderProvider>
          {/* <GlobalLoader /> */}
          {children}
        </LoaderProvider>
      </body>
    </html>
  );
}
