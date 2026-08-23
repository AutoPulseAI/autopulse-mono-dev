"use client";

import { useEffect, useRef, useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\-.\s\d]{7,20}$/;

// Field rules mirror the server-side checks in /api/contact and /api/bookademo
const FORM_ENDPOINTS = [
  {
    selector: "form[data-autopulse-contact]",
    endpoint: "/api/contact",
    fields: {
      firstName: { required: true, label: "First name" },
      lastName: { required: true, label: "Last name" },
      email: { required: true, label: "Email", pattern: EMAIL_RE, patternMessage: "Please enter a valid email address" },
      phone: { required: false, label: "Phone", pattern: PHONE_RE, patternMessage: "Please enter a valid phone number" },
      message: { required: true, label: "Message", minLength: 10 },
    },
  },
  {
    selector: "form[data-autopulse-demo]",
    endpoint: "/api/bookademo",
    fields: {
      name: { required: true, label: "Name" },
      dealershipAgencyName: {
        required: true,
        label: "Dealership/Agency",
        // The placeholder option may carry its label as the value, so require
        // one of the real options (matches the API's enum)
        oneOf: ["dealership", "agency"],
        oneOfMessage: "Please select Dealership or Agency",
      },
      email: { required: true, label: "Email", pattern: EMAIL_RE, patternMessage: "Please enter a valid email address" },
      phone: { required: true, label: "Phone", pattern: PHONE_RE, patternMessage: "Please enter a valid phone number" },
      comment: { required: true, label: "Comment", minLength: 10 },
    },
  },
];

function validateField(value, rule) {
  const trimmed = (value || "").trim();
  if (rule.required && !trimmed) return `${rule.label} is required`;
  if (rule.oneOf && !rule.oneOf.includes(trimmed)) return rule.oneOfMessage;
  if (trimmed && rule.minLength && trimmed.length < rule.minLength) {
    return `${rule.label} must be at least ${rule.minLength} characters`;
  }
  if (trimmed && rule.pattern && !rule.pattern.test(trimmed)) return rule.patternMessage;
  return null;
}

function setFieldError(form, name, message) {
  const field = form.querySelector(`[name="${name}"]`);
  if (!field) return;
  let feedback = field.parentElement.querySelector(".invalid-feedback");
  if (message) {
    field.classList.add("is-invalid");
    if (!feedback) {
      feedback = document.createElement("div");
      feedback.className = "invalid-feedback";
      field.parentElement.appendChild(feedback);
    }
    feedback.textContent = message;
  } else {
    field.classList.remove("is-invalid");
    if (feedback) feedback.textContent = "";
  }
}

function clearFieldError(field) {
  field.classList.remove("is-invalid");
}

/**
 * Renders sanitized HTML saved from the VvvebJS editor. Wires up:
 * - contact form (form[data-autopulse-contact]) -> /api/contact
 * - book-a-demo form (form[data-autopulse-demo]) -> /api/bookademo
 * - Bootstrap accordions (data-bs-toggle="collapse"), since the site
 *   doesn't load Bootstrap's JS bundle
 */
