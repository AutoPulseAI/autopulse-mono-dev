"use client";

/**
 * TRIAL ROUTE — evaluate the VvvebJS editor's feel/speed vs the Puck builder.
 * VvvebJS is a standalone (vanilla-JS) editor served from /public/vvvebjs.
 * We embed it in an iframe so it runs exactly as designed, with zero React
 * integration friction. This is a throwaway comparison page, not production.
 */
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TbChevronLeft } from "react-icons/tb";

function VvvebEditor() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = searchParams.get("page");
  const editorSrc = page
    ? `/vvvebjs/editor.html?page=${encodeURIComponent(page)}`
    : "/vvvebjs/editor.html";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1050,
        display: "flex",
        flexDirection: "column",
        background: "#1f2635",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          height: 48,
          padding: "0 14px",
          color: "#fff",
          flex: "0 0 auto",
        }}
      >
        <button
          onClick={() => router.push("/admin/pages")}
          title="Back to pages"
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid #3a4356",
            background: "transparent",
            color: "#cfd6e2",
            cursor: "pointer",
          }}
        >
          <TbChevronLeft size={18} />
        </button>
        <strong style={{ fontSize: 14 }}>VvvebJS editor</strong>
        <span style={{ fontSize: 12, color: "#9aa4b6" }}>
          Saving a page publishes it to the live site
        </span>
      </header>

      <iframe
        src={editorSrc}
        title="VvvebJS editor"
        style={{ flex: 1, width: "100%", border: 0, background: "#fff" }}
      />
    </div>
  );
}

export default function VvvebTrialPage() {
  return (
    <Suspense fallback={null}>
      <VvvebEditor />
    </Suspense>
  );
}
