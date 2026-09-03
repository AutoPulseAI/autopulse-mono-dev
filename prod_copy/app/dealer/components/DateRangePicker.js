"use client";
import { useState, useRef, useEffect } from 'react';
import { Button } from "react-bootstrap";
import { format, subDays } from "date-fns";
import { DateRange } from 'react-date-range';
import moment from 'moment-timezone';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import './daterangepicker.css';

export default function DateRangePickerComponent({ onDateRangeChange, size, dateRange, timezone }) {
    const dealerTimezone = timezone || 'America/New_York';
    
    // Convert UTC dates to dealer timezone for display
    // The key is to create a Date object that represents the correct calendar date
    // when interpreted in the browser's local timezone
    const convertToDealerTimezone = (utcDate) => {
        if (!utcDate) return null;
        // Parse the UTC date and convert to dealer timezone
        const dealerMoment = moment.utc(utcDate).tz(dealerTimezone);
        // Get the date string (YYYY-MM-DD) - this is the calendar date in dealer timezone
        const dateStr = dealerMoment.format('YYYY-MM-DD');
        // Parse this date string as if it's in dealer timezone (to get the correct calendar date)
        const dateOnlyMoment = moment.tz(dateStr, 'YYYY-MM-DD', dealerTimezone);
        // Get the year, month, and day components from the date-only moment
        const year = dateOnlyMoment.year();
        const month = dateOnlyMoment.month(); // 0-indexed (0 = January)
        const day = dateOnlyMoment.date();
        // Create a new Date object using these components in browser's local timezone
        // This ensures the calendar shows the correct date
        return new Date(year, month, day);
    };
    
    // Convert dealer timezone dates to UTC for storage/API
    const convertToUTC = (dealerDate, isEndDate = false) => {
        if (!dealerDate) return null;
        // Interpret the selected date as being in dealer timezone, then convert to UTC
        // Extract just the date part (YYYY-MM-DD) and interpret it in dealer timezone
        const dateStr = moment(dealerDate).format('YYYY-MM-DD');
        const dealerMoment = moment.tz(dateStr, 'YYYY-MM-DD', dealerTimezone);
        // Use endOf('day') for end dates to include the entire day, startOf('day') for start dates
        return isEndDate 
            ? dealerMoment.endOf('day').utc().toDate()
            : dealerMoment.startOf('day').utc().toDate();
    };
    
    const [state, setState] = useState([
        {
            startDate: dateRange?.startDate ? convertToDealerTimezone(dateRange.startDate) : null,
            endDate: dateRange?.endDate ? convertToDealerTimezone(dateRange.endDate) : null,
            key: 'selection'
        }
    ]);
    const [showPicker, setShowPicker] = useState(false);
    const wrapperRef = useRef(null);

    // Update local state when dateRange prop changes
    useEffect(() => {
        if (dateRange?.startDate && dateRange?.endDate) {
            const convertedStart = convertToDealerTimezone(dateRange.startDate);
            const convertedEnd = convertToDealerTimezone(dateRange.endDate);
            setState([{
                startDate: convertedStart,
                endDate: convertedEnd,
                key: 'selection'
            }]);
        } else if (dateRange?.startDate === null && dateRange?.endDate === null) {
            // Handle explicit clearing
            setState([{
                startDate: null,
                endDate: null,
                key: 'selection'
            }]);
        }
    }, [dateRange?.startDate, dateRange?.endDate, dealerTimezone]);

    // Close picker on outside click
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

    const handleApply = () => {
        if (typeof onDateRangeChange === 'function') {
            // Convert selected dates (in dealer timezone) to UTC for API
            // Use startOf('day') for start date and endOf('day') for end date
            const startDateUTC = state[0].startDate ? convertToUTC(state[0].startDate, false) : null;
            const endDateUTC = state[0].endDate ? convertToUTC(state[0].endDate, true) : null;
            
            console.log('📅 DateRangePicker - Sending dates:');
            console.log('  Selected start (browser):', state[0].startDate);
            console.log('  Selected end (browser):', state[0].endDate);
            console.log('  Converted startDateUTC:', startDateUTC?.toISOString());
            console.log('  Converted endDateUTC:', endDateUTC?.toISOString());
            console.log('  Dealer timezone:', dealerTimezone);
            
            onDateRangeChange({
                startDate: startDateUTC,
                endDate: endDateUTC
            });
        } else {
            console.warn("onDateRangeChange is not a function");
        }
        setShowPicker(false);
    };

    const handleQuickSelect = (days) => {
        // Get current date in dealer timezone
        const nowInDealerTz = moment.tz(dealerTimezone);
        const endYear = nowInDealerTz.year();
        const endMonth = nowInDealerTz.month();
        const endDay = nowInDealerTz.date();
        const end = new Date(endYear, endMonth, endDay);
        
        const startMoment = nowInDealerTz.clone().subtract(days, 'days');
        const startYear = startMoment.year();
        const startMonth = startMoment.month();
        const startDay = startMoment.date();
        const start = new Date(startYear, startMonth, startDay);
        
        const newRange = {
            startDate: start,
            endDate: end,
            key: 'selection'
        };
        setState([newRange]);
        
        // Convert to UTC for API - use endOf('day') for end date
        const startDateUTC = convertToUTC(start, false);
        const endDateUTC = convertToUTC(end, true);
        onDateRangeChange({ startDate: startDateUTC, endDate: endDateUTC });
        setShowPicker(false);
    };

    const handleClear = () => {
        const clearedRange = {
            startDate: null,
            endDate: null,
            key: 'selection'
        };
        setState([clearedRange]);
        onDateRangeChange({ startDate: null, endDate: null });
        setShowPicker(false);
    };

    return (
        <div ref={wrapperRef} className="position-relative inline-block">
            <Button
                variant='light'
                className="border p-2 rounded bg-white w-100 text-nowrap"
                onClick={() => setShowPicker(prev => !prev)}
                size='sm'
            >
                {state[0]?.startDate && state[0]?.endDate
                    ? `${format(state[0].startDate, 'MMM d')} - ${format(state[0].endDate, 'MMM d')}`
                    : (<><i className="fa-regular fa-calendar me-1"></i>Date Range</>)}
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

                    <div className='d-flex gap-1 mb-3 justify-content-center'>
                        <Button variant="custom" size="sm" onClick={handleApply}>Apply</Button>
                        <Button variant="outline-secondary" size="sm" onClick={handleClear}>Clear</Button>
                    </div>
                </div>
            )}
        </div>
    );
}