export default function HtmlPageRenderer({ html }) {
  const containerRef = useRef(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cleanups = [];

    const submitForm = async (form, endpoint, fields) => {
      const data = Object.fromEntries(new FormData(form).entries());

      let hasErrors = false;
      Object.entries(fields).forEach(([name, rule]) => {
        const message = validateField(data[name], rule);
        setFieldError(form, name, message);
        if (message) hasErrors = true;
      });
      if (hasErrors) {
        form.querySelector(".is-invalid")?.focus();
        return;
      }

      Object.keys(data).forEach((key) => {
        if (typeof data[key] === "string") data[key] = data[key].trim();
        // Omit empty optional fields so backend validators don't run on ""
        if (data[key] === "") delete data[key];
      });

      const submitBtn = form.querySelector("button[type=submit]");
      const originalBtnText = submitBtn?.textContent;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending...";
      }
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Something went wrong. Please try again.");
        }
        form.reset();
        setToast({ type: "success", message: "Thanks! We'll get back to you shortly." });
      } catch (error) {
        setToast({
          type: "danger",
          message: error.message || "Something went wrong. Please try again.",
        });
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          if (originalBtnText) submitBtn.textContent = originalBtnText;
        }
      }
    };

    const findFormConfig = (form) =>
      form && FORM_ENDPOINTS.find(({ selector }) => form.matches(selector));

    // Listeners are delegated to `document` (not bound per-form) so they keep
    // working even if React recreates the rendered HTML (e.g. after a
    // hydration-mismatch recovery re-render).
    const handleDocumentSubmit = (event) => {
      const config = findFormConfig(event.target.closest("form"));
      if (!config) return;
      event.preventDefault();
      submitForm(event.target.closest("form"), config.endpoint, config.fields);
    };

    const handleDocumentInput = (event) => {
      const field = event.target;
      if (field.name && findFormConfig(field.closest("form"))) {
        clearFieldError(field);
      }
    };

    const handleDocumentChange = (event) => {
      const field = event.target;
      if (field.name && findFormConfig(field.closest("form"))) {
        clearFieldError(field);
      }
    };

    // Suppress native validation bubbles; our handler shows inline errors
    const applyNovalidate = () => {
      FORM_ENDPOINTS.forEach(({ selector }) => {
        document.querySelectorAll(selector).forEach((form) => form.setAttribute("novalidate", ""));
      });
    };
    applyNovalidate();
    const novalidateObserver = new MutationObserver(applyNovalidate);
    novalidateObserver.observe(container, { childList: true, subtree: true });
    cleanups.push(() => novalidateObserver.disconnect());

    document.addEventListener("submit", handleDocumentSubmit, true);
    document.addEventListener("input", handleDocumentInput, true);
    document.addEventListener("change", handleDocumentChange, true);
    cleanups.push(() => document.removeEventListener("submit", handleDocumentSubmit, true));
    cleanups.push(() => document.removeEventListener("input", handleDocumentInput, true));
    cleanups.push(() => document.removeEventListener("change", handleDocumentChange, true));

    const handleCollapseClick = (event) => {
      const trigger = event.target.closest('[data-bs-toggle="collapse"]');
      if (!trigger || !container.contains(trigger)) return;
      event.preventDefault();

      const targetSelector = trigger.getAttribute("data-bs-target") || trigger.getAttribute("href");
      const target = targetSelector ? container.querySelector(targetSelector) : null;
      if (!target) return;

      const isOpen = target.classList.contains("show");

      const parentSelector = target.getAttribute("data-bs-parent");
      const parent = parentSelector ? container.querySelector(parentSelector) : null;
      if (parent && !isOpen) {
        parent.querySelectorAll(":scope .accordion-collapse.show").forEach((el) => {
          el.classList.remove("show");
          const otherTrigger = container.querySelector(`[data-bs-target="#${el.id}"]`);
          if (otherTrigger) {
            otherTrigger.classList.add("collapsed");
            otherTrigger.setAttribute("aria-expanded", "false");
          }
        });
      }

      target.classList.toggle("show", !isOpen);
      trigger.classList.toggle("collapsed", isOpen);
      trigger.setAttribute("aria-expanded", String(!isOpen));
    };

    container.addEventListener("click", handleCollapseClick);
    cleanups.push(() => container.removeEventListener("click", handleCollapseClick));

    const initPricingTabs = () => {
      container.querySelectorAll("[data-pricing-tabs]").forEach((tabsRoot) => {
        const setPeriod = (period) => {
          tabsRoot.querySelectorAll("[data-pricing-period]").forEach((btn) => {
            const active = btn.getAttribute("data-pricing-period") === period;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-selected", String(active));
          });
          container.querySelectorAll("[data-price-monthly]").forEach((priceEl) => {
            const monthly = priceEl.getAttribute("data-price-monthly");
            const yearly = priceEl.getAttribute("data-price-yearly");
            priceEl.textContent = period === "yearly" ? yearly : monthly;
          });
          container.querySelectorAll("[data-period-suffix]").forEach((suffixEl) => {
            suffixEl.textContent = period === "yearly" ? "/yr" : "/mo";
          });
        };

        tabsRoot.querySelectorAll("[data-pricing-period]").forEach((btn) => {
          if (btn.dataset.pricingBound) return;
          btn.dataset.pricingBound = "true";
          btn.addEventListener("click", () => setPeriod(btn.getAttribute("data-pricing-period")));
        });
      });
    };
    initPricingTabs();
    const pricingObserver = new MutationObserver(initPricingTabs);
    pricingObserver.observe(container, { childList: true, subtree: true });
    cleanups.push(() => pricingObserver.disconnect());

    return () => cleanups.forEach((fn) => fn());
  }, [html]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <>
      <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />
      {toast && (
        <div
          className={`alert alert-${toast.type} position-fixed bottom-0 end-0 m-4`}
          style={{ zIndex: 2000 }}
          role="alert"
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
