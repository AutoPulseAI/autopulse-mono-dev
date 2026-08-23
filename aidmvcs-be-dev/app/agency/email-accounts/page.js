"use client";
import { useState, useEffect } from "react";
import EmailAccountList from "./components/EmailAccountList";
import EmailAccountForm from "./components/EmailAccountForm";
import { useUser } from "../context/UserContext";
import { Button } from "react-bootstrap";
import useFetch from "../../hooks/useFetch";

export default function EmailAccountPage() {
    const [editEmailAccount, setEditEmailAccount] = useState(null); // null = Add Mode, object = Edit Mode
    const [emailAccounts, setEmailAccounts] = useState([]);
    const { fetchData, error: fetchError, loading } = useFetch();
    // Get the user object from the UserContext
    const { user,dealerParent } = useUser();

    useEffect(() => {
        if (dealerParent?.id) {
            fetchEmailAccounts();
        }
    }, [dealerParent]); // Fetch email accounts whenever the user changes

    const fetchEmailAccounts = async () => {
        if (!dealerParent?.id) {
            console.error("User is not defined");
            return; // Exit the function if user is not defined
        }

        const res = await fetchData(`/api/email-accounts?dealer_id=${dealerParent.id}`, {headers: {
          'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
        }});
        const data = await res.json();
        setEmailAccounts(data);
    };

    // Function to handle adding a new email account
    const handleAddEmailAccount = () => {
        setEditEmailAccount({}); // Set editEmailAccount to an empty object for Add Mode
    };

    // Function to handle editing an existing email account
    const handleEditEmailAccount = (account) => {
        setEditEmailAccount(account); // Set editEmailAccount to the selected account for Edit Mode
    };

    return (
        <>
            <div className="page_content">
                {/* Page Header */}
                <div className="page_head">
                    <div className="row align-items-center">
                        <div className="col col-12">
                            <div className="d-flex align-items-center">
                                {editEmailAccount && (
                                    <Button variant="secondary" size="sm" onClick={() => setEditEmailAccount(null)} className="me-2"><i className="fa-solid fa-arrow-left"></i></Button>
                                )}
                                <h3 className="page_title mb-0">Manage Email Accounts</h3>
                                {!editEmailAccount && (
                                    <Button variant="custom" size="sm" onClick={handleAddEmailAccount} className="ms-auto">
                                        <i className="fa-solid fa-plus me-2"></i>Add Email Account
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="page_body">

                    {editEmailAccount ? (
                        <EmailAccountForm
                            setEditEmailAccount={setEditEmailAccount}
                            editEmailAccount={editEmailAccount}
                            fetchEmailAccounts={fetchEmailAccounts}
                            user={dealerParent} // Pass the user object
                        />
                    ) : (
                        <EmailAccountList
                            setEditEmailAccount={handleEditEmailAccount} // Pass the edit handler
                            emailAccounts={emailAccounts}
                            fetchEmailAccounts={fetchEmailAccounts}
                        />
                    )}

                </div>
            </div>
        </>

    );
}