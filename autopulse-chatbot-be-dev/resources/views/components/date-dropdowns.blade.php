@props([
    'name' => 'date',
    'id' => 'date-dropdowns',
    'class' => '',
    'required' => false,
    'defaultYear' => null,
    'defaultMonth' => 5, // Default to May
    'defaultDate' => 2,  // Default to 2nd of month
    'minYear' => 1900,
    'maxYear' => null
])

@php
    // Set default year to current year if not specified
    $defaultYear = $defaultYear ?? date('Y');
    $maxYear = $maxYear ?? (date('Y') + 10);
    
    // Generate years array
    $years = range($minYear, $maxYear);
    
    // Generate months array
    $months = [
        1 => 'January', 2 => 'February', 3 => 'March', 4 => 'April',
        5 => 'May', 6 => 'June', 7 => 'July', 8 => 'August',
        9 => 'September', 10 => 'October', 11 => 'November', 12 => 'December'
    ];
    
    // Generate dates array (1-31)
    $dates = range(1, 31);
@endphp

<div class="date-dropdowns-container {{ $class }}" id="{{ $id }}">
    <div class="row">
        <!-- Year Dropdown -->
        <div class="col-md-4">
            <label for="{{ $name }}_year" class="form-label">Year</label>
            <select 
                name="{{ $name }}_year" 
                id="{{ $name }}_year" 
                class="form-select date-year-select"
                {{ $required ? 'required' : '' }}
                onchange="updateMonthDropdown('{{ $name }}')"
            >
                <option value="">Select Year</option>
                @foreach($years as $year)
                    <option value="{{ $year }}" {{ $year == $defaultYear ? 'selected' : '' }}>
                        {{ $year }}
                    </option>
                @endforeach
            </select>
        </div>
        
        <!-- Month Dropdown -->
        <div class="col-md-4">
            <label for="{{ $name }}_month" class="form-label">Month</label>
            <select 
                name="{{ $name }}_month" 
                id="{{ $name }}_month" 
                class="form-select date-month-select"
                {{ $required ? 'required' : '' }}
                onchange="updateDateDropdown('{{ $name }}')"
            >
                <option value="">Select Month</option>
                @foreach($months as $monthNum => $monthName)
                    <option value="{{ $monthNum }}" {{ $monthNum == $defaultMonth ? 'selected' : '' }}>
                        {{ $monthName }}
                    </option>
                @endforeach
            </select>
        </div>
        
        <!-- Date Dropdown -->
        <div class="col-md-4">
            <label for="{{ $name }}_date" class="form-label">Date</label>
            <select 
                name="{{ $name }}_date" 
                id="{{ $name }}_date" 
                class="form-select date-date-select"
                {{ $required ? 'required' : '' }}
            >
                <option value="">Select Date</option>
                @foreach($dates as $date)
                    <option value="{{ $date }}" {{ $date == $defaultDate ? 'selected' : '' }}>
                        {{ $date }}
                    </option>
                @endforeach
            </select>
        </div>
    </div>
    
    <!-- Hidden input for combined date value -->
    <input type="hidden" name="{{ $name }}" id="{{ $name }}_combined" value="">
</div>

<script>
// Initialize date dropdowns when page loads
document.addEventListener('DOMContentLoaded', function() {
    initializeDateDropdowns('{{ $name }}');
});

function initializeDateDropdowns(name) {
    // Set initial values
    updateMonthDropdown(name);
    updateDateDropdown(name);
    updateCombinedDate(name);
    
    // Add event listeners
    document.getElementById(name + '_year').addEventListener('change', function() {
        updateMonthDropdown(name);
        updateCombinedDate(name);
    });
    
    document.getElementById(name + '_month').addEventListener('change', function() {
        updateDateDropdown(name);
        updateCombinedDate(name);
    });
    
    document.getElementById(name + '_date').addEventListener('change', function() {
        updateCombinedDate(name);
    });
}

