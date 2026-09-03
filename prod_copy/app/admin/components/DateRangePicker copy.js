"use client";
import { useState, useRef, useEffect } from 'react';
import { Button, OverlayTrigger, Popover } from "react-bootstrap";
import { format, subDays } from "date-fns";
import { DateRange } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import './daterangepicker.css';

export default function DateRangePickerComponent({ onDateRangeChange, size }) {
    const [state, setState] = useState([
        {
            startDate: null,
            endDate: null,
            key: 'selection'
        }
    ]);
    const [show, setShow] = useState(false);
    const [showPicker, setShowPicker] = useState(false);
    const wrapperRef = useRef(null);

    // Close when clicking outside
    useEffect(() => {
        function handleClickOutside(e) {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
                setShowPicker(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (ranges) => {
        setState([ranges.selection]);
    };

    // const handleApply = () => {
    //     onDateRangeChange(state[0].startDate, state[0].endDate);
    //     setShowPicker(false);
    // };
    const handleApply = () => {
        if (typeof onDateRangeChange === 'function') {
            onDateRangeChange({
                startDate: state[0].startDate,
                endDate: state[0].endDate
            });
        } else {
            console.warn("onDateRangeChange is not a function");
        }
        setShowPicker(false);
    };



    const handleQuickSelect = (days) => {
        const end = new Date();
        const start = subDays(end, days);
        setState([{
            startDate: start,
            endDate: end,
            key: 'selection'
        }]);
        onDateRangeChange(start, end);
        setShowPicker(false);
    };

    const handleClear = () => {
        setState([{
            startDate: null,
            endDate: null,
            key: 'selection'
        }]);
        onDateRangeChange(null, null);
        setShowPicker(false);
    };

    return (
        // <OverlayTrigger
        //     trigger="click"
        //     placement="bottom-end"
        //     show={show}
        //     onToggle={setShow}
        //     overlay={
        //         <Popover className="p-3" style={{ width: "100%", maxWidth: "600px" }}>
        //             <Popover.Header as="h3">Select Date Range</Popover.Header>
        //             <Popover.Body>
        //                 <div className="mb-3">
        <div ref={wrapperRef} className="position-relative inline-block">
            <Button
                variant='light'
                className="border p-2 rounded bg-white w-100"
                onClick={() => setShowPicker((v) => !v)}
                size='sm'
            >
                <i className="fa-regular fa-calendar me-2"></i>
                {state[0].startDate && state[0].endDate
                    ? `${format(state[0].startDate, 'MMM d')} - ${format(state[0].endDate, 'MMM d')}`
                    : 'Date Range'}
            </Button>

            {showPicker && (
                <div className="daterangepicker">

                    <DateRange
                        editableDateInputs={true}
                        onChange={handleSelect}
                        moveRangeOnFirstSelection={false}
                        ranges={state}
                        rangeColors={['#0272b4']}
                        direction="vertical"
                        showDateDisplay={false}
                    />

                    <Button variant="primary" size="sm" className="w-100" onClick={handleApply}>
                        Apply
                    </Button>
                    <Button variant="outline-secondary" size="sm" onClick={handleClear}>
                        Clear
                    </Button>
                </div>
            )}
        </div>
        //         </div>
        //         <div className="d-flex justify-content-between mb-3">
        //             <Button variant="outline-secondary" size="sm" onClick={() => handleQuickSelect(7)}>
        //                 Last 7 Days
        //             </Button>
        //             <Button variant="outline-secondary" size="sm" onClick={() => handleQuickSelect(30)}>
        //                 Last 30 Days
        //             </Button>
        //             <Button variant="outline-secondary" size="sm" onClick={handleClear}>
        //                 Clear
        //             </Button>
        //         </div>
        //         <Button variant="primary" size="sm" className="w-100" onClick={handleApply}>
        //             Apply
        //         </Button>
        //     </Popover.Body>
        // </Popover>
        //         }
        //     >
        // <Button variant="outline-secondary w-100" size={size}>
        //     <i className="fa-regular fa-calendar me-2"></i>
        //     {state[0].startDate && state[0].endDate
        //         ? `${format(state[0].startDate, 'MMM d')} - ${format(state[0].endDate, 'MMM d')}`
        //         : 'Date Range'}
        // </Button>
        //     </OverlayTrigger >
    );
}