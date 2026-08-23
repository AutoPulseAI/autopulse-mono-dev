@extends('layouts.front')

@section('content')
<main class="page-wrapper rbt-dashboard-page">
    <div class="rbt-panel-wrapper">
        @include('template.dealers.include.header')
        @include('template.dealers.include.mobilemenu')
        @include('template.dealers.include.sidebar')

        @php
            $user = Auth::guard('dealer')->user();  
        @endphp

        <div class="rbt-main-content mr--0 mb--0">
            <div class="rbt-daynamic-page-content center-width">
                <div class="rbt-dashboard-content">
                    <div class="banner-area">
                        <div class="settings-area mb-0">
                            <h3 class="title">Appointments</h3>
                        </div>

                        <!-- Tracking Analytics Dashboard -->
                        

                        <!-- Filter -->
                        <div class="rbt-dashboard-content px-0">
                            <div class="row justify-content-center">
                                <div class="col-lg-12 col-md-12 col-12">
                                    <form method="GET" action="{{ route('dealer.mybookingdownlod') }}" class="rbt-profile-row rbt-default-form row justify-content-center gx-2 w-100">
                                        <div class="col-xxl-4 col-lg-4 col-md-3 col-12">
                                            <div class="form-group d-flex align-items-center mb-3">
                                                <input type="text" name="search" class="form-control" placeholder="Search by Name, Email, Phone" value="{{ request()->get('search') }}">
                                            </div>
                                        </div>
                                        <div class="col-xxl-4 col-lg-4 col-md-5 col-12">
                                            <div class="form-group d-flex align-items-center mb-3">
                                                <span>From:</span>&nbsp;
                                                <input type="date" name="from" class="ms-auto ms-md-1" value="{{ request()->get('from') }}">
                                            </div>
                                        </div>
                                        <div class="col-xxl-4 col-lg-4 col-md-5 col-12">
                                            <div class="form-group d-flex align-items-center mb-3">
                                                <span>To:</span>&nbsp;
                                                <input type="date" name="to" class="ms-auto ms-md-1" value="{{ request()->get('to') }}"> 
                                            </div>
                                        </div>
                                        <div class="col-xxl-4 col-lg-3 col-md-3 col-12">
                                            <div class="form-group d-flex align-items-center mb-3">
                                                <select name="source" class="form-select">
                                                    <option value="">All Sources</option>
                                                    <option value="facebook_messenger" {{ request()->get('source') == 'facebook_messenger' ? 'selected' : '' }}>Facebook Messenger</option>
                                                    <option value="website" {{ request()->get('source') == 'website' ? 'selected' : '' }}>Website</option>
                                                    <option value="direct" {{ request()->get('source') == 'direct' ? 'selected' : '' }}>Direct</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div class="col col-lg-1 col-md-2 col-4">
                                            <button type="submit" class="btn-default w-100 mb-3" value="Filter"><i class="fa-solid fa-magnifying-glass"></i></button>
                                        </div>
                                        <div class="col col-lg-1 col-md-2 col-4">
                                            <a href="{{ route('dealer.mylead') }}" class="react-btn btn-default btn-border w-100 mb-3"><i class="fa-solid fa-arrow-rotate-right"></i></a>
                                        </div>
                                        <div class="col col-lg-1 col-md-2 col-4">
                                            <a href="{{ route('dealer.export-tracking', request()->all()) }}" class="react-btn btn-default btn-border w-100 mb-3"><i class="fa-solid fa-download"></i></a>
                                        </div>
                                        
                                    </form>
                                </div>
                            </div>
                        </div>

                    </div>
                    <div class="content-page pb--50">
                        <div class="row row--15">
                            <div class="col-lg-12">                                
                                <div class="rainbow-compare-table style-1 table-responsive">
                                    <table class="table-responsive">
                                        <thead>
                                            <tr>
                                                <th class="sm-radius-top-left">Name</th>
                                                <th class="sm-radius-top-left">Email</th>
                                                <th class="sm-radius-top-left">Phone</th>
                                                <th class="style-prymary">Booking Date</th>
                                                <th class="style-prymary">Booking Time</th>
                                                <th class="style-prymary">Source</th>
                                                <th class="style-prymary">Tracking Data</th>
                                                <th class="style-prymary">Date</th>
                                                <th class="sm-radius-top-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>       
                                            @forelse ($vehicles as $item)
                                                <tr>
                                                    <td>{{ $item['name'] ?? '' }}</td>
                                                    <td>{{ $item['email'] ?? '' }}</td>
                                                    <td>{{ $item['phone'] ?? '' }}</td>
                                                    <td>{{ $item['booking_date'] ?? '' }}</td>
                                                    <td>{{ $item['booking_time'] ?? '' }}</td>
                                                    <td>
                                                        @if(isset($item['utm_source']) && $item['utm_source'] == 'facebook_messenger')
                                                            <p class="mb-0"><span class="badge bg-primary fs-5">Facebook</span></p>
                                                        @elseif(isset($item['utm_source']))
                                                            <p class="mb-0"><span class="badge bg-secondary fs-5">{{ ucfirst($item['utm_source']) }}</span></p>
                                                        @else
                                                            <p class="mb-0"><span class="badge bg-light text-dark fs-5">Direct</span></p>
                                                        @endif
                                                    </td>
                                                    <td>
                                                        @if(isset($item['tracking_data']))
                                                            <button type="button" class="btn btn-sm btn-outline-info" 
                                                                    data-bs-toggle="modal" 
                                                                    data-bs-target="#trackingModal" 
                                                                    data-tracking='@json($item['tracking_data'])'>
                                                                <i class="fas fa-chart-line me-1"></i>
                                                                View
                                                            </button>
                                                        @else
                                                            <span class="text-muted">No data</span>
                                                        @endif
                                                    </td>
                                                    <td class="text-nowrap">{{ $item['created_at'] ? $item['created_at']->format('Y-m-d') : '' }}</td>
                                                    <td>
                                                        <div class="btn-group" role="group">
                                                            <button type="button" class="btn-sm btn-default" 
                                                                    data-bs-toggle="modal" 
                                                                    data-bs-target="#bookingDetailsModal" 
                                                                    data-booking='@json($item)'>
                                                                <i class="fas fa-eye"></i>
                                                            </button>
                                                            @if(isset($item['tracking_data']))
                                                            <button type="button" class="btn btn-sm btn-outline-success" 
                                                                    onclick="exportTrackingData({{ $item['id'] }})">
                                                                <i class="fas fa-download"></i>
                                                            </button>
                                                            @endif
                                                        </div>
                                                    </td>
                                                </tr>
                                            @empty
                                                <tr>
                                                    <td colspan="9" class="text-center">No Record found.</td>
                                                </tr>
                                            @endforelse
                                        </tbody>
                                    </table>
                                    <div class="pagination-wrapper convpage mt-3">
                                        {{ $vehicles->onEachSide(1)->links('pagination::bootstrap-5') }}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Performance Charts 
                        <div class="row mt-5">
                            <div class="col-lg-6">
                                <div class="card">
                                    <div class="card-header">
                                        <h5>Conversion Trends</h5>
                                    </div>
                                    <div class="card-body">
                                        <canvas id="conversionChart" width="400" height="200"></canvas>
                                    </div>
                                </div>
                            </div>
                            <div class="col-lg-6">
                                <div class="card">
                                    <div class="card-header">
                                        <h5>Source Performance</h5>
                                    </div>
                                    <div class="card-body">
                                        <canvas id="sourceChart" width="400" height="200"></canvas>
                                    </div>
                                </div>
                            </div>
                        </div>-->
                    </div>
                </div>
            </div>
        </div>
    </div>