function updateMonthDropdown(name) {
    const yearSelect = document.getElementById(name + '_year');
    const monthSelect = document.getElementById(name + '_month');
    const dateSelect = document.getElementById(name + '_date');
    
    if (yearSelect.value) {
        // Enable month selection and default to May
        monthSelect.disabled = false;
        monthSelect.value = 5; // Default to May
        monthSelect.dispatchEvent(new Event('change'));
    } else {
        monthSelect.disabled = true;
        monthSelect.value = '';
        dateSelect.disabled = true;
        dateSelect.value = '';
    }
}

function updateDateDropdown(name) {
    const yearSelect = document.getElementById(name + '_year');
    const monthSelect = document.getElementById(name + '_month');
    const dateSelect = document.getElementById(name + '_date');
    
    if (monthSelect.value) {
        // Enable date selection and default to 2nd
        dateSelect.disabled = false;
        dateSelect.value = 2; // Default to 2nd of month
        
        // Update available dates based on month and year
        updateAvailableDates(name);
    } else {
        dateSelect.disabled = true;
        dateSelect.value = '';
    }
}

function updateAvailableDates(name) {
    const yearSelect = document.getElementById(name + '_year');
    const monthSelect = document.getElementById(name + '_month');
    const dateSelect = document.getElementById(name + '_date');
    
    const year = parseInt(yearSelect.value);
    const month = parseInt(monthSelect.value);
    
    if (year && month) {
        // Get the last day of the selected month
        const lastDay = new Date(year, month, 0).getDate();
        
        // Clear existing options
        dateSelect.innerHTML = '<option value="">Select Date</option>';
        
        // Add date options (1 to last day of month)
        for (let day = 1; day <= lastDay; day++) {
            const option = document.createElement('option');
            option.value = day;
            option.textContent = day;
            if (day === 2) { // Default to 2nd
                option.selected = true;
            }
            dateSelect.appendChild(option);
        }
    }
}

function updateCombinedDate(name) {
    const yearSelect = document.getElementById(name + '_year');
    const monthSelect = document.getElementById(name + '_month');
    const dateSelect = document.getElementById(name + '_date');
    const combinedInput = document.getElementById(name + '_combined');
    
    if (yearSelect.value && monthSelect.value && dateSelect.value) {
        // Format: YYYY-MM-DD
        const year = yearSelect.value;
        const month = monthSelect.value.padStart(2, '0');
        const date = dateSelect.value.padStart(2, '0');
        combinedInput.value = `${year}-${month}-${date}`;
    } else {
        combinedInput.value = '';
    }
}

// Function to get the selected date value
function getSelectedDate(name) {
    return document.getElementById(name + '_combined').value;
}

// Function to set a specific date
function setDate(name, year, month, date) {
    const yearSelect = document.getElementById(name + '_year');
    const monthSelect = document.getElementById(name + '_month');
    const dateSelect = document.getElementById(name + '_date');
    
    if (yearSelect && monthSelect && dateSelect) {
        yearSelect.value = year;
        monthSelect.dispatchEvent(new Event('change'));
        
        // Wait for month dropdown to update, then set month and date
        setTimeout(() => {
            monthSelect.value = month;
            monthSelect.dispatchEvent(new Event('change'));
            
            setTimeout(() => {
                dateSelect.value = date;
                dateSelect.dispatchEvent(new Event('change'));
            }, 100);
        }, 100);
    }
}
</script>

<style>
.date-dropdowns-container .form-label {
    font-weight: 500;
    margin-bottom: 0.5rem;
}

.date-dropdowns-container .form-select {
    margin-bottom: 1rem;
}

.date-dropdowns-container .form-select:disabled {
    background-color: #e9ecef;
    opacity: 0.65;
}

@media (max-width: 768px) {
    .date-dropdowns-container .col-md-4 {
        margin-bottom: 1rem;
    }
}
</style>

