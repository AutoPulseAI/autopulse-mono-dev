@extends('layouts.app')

@section('content')
<div class="container">
    <div class="row justify-content-center">
        <div class="col-md-8">
            <div class="card shadow border-0">
                <div class="card-body text-center p-5">
                    <!-- Success Icon -->
                    <div class="success-icon mb-4">
                        <i class="fas fa-check-circle text-success" style="font-size: 4rem;"></i>
                    </div>

                    <!-- Success Message -->
                    <h2 class="text-success mb-3">Booking Confirmed!</h2>
                    <p class="lead text-muted mb-4">
                        Thank you for booking your visit. We've received your request and will confirm your appointment shortly.
                    </p>

                    <!-- Booking Details -->
                    <div class="card bg-light border-0 mb-4">
                        <div class="card-body">
                            <h5 class="card-title mb-3">
                                <i class="fas fa-calendar-alt me-2"></i>
                                Booking Details
                            </h5>
                            <div class="row text-start">
                                <div class="col-md-6">
                                    <p><strong>Booking ID:</strong> #{{ $booking->id }}</p>
                                    <p><strong>Customer:</strong> {{ $booking->name }}</p>
                                    <p><strong>Dealer:</strong> {{ $booking->dealer->name ?? 'N/A' }}</p>
                                </div>
                                <div class="col-md-6">
                                    <p><strong>Date:</strong> {{ \Carbon\Carbon::parse($booking->booking_date)->format('M d, Y') }}</p>
                                    <p><strong>Time:</strong> {{ $booking->booking_time }}</p>
                                    <p><strong>Status:</strong> 
                                        <span class="badge bg-warning">Pending Confirmation</span>
                                    </p>
                                </div>
                            </div>
                            
                            @if($booking->vehicle_title ?? false)
                            <div class="mt-3 p-3 bg-white rounded">
                                <strong>Vehicle:</strong> {{ $booking->vehicle_title }}
                            </div>
                            @endif
                        </div>
                    </div>

                    <!-- Next Steps -->
                    

                    <!-- Contact Information -->
                    <div class="card border-0 bg-light mb-4">
                        <div class="card-body">
                            <h6 class="card-title">
                                <i class="fas fa-phone me-2"></i>
                                Need to make changes?
                            </h6>
                            <p class="mb-2">Contact us directly:</p>
                            <p class="mb-1"><strong>Phone:</strong> {{ $booking->dealer->phone ?? 'N/A' }}</p>
                            <p class="mb-0"><strong>Email:</strong> {{ $booking->dealer->email ?? 'N/A' }}</p>
                        </div>
                    </div>

                    <!-- Action Buttons -->
                    <div class="d-grid gap-2 d-md-flex justify-content-md-center">
                        
                    </div>

                    <!-- Social Sharing -->
                    
                </div>
            </div>
        </div>
    </div>
</div>

<style>
.card {
    border-radius: 15px;
}

.success-icon {
    animation: bounceIn 0.6s ease-out;
}

@keyframes bounceIn {
    0% {
        transform: scale(0.3);
        opacity: 0;
    }
    50% {
        transform: scale(1.05);
    }
    70% {
        transform: scale(0.9);
    }
    100% {
        transform: scale(1);
        opacity: 1;
    }
}

.badge {
    font-size: 0.875rem;
    padding: 0.5em 0.75em;
}

.btn {
    border-radius: 8px;
    padding: 10px 20px;
    font-weight: 500;
    transition: all 0.3s ease;
}

.btn:hover {
    transform: translateY(-2px);
}

.alert {
    border-radius: 10px;
}

.card-body {
    padding: 2rem;
}

@media (max-width: 768px) {
    .card-body {
        padding: 1.5rem;
    }
}
</style>

<script>
// Social sharing functions
function shareOnFacebook() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent('I just booked a visit at {{ $booking->dealer->name ?? "AutoPulse" }}!');
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}`, '_blank');
}

function shareOnTwitter() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent('Just booked a visit at {{ $booking->dealer->name ?? "AutoPulse" }}! 🚗📅');
    window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, '_blank');
}

function shareOnWhatsApp() {
    const text = encodeURIComponent('I just booked a visit at {{ $booking->dealer->name ?? "AutoPulse" }}! Check it out: ' + window.location.href);
    window.open(`https://wa.me/?text=${text}`, '_blank');
}

// Auto-scroll to top when page loads
window.addEventListener('load', function() {
    window.scrollTo(0, 0);
});
</script>
@endsection
