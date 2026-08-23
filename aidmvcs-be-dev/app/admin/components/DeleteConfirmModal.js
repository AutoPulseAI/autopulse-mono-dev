"use client";
import { Modal, Button } from "react-bootstrap";

export default function DeleteConfirmModal({
    show,
    onHide,
    onConfirm,
    title = "Confirm Delete",
    body = "Are you sure you want to delete this item?",
    confirmText = "Yes, Delete it",
    cancelText = "Cancel",
    confirmVariant = "danger"
}) {
    return (
        <Modal show={show} onHide={onHide} centered>
            <button
                type="button"
                className="btn-close position-absolute"
                aria-label="Close"
                onClick={onHide}
                style={{ top: "1rem", right: "1rem", zIndex: 1051, backgroundColor: "transparant" }}
            ></button>

            <Modal.Body className="text-center">
                <div className="mb-2">
                    <i className="fa-regular fa-trash-xmark fa-2x text-danger" style={{ background: "#FFEEEC", width: "3.8rem", height: "3.8rem", fontSize: "1.6rem", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}></i>
                </div>

                <Modal.Title className="mb-1">{title}</Modal.Title>
                <p className="mb-0">{body}</p>

            </Modal.Body>

            <Modal.Footer className="border-0 pt-0 justify-content-center bg_gray">
                <Button variant="secondary" onClick={onHide} className="btn-sm">
                    {cancelText}
                </Button>
                <Button variant={confirmVariant} onClick={onConfirm} className="btn-sm">
                    {confirmText}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