// "use client";
// import { useState } from "react";
// import { Button, OverlayTrigger, Popover } from "react-bootstrap";
// import { format, subDays } from "date-fns";
// import { DateRange } from 'react-date-range';
// import 'react-date-range/dist/styles.css';
// import 'react-date-range/dist/theme/default.css';
// import './daterangepicker.css';

// export default function DateRangePickerComponent({ onDateRangeChange, size }) {
//     const [state, setState] = useState([
//         {
//             startDate: null,
//             endDate: null,
//             key: 'selection'
//         }
//     ]);
//     const [show, setShow] = useState(false);

//     const handleSelect = (ranges) => {
//         setState([ranges.selection]);
//     };

//     const handleApply = () => {
//         onDateRangeChange(state[0].startDate, state[0].endDate);
//         setShow(false);
//     };

//     const handleQuickSelect = (days) => {
//         const end = new Date();
//         const start = subDays(end, days);
//         setState([{
//             startDate: start,
//             endDate: end,
//             key: 'selection'
//         }]);
//         onDateRangeChange(start, end);
//         setShow(false);
//     };

//     const handleClear = () => {
//         setState([{
//             startDate: null,
//             endDate: null,
//             key: 'selection'
//         }]);
//         onDateRangeChange(null, null);
//         setShow(false);
//     };

//     return (
//         <OverlayTrigger
//             trigger="click"
//             placement="bottom-end"
//             show={show}
//             onToggle={setShow}
//             overlay={
//                 <Popover className="p-3" style={{ width: "100%", maxWidth: "600px" }}>
//                     <Popover.Header as="h3">Select Date Range</Popover.Header>
//                     <Popover.Body>
//                         <div className="mb-3">
//                             <DateRange
//                                 editableDateInputs={true}
//                                 onChange={handleSelect}
//                                 moveRangeOnFirstSelection={false}
//                                 ranges={state}
//                                 rangeColors={['#0272b4']}
//                             />
//                         </div>
//                         <div className="d-flex justify-content-between mb-3">
//                             <Button variant="outline-secondary" size="sm" onClick={() => handleQuickSelect(7)}>
//                                 Last 7 Days
//                             </Button>
//                             <Button variant="outline-secondary" size="sm" onClick={() => handleQuickSelect(30)}>
//                                 Last 30 Days
//                             </Button>
//                             <Button variant="outline-secondary" size="sm" onClick={handleClear}>
//                                 Clear
//                             </Button>
//                         </div>
//                         <Button variant="custom" size="sm" className="w-100" onClick={handleApply}>
//                             Apply
//                         </Button>
//                     </Popover.Body>
//                 </Popover>
//             }
//         >
//             <Button variant="white" size='sm' className="border rounded bg-white text_dark w-100">
//                 <i className="fa-regular fa-calendar me-2"></i>
//                 {state[0].startDate && state[0].endDate
//                     ? `${format(state[0].startDate, 'MMM d')} - ${format(state[0].endDate, 'MMM d')}`
//                     : 'Date Range'}
//             </Button>
//         </OverlayTrigger>
//     );
// }