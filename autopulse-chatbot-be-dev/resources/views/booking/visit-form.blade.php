@extends('layouts.app')

@section('content')
<div class="container">
    <div class="row justify-content-center">
        <div class="col-md-8">
            <div class="card shadow">
                <div class="card-header bg-primary text-white">
                    <h4 class="mb-0">
                        <i class="fas fa-calendar-check me-2"></i>
                        Book Your Visit
                    </h4>
                </div>
                <div class="card-body">
                    @if(session('error'))
                        <div class="alert alert-danger">
                            {{ session('error') }}
                        </div>
                    @endif

                    @if(session('success'))
                        <div class="alert alert-success">
                            {{ session('success') }}
                        </div>
                    @endif

                    <!-- Booking Summary -->
                    <div class="alert alert-info">
                        <h6 class="alert-heading">
                            <i class="fas fa-info-circle me-2"></i>
                            Booking Summary
                        </h6>
                        <div class="row">
                            <div class="col-md-6">
                                <strong>Dealer:</strong> {{ $dealer->name ?? 'N/A' }}<br>
                                <strong>Vehicle:</strong> {{ $prefilledData['vehicle_title'] ?? 'N/A' }}
                            </div>
                            <div class="col-md-6">
                                <strong>Source:</strong> Facebook Messenger<br>
                                <strong>Date:</strong> {{ now()->format('M d, Y') }}
                            </div>
                        </div>
                    </div>

                    <form method="POST" action="{{ route('booking.process') }}" id="bookingForm">
                        @csrf
                        
                        <!-- Hidden Fields -->
                        <input type="hidden" name="dealer_id" value="{{ $prefilledData['dealer_id'] }}">
                        <input type="hidden" name="user_id" value="{{ $prefilledData['user_id'] }}">
                        <input type="hidden" name="utm_source" value="{{ $prefilledData['utm_source'] }}">
                        <input type="hidden" name="vehicle_id" value="{{ $prefilledData['vehicle_id'] }}">
                        <input type="hidden" name="vehicle_title" value="{{ $prefilledData['vehicle_title'] }}">
                        <input type="hidden" name="conversation_id" value="{{ $prefilledData['conversation_id'] }}">
                        @if($trackingRecord)
                        <input type="hidden" name="tracking_id" value="{{ $trackingRecord->id }}">
                        @endif

                        <!-- Customer Information -->
                        <div class="row">
                            <div class="col-md-6">
                                <div class="mb-3">
                                    <label for="name" class="form-label">
                                        <i class="fas fa-user me-1"></i>
                                        Full Name <span class="text-danger">*</span>
                                    </label>
                                    <input 
                                        type="text" 
                                        class="form-control @error('name') is-invalid @enderror" 
                                        id="name" 
                                        name="name" 
                                        value="{{ $prefilledData['name'] }}" 
                                        required
                                        readonly
                                    >
                                    <div class="form-text">Name from Facebook Messenger</div>
                                    @error('name')
                                        <div class="invalid-feedback">{{ $message }}</div>
                                    @enderror
                                </div>
                            </div>
                            
                            <div class="col-md-6">
                                <div class="mb-3">
                                    <label for="email" class="form-label">
                                        <i class="fas fa-envelope me-1"></i>
                                        Email Address <span class="text-danger">*</span>
                                    </label>
                                    <input 
                                        type="email" 
                                        class="form-control @error('email') is-invalid @enderror" 
                                        id="email" 
                                        name="email" 
                                        value="{{ old('email') }}" 
                                        placeholder="Enter your email address"
                                        required
                                    >
                                    @error('email')
                                        <div class="invalid-feedback">{{ $message }}</div>
                                    @enderror
                                </div>
                            </div>
                        </div>

                        <div class="row">
                            <div class="col-md-6">
                                <div class="mb-3">
                                    <label for="phone" class="form-label">
                                        <i class="fas fa-phone me-1"></i>
                                        Phone Number <span class="text-danger">*</span>
                                    </label>
                                    <input 
                                        type="tel" 
                                        class="form-control @error('phone') is-invalid @enderror" 
                                        id="phone" 
                                        name="phone" 
                                        value="{{ old('phone') }}" 
                                        placeholder="Enter your phone number"
                                        required
                                    >
                                    @error('phone')
                                        <div class="invalid-feedback">{{ $message }}</div>
                                    @enderror
                                </div>
                            </div>
                            
                            <div class="col-md-6">
                                <div class="mb-3">
                                    <label for="booking_date" class="form-label">
                                        <i class="fas fa-calendar me-1"></i>
                                        Preferred Date <span class="text-danger">*</span>
                                    </label>
                                    <input 
                                        type="date" 
                                        class="form-control @error('booking_date') is-invalid @enderror" 
                                        id="booking_date" 
                                        name="booking_date" 
                                        value="{{ old('booking_date') }}" 
                                        min="{{ date('Y-m-d', strtotime('+1 day')) }}"
                                        required
                                    >
                                    <div class="form-text">Select a future date</div>
                                    @error('booking_date')
                                        <div class="invalid-feedback">{{ $message }}</div>
                                    @enderror
                                </div>
                            </div>
                        </div>

                        <div class="row">
                            <div class="col-md-6">
                                <div class="mb-3">
                                    <label for="booking_time" class="form-label">
                                        <i class="fas fa-clock me-1"></i>
                                        Preferred Time <span class="text-danger">*</span>
                                    </label>
                                    <select 
                                        class="form-select @error('booking_time') is-invalid @enderror" 
                                        id="booking_time" 
                                        name="booking_time" 
                                        required
                                    >
                                        <option value="">Select a time</option>
                                        <option value="09:00" {{ old('booking_time') == '09:00' ? 'selected' : '' }}>9:00 AM</option>
                                        <option value="10:00" {{ old('booking_time') == '10:00' ? 'selected' : '' }}>10:00 AM</option>
                                        <option value="11:00" {{ old('booking_time') == '11:00' ? 'selected' : '' }}>11:00 AM</option>
                                        <option value="12:00" {{ old('booking_time') == '12:00' ? 'selected' : '' }}>12:00 PM</option>
                                        <option value="13:00" {{ old('booking_time') == '13:00' ? 'selected' : '' }}>1:00 PM</option>
                                        <option value="14:00" {{ old('booking_time') == '14:00' ? 'selected' : '' }}>2:00 PM</option>
                                        <option value="15:00" {{ old('booking_time') == '15:00' ? 'selected' : '' }}>3:00 PM</option>
                                        <option value="16:00" {{ old('booking_time') == '16:00' ? 'selected' : '' }}>4:00 PM</option>
                                        <option value="17:00" {{ old('booking_time') == '17:00' ? 'selected' : '' }}>5:00 PM</option>
                                    </select>
                                    @error('booking_time')
                                        <div class="invalid-feedback">{{ $message }}</div>
                                    @enderror
                                </div>
                            </div>
                            
                            <div class="col-md-6">
                                <div class="mb-3">
                                    <label for="notes" class="form-label">
                                        <i class="fas fa-sticky-note me-1"></i>
                                        Additional Notes
                                    </label>
                                    <textarea 
                                        class="form-control @error('notes') is-invalid @enderror" 
                                        id="notes" 
                                        name="notes" 
                                        rows="3" 
                                        placeholder="Any special requests or additional information..."
                                    >{{ old('notes') }}</textarea>
                                    @error('notes')
                                        <div class="invalid-feedback">{{ $message }}</div>
                                    @enderror
                                </div>
                            </div>
                        </div>

                        <!-- Submit Button -->
                        <div class="d-grid gap-2 d-md-flex justify-content-md-end">
                            <button type="submit" class="btn btn-primary btn-lg">
                                <i class="fas fa-calendar-check me-2"></i>
                                Book My Visit
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- Additional Information -->
            <div class="card mt-4">
                <div class="card-body">
                    <h6 class="card-title">
                        <i class="fas fa-info-circle me-2"></i>
                        What happens next?
                    </h6>
                    <ul class="list-unstyled mb-0">
                        <li><i class="fas fa-check text-success me-2"></i>We'll confirm your appointment within 24 hours</li>
                        <li><i class="fas fa-check text-success me-2"></i>You'll receive a confirmation email and SMS</li>
                        <li><i class="fas fa-check text-success me-2"></i>Our team will prepare for your visit</li>
                        <li><i class="fas fa-check text-success me-2"></i>Feel free to contact us with any questions</li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
