@extends('layouts.app')

@section('content')
<div class="container">
    <div class="row justify-content-center">
        <div class="col-md-8">
            <div class="card">
                <div class="card-header">
                    <h4>📅 Date Selection Example</h4>
                </div>
                <div class="card-body">
                    <form method="POST" action="{{ route('example.store') }}">
                        @csrf
                        
                        <div class="mb-3">
                            <label for="name" class="form-label">Name</label>
                            <input type="text" class="form-control" id="name" name="name" required>
                        </div>
                        
                        <div class="mb-3">
                            <label for="email" class="form-label">Email</label>
                            <input type="email" class="form-control" id="email" name="email" required>
                        </div>
                        
                        <!-- Date Dropdowns Component -->
                        <div class="mb-3">
                            <label class="form-label">Birth Date</label>
                            <x-date-dropdowns 
                                name="birth_date" 
                                id="birth-date-dropdowns"
                                :defaultYear="1990"
                                :defaultMonth="5"
                                :defaultDate="2"
                                required
                            />
                        </div>
                        
                        <!-- Another Date Component with Different Defaults -->
                        <div class="mb-3">
                            <label class="form-label">Appointment Date</label>
                            <x-date-dropdowns 
                                name="appointment_date" 
                                id="appointment-date-dropdowns"
                                :defaultYear="2024"
                                :defaultMonth="6"
                                :defaultDate="15"
                                required
                            />
                        </div>
                        
                        <div class="mb-3">
                            <label for="notes" class="form-label">Notes</label>
                            <textarea class="form-control" id="notes" name="notes" rows="3"></textarea>
                        </div>
                        
                        <div class="d-flex justify-content-between">
                            <button type="button" class="btn btn-secondary" onclick="setToday()">
                                Set to Today
                            </button>
                            <button type="submit" class="btn btn-primary">
                                Submit Form
                            </button>
                        </div>
                    </form>
                    
                    <hr class="my-4">
                    
                    <div class="row">
                        <div class="col-md-6">
                            <h5>Selected Dates:</h5>
                            <div class="mb-2">
                                <strong>Birth Date:</strong> 
                                <span id="birth-date-result">Not set</span>
                            </div>
                            <div class="mb-2">
                                <strong>Appointment Date:</strong> 
                                <span id="appointment-date-result">Not set</span>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <h5>Quick Actions:</h5>
                            <button class="btn btn-sm btn-outline-primary me-2" onclick="setSpecificDate('birth_date', 1985, 8, 20)">
                                Set Birth: Aug 20, 1985
                            </button>
                            <button class="btn btn-sm btn-outline-success" onclick="setSpecificDate('appointment_date', 2024, 12, 25)">
                                Set Appt: Dec 25, 2024
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<script>
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the date dropdowns
    initializeDateDropdowns('birth_date');
    initializeDateDropdowns('appointment_date');
});

function setToday() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1; // JavaScript months are 0-indexed
    const date = today.getDate();
    
    setSpecificDate('birth_date', year, month, date);
    setSpecificDate('appointment_date', year, month, date);
}

function setSpecificDate(name, year, month, date) {
    setDate(name, year, month, date);
}

// The following functions are provided by the date-dropdowns component
// They will be available after the component is loaded

function initializeDateDropdowns(name) {
    if (typeof updateMonthDropdown === 'function') {
        updateMonthDropdown(name);
        updateDateDropdown(name);
        updateCombinedDate(name);
        
        // Add event listeners
        const yearSelect = document.getElementById(name + '_year');
        const monthSelect = document.getElementById(name + '_month');
        const dateSelect = document.getElementById(name + '_date');
        
        if (yearSelect && monthSelect && dateSelect) {
            yearSelect.addEventListener('change', function() {
                updateMonthDropdown(name);
                updateCombinedDate(name);
            });
            
            monthSelect.addEventListener('change', function() {
                updateDateDropdown(name);
                updateCombinedDate(name);
            });
            
            dateSelect.addEventListener('change', function() {
                updateCombinedDate(name);
            });
        }
    }
}

// Override the updateCombinedDate function to update our result displays
function updateCombinedDate(name) {
    const yearSelect = document.getElementById(name + '_year');
    const monthSelect = document.getElementById(name + '_month');
    const dateSelect = document.getElementById(name + '_date');
    const resultSpan = document.getElementById(name + '_result');
    
    if (yearSelect && monthSelect && dateSelect && resultSpan) {
        if (yearSelect.value && monthSelect.value && dateSelect.value) {
            const year = yearSelect.value;
            const month = monthSelect.value.padStart(2, '0');
            const date = dateSelect.value.padStart(2, '0');
            resultSpan.textContent = `${year}-${month}-${date}`;
        } else {
            resultSpan.textContent = 'Not set';
        }
    }
}
</script>
@endsection

