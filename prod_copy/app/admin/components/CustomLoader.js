// app/components/CustomLoader.js
"use client";
import { Spinner } from "react-bootstrap";

export default function CustomLoader() {
  return (
    <div className="loader_in_main text-center py-4">
      <Spinner animation="border" variant="dark" />
    </div>
  );
}
