"use client";

import { useState } from "react";
import { Modal, Button, Form, Alert } from "react-bootstrap";
import useFetch from "../../hooks/useFetch";

export default function ProfileModal({ user, onClose }) {
  const { fetchData, error: fetchError, loading } = useFetch();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({});

  const validateInputs = () => {
    let newErrors = {};
    if (!name.trim()) newErrors.name = "Name is required.";
    if (!email.trim()) newErrors.email = "Email is required.";
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = "Invalid email format.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!validateInputs()) return;

    setMessage("");
    const res = await fetchData("/api/auth/update-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, name, email }),
    });

    const data = await res.json();
    if (res.ok) {
      setMessage("Profile updated successfully!");
      setTimeout(() => onClose(), 2000);
    } else {
      setMessage(data.message);
    }
  };

  return (
    <Modal show={true} onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Edit Profile</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {message && <Alert variant="success">{message}</Alert>}
        <Form onSubmit={handleUpdateProfile}>
          <Form.Group className="mb-3">
            <Form.Label>Name</Form.Label>
            <Form.Control
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              isInvalid={!!errors.name}
            />
            <Form.Control.Feedback type="invalid">{errors.name}</Form.Control.Feedback>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Email</Form.Label>
            <Form.Control
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              isInvalid={!!errors.email}
            />
            <Form.Control.Feedback type="invalid">{errors.email}</Form.Control.Feedback>
          </Form.Group>

          <Form.Group className="text-center mt-4">
            <Button variant="custom" type="submit">Save Changes</Button>
            <Button variant="secondary" className="ms-2" onClick={onClose}>Cancel</Button>
          </Form.Group>
        </Form>
      </Modal.Body>
    </Modal>


  );
}



// "use client";
// import { useState } from "react";

// export default function ProfileModal({ user, onClose }) {
//   const [name, setName] = useState(user?.name || "");
//   const [email, setEmail] = useState(user?.email || "");
//   const [message, setMessage] = useState("");
//   const [errors, setErrors] = useState({});

//   const validateInputs = () => {
//     let newErrors = {};
//     if (!name.trim()) newErrors.name = "Name is required.";
//     if (!email.trim()) newErrors.email = "Email is required.";
//     else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = "Invalid email format.";
//     setErrors(newErrors);
//     return Object.keys(newErrors).length === 0;
//   };

//   const handleUpdateProfile = async (e) => {
//     e.preventDefault();
//     if (!validateInputs()) return;

//     setMessage("");
//     const res = await fetch("/api/auth/update-profile", {
//       method: "PUT",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ userId: user._id, name, email }),
//     });

//     const data = await res.json();
//     if (res.ok) {
//       setMessage("Profile updated successfully!");
//       setTimeout(() => onClose(), 2000);
//     } else {
//       setMessage(data.message);
//     }
//   };

//   return (
//     <div className="modal-overlay">
//       <div className="modal">
//         <h2 className="modal-title">Edit Profile</h2>
//         {message && <p className="modal-message success">{message}</p>}
//         <form onSubmit={handleUpdateProfile} className="modal-form">
//           <label className="modal-label">Name</label>
//           <input
//             type="text"
//             className="modal-input"
//             value={name}
//             onChange={(e) => setName(e.target.value)}
//           />
//           {errors.name && <p className="modal-error">{errors.name}</p>}

//           <label className="modal-label">Email</label>
//           <input
//             type="email"
//             className="modal-input"
//             value={email}
//             onChange={(e) => setEmail(e.target.value)}
//           />
//           {errors.email && <p className="modal-error">{errors.email}</p>}

//           <div className="modal-buttons">
//             <button type="submit" className="modal-button update">Update</button>
//             <button type="button" className="modal-button cancel" onClick={onClose}>Cancel</button>
//           </div>
//         </form>
//       </div>
//     </div>
//   );
// }
