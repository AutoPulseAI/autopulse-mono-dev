import { Offcanvas } from "react-bootstrap";
import DealerForm from "./DealerForm"; // adjust path if needed
import PropTypes from "prop-types";

const DealerOffcanvas = ({ show, handleClose, fetchDealers, editDealer, setEditDealer }) => {
    return (
        <Offcanvas show={show} onHide={handleClose} placement="end">
            <Offcanvas.Header closeButton>
                <Offcanvas.Title>
                    {editDealer?.editAccount ? "Edit Dealer Account Info" : "Edit Dealer Profile"}
                </Offcanvas.Title>
            </Offcanvas.Header>
            <Offcanvas.Body>
                <DealerForm
                    fetchDealers={fetchDealers}
                    setEditDealer={setEditDealer}
                    editDealer={editDealer}
                    handleClose={handleClose}
                />
            </Offcanvas.Body>
        </Offcanvas>
    );
};

DealerOffcanvas.propTypes = {
    show: PropTypes.bool.isRequired,
    handleClose: PropTypes.func.isRequired,
    fetchDealers: PropTypes.func.isRequired,
    editDealer: PropTypes.object.isRequired,
    setEditDealer: PropTypes.func.isRequired,
};

export default DealerOffcanvas;