</main>

<!-- Tracking Details Modal -->
<div class="modal fade" id="trackingModal" tabindex="-1" aria-labelledby="trackingModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="trackingModalLabel">Tracking Analytics</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                <div id="trackingContent">
                    <!-- Tracking data will be loaded here -->
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            </div>
        </div>
    </div>
</div>

<!-- Booking Details Modal -->
 <div id="bookingDetailsModal" class="modal rbt-modal-box fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content wrapper top-flashlight leftside light-xl">
            <h4 class="title">Booking Details</h4>

            <div id="bookingContent">
                <!-- Booking details will be loaded here -->
            </div>

            <button class="close-button" data-bs-dismiss="modal">
                <i class="feather-x"></i>
            </button>
        </div>
    </div>
</div>

<!-- Start Modal  -->
<div id="editStoreSubscrip" class="modal rbt-modal-box fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content wrapper top-flashlight leftside light-xl modal-small text-center">
            <p class="b1 text-center mb--0">Kindly contact on <b><a class="text_dark" href="mailto:info@autopulse.ai">info@autopulse.ai</a></b> regarding your subscription!</p>
            <div class="bottom-btn mt--20 w-100">
                <button data-bs-dismiss="modal" class="btn-default btn-border btn-small round">Cancel</button>
                <button type="button" class="btn-default btn-small round" id="contactNowButton">OK</button>
            </div>
            <button class="close-button" data-bs-dismiss="modal">
                <i class="feather-x"></i>
            </button>
        </div>
    </div>