.card {
    border: none;
    border-radius: 15px;
}

.card-header {
    border-radius: 15px 15px 0 0 !important;
    border: none;
}

.form-control, .form-select {
    border-radius: 8px;
    border: 2px solid #e9ecef;
    padding: 12px 15px;
    transition: all 0.3s ease;
}

.form-control:focus, .form-select:focus {
    border-color: #0d6efd;
    box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.25);
}

.form-control:read-only {
    background-color: #f8f9fa;
    border-color: #dee2e6;
}

.btn-primary {
    border-radius: 8px;
    padding: 12px 30px;
    font-weight: 600;
    transition: all 0.3s ease;
}

.btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 15px rgba(13, 110, 253, 0.3);
}

.alert {
    border-radius: 10px;
    border: none;
}

.form-label {
    font-weight: 600;
    color: #495057;
}

.form-text {
    font-size: 0.875rem;
    color: #6c757d;
}
</style>

<script>
document.addEventListener('DOMContentLoaded', function() {
    // Set minimum date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    const dateInput = document.getElementById('booking_date');
    if (dateInput) {
        dateInput.min = tomorrowStr;
        
        // Set default value to tomorrow if no value is set
        if (!dateInput.value) {
            dateInput.value = tomorrowStr;
        }
    }

    // Form validation
    const form = document.getElementById('bookingForm');
    if (form) {
        form.addEventListener('submit', function(e) {
            const email = document.getElementById('email').value;
            const phone = document.getElementById('phone').value;
            const date = document.getElementById('booking_date').value;
            const time = document.getElementById('booking_time').value;

            if (!email || !phone || !date || !time) {
                e.preventDefault();
                alert('Please fill in all required fields.');
                return false;
            }

            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                e.preventDefault();
                alert('Please enter a valid email address.');
                return false;
            }

            // Basic phone validation (at least 10 digits)
            const phoneDigits = phone.replace(/\D/g, '');
            if (phoneDigits.length < 10) {
                e.preventDefault();
                alert('Please enter a valid phone number (at least 10 digits).');
                return false;
            }

            return true;
        });
    }
});
</script>
@endsection
