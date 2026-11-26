"use client";
// The "more" button of a row's menu on the list pages: a plain outline button with no caret.
import { forwardRef } from "react";

const MoreToggle = forwardRef(function MoreToggle({ children, onClick, className = "", ...rest }, ref) {
  return (
    <button type="button" ref={ref} {...rest} className={`btn btn-outline-secondary btn-sm lead_more ${className}`.trim()}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}>{children}</button>
  );
});
export default MoreToggle;