</div>
<!-- End Modal  -->

<!-- Start Modal  -->
<div id="cancelSubscriptionModal" class="modal rbt-modal-box fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content wrapper top-flashlight leftside light-xl modal-small">
            <form id="cancelSubscriptionForm" method="POST" action="{{ route('create_cancel_request') }}" class="rbt-profile-row rbt-default-form row row--15">
                @csrf    
                <div class="col-12">
                    <div class="form-group">
                        <label>Reason for cancellation</label>
                        <textarea id="cancel_reason" name="reason" required cols="20" rows="4"></textarea>
                    </div>
                </div>
                <div class="col-12">
                    <div class="bottom-btn w-100 text-center">
                        <button data-bs-dismiss="modal" class="btn-default btn-border btn-small round">Cancel</button>
                        <button type="submit" class="btn-default btn-small round">Submit</button>
                    </div>
                </div>
            </form>
            <button class="close-button" data-bs-dismiss="modal">
                <i class="feather-x"></i>
            </button>
        </div>
    </div>
</div>
<!-- End Modal  -->

@endsection

@push('after-scripts')
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
// Analytics Dashboard
$(document).ready(function() {
    // Load analytics data
    loadAnalytics();
    
    // Initialize charts with real data
    initializeCharts();
});

// Load analytics data
function loadAnalytics() {
    $.ajax({
        url: '{{ route("booking.analytics", ["dealerId" => $user->id ?? 1]) }}',
        method: 'GET',
        success: function(response) {
            if (response.success) {
                updateAnalyticsCards(response.analytics);
                updateCharts(response.analytics);
            }
        },
        error: function() {
            console.log('Failed to load analytics');
        }
    });
}

// Refresh analytics data
function refreshAnalytics() {
    $('.analytics-card').addClass('loading');
    loadAnalytics();
    setTimeout(() => {
        $('.analytics-card').removeClass('loading');
    }, 1000);
}

// Update analytics cards
function updateAnalyticsCards(analytics) {
    $('.analytics-card h4').each(function(index) {
        switch(index) {
            case 0:
                $(this).text(analytics.total_visits || 0);
                break;
            case 1:
                $(this).text((analytics.conversion_rate || 0).toFixed(1) + '%');
                break;
            case 2:
                $(this).text(analytics.form_starts || 0);
                break;
            case 3:
                $(this).text(analytics.conversions || 0);
                break;
        }
    });
}

// Initialize charts
function initializeCharts() {
    // Conversion Trends Chart
    const conversionCtx = document.getElementById('conversionChart').getContext('2d');
    window.conversionChart = new Chart(conversionCtx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            datasets: [{
                label: 'Conversions',
                data: [12, 19, 3, 5, 2, 3],
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });

    // Source Performance Chart
    const sourceCtx = document.getElementById('sourceChart').getContext('2d');
    window.sourceChart = new Chart(sourceCtx, {
        type: 'doughnut',
        data: {
            labels: ['Facebook Messenger', 'Website', 'Direct'],
            datasets: [{
                data: [65, 25, 10],
                backgroundColor: [
                    'rgb(54, 162, 235)',
                    'rgb(255, 99, 132)',
                    'rgb(255, 205, 86)'
                ]
            }]
        },
        options: {
            responsive: true
        }
    });
}

// Update charts with real data
function updateCharts(analytics) {
    // Update source performance chart
    if (window.sourceChart) {
        const totalVisits = analytics.total_visits || 0;
        const facebookVisits = analytics.facebook_visits || 0;
        const websiteVisits = Math.round(totalVisits * 0.25); // Estimate
        const directVisits = Math.round(totalVisits * 0.1); // Estimate
        
        window.sourceChart.data.datasets[0].data = [facebookVisits, websiteVisits, directVisits];
        window.sourceChart.update();
    }
}

// Tracking Modal
$('#trackingModal').on('show.bs.modal', function (event) {
    var button = $(event.relatedTarget);
    var trackingData = button.data('tracking');
    
    var content = `
        <div class="row">
            <div class="col-md-6">
                <h6>Visit Information</h6>
                <table class="table table-sm">
                    <tr><td>Visit Date:</td><td>${trackingData.visited_at || 'N/A'}</td></tr>
                    <tr><td>Source:</td><td>${trackingData.utm_source || 'N/A'}</td></tr>
                    <tr><td>Session ID:</td><td>${trackingData.session_id || 'N/A'}</td></tr>
                    <tr><td>Status:</td><td><span class="badge bg-${getStatusColor(trackingData.status)}">${trackingData.status || 'N/A'}</span></td></tr>
                </table>
            </div>
            <div class="col-md-6">
                <h6>User Journey</h6>
                <table class="table table-sm">
                    <tr><td>Form Started:</td><td>${trackingData.form_started_at || 'N/A'}</td></tr>
                    <tr><td>Form Completed:</td><td>${trackingData.form_completed_at || 'N/A'}</td></tr>
                    <tr><td>Converted:</td><td>${trackingData.converted_at || 'N/A'}</td></tr>
                    <tr><td>Time to Convert:</td><td>${calculateTimeToConvert(trackingData)}</td></tr>
                </table>
            </div>
        </div>
        <div class="row mt-3">
            <div class="col-12">
                <h6>Additional Data</h6>
                <pre class="bg-light p-2 rounded">${JSON.stringify(trackingData.additional_data || {}, null, 2)}</pre>
            </div>
        </div>
    `;
    
    $('#trackingContent').html(content);
});

// Booking Details Modal
$('#bookingDetailsModal').on('show.bs.modal', function (event) {
    var button = $(event.relatedTarget);
    var bookingData = button.data('booking');
    
    var content = `
        <div class="row gy-4">
            <div class="col-md-6">
                <h6 class="mb-3">Customer Information</h6>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">Name:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.name || 'N/A'}</p>
                    </div>
                </div>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">Email:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.email || 'N/A'}</p>
                    </div>
                </div>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">Phone:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.phone || 'N/A'}</p>
                    </div>
                </div>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">User ID:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.user_id || 'N/A'}</p>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <h6 class="mb-3">Booking Details</h6>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">Date:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.booking_date || 'N/A'}</p>
                    </div>
                </div>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">Time:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.booking_time || 'N/A'}</p>
                    </div>
                </div>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">Created:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.created_at || 'N/A'}</p>
                    </div>
                </div>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">Dealer ID:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.dealer_id || 'N/A'}</p>
                    </div>
                </div>
            </div>

            <div class="col-12">
                <h6 class="mb-3">Tracking Information</h6>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">UTM Source:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.utm_source || 'N/A'}</p>
                    </div>
                </div>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">Vehicle ID:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.vehicle_id || 'N/A'}</p>
                    </div>
                </div>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">Vehicle Title:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.vehicle_title || 'N/A'}</p>
                    </div>
                </div>
                <div class="row mb-2 mb-md-0">
                    <div class="col col-md-3 col-12">
                        <p class="b2 mb--0 lh-sm">Conversation ID:</p>
                    </div>
                    <div class="col col-md-9 col-12">
                        <p class="b2 mb--0">${bookingData.conversation_id || 'N/A'}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    $('#bookingContent').html(content);
});

// Helper functions
function getStatusColor(status) {
    switch(status) {
        case 'visited': return 'secondary';
        case 'started_form': return 'warning';
        case 'completed_form': return 'info';
        case 'converted': return 'success';
        default: return 'light';
    }
}

function calculateTimeToConvert(trackingData) {
    if (!trackingData.visited_at || !trackingData.converted_at) return 'N/A';
    
    const visitTime = new Date(trackingData.visited_at);
    const convertTime = new Date(trackingData.converted_at);
    const diffMs = convertTime - visitTime;
    const diffMins = Math.round(diffMs / 60000);
    
    if (diffMins < 60) return `${diffMins} minutes`;
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hours`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} days`;
}

// Export tracking data
function exportTrackingData(bookingId) {
    window.open(`/booking/export-tracking/${bookingId}`, '_blank');
}

$('#contactNowButton').click(function() {
    $('#editStoreSubscrip').modal('hide');
    $('#cancelSubscriptionModal').modal('show');
});

$('#editStoreSubscrip').on('show.bs.modal', function (event) {
    var button = $(event.relatedTarget);
    var storeId = button.data('id');
    $('#cancel_store_id').val(storeId);
});

$('#cancelSubscriptionForm').submit(function(e){
    e.preventDefault();
    $('#cancelSubscriptionForm button[type="submit"]').text('Please wait...').attr('disabled', 'disabled');
    
    if ($('#cancelSubscriptionForm').valid()) {    
        var url = `{{ route('create_cancel_request') }}`;
        var formData = new FormData($('#cancelSubscriptionForm')[0]);
        
        $.ajax({
            url: url,
            method: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: function(output) {
                $('#cancelSubscriptionForm button').text('Submit').removeAttr('disabled');
                if (output.success) {
                    $('.modal').modal('hide');
                    $('.successmsgdiv').html(output.message)
                    $('#thank_you').modal('show');
                } else {
                    alert("An error occurred.");
                }
            },
            error: function() {
                $('#cancelSubscriptionForm button').text('Submit').removeAttr('disabled');
                alert("An error occurred while submitting.");
            }
        });
    } else {
        $('#cancelSubscriptionForm button').text('Submit').removeAttr('disabled');
    }
});
</script>

<style>
.analytics-card {
    transition: transform 0.2s;
    cursor: pointer;
}

.analytics-card:hover {
    transform: translateY(-2px);
}

.analytics-card.loading {
    opacity: 0.7;
    pointer-events: none;
}

.analytics-card.loading::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 20px;
    height: 20px;
    margin: -10px 0 0 -10px;
    border: 2px solid #ffffff;
    border-top: 2px solid transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.analytics-card h4 {
    font-size: 2rem;
    font-weight: bold;
    margin: 0;
}

.analytics-card p {
    font-size: 0.9rem;
    opacity: 0.9;
}

.badge {
    font-size: 0.8rem;
}

.table th {
    background-color: #f8f9fa;
    font-weight: 600;
}

.btn-group .btn {
    margin-right: 2px;
}

.modal-lg {
    max-width: 800px;
}

pre {
    font-size: 0.8rem;
    max-height: 200px;
    overflow-y: auto;
}
</style>
@endpush
