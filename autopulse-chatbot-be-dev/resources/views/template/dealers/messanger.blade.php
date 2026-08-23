@extends('layouts.front')

@section('content')
<?php #dd($facebookPage);?>
<main class="page-wrapper rbt-dashboard-page">
    <div class="rbt-panel-wrapper">

        <!-- Start Header  -->
        @include('template.dealers.include.header')
        <!-- End Header  -->

        <!-- start mobilemenu -->
        @include('template.dealers.include.mobilemenu')
        <!-- End mobilemenu -->

        <!-- start mobilemenu -->
        @include('template.dealers.include.sidebar')
        <!-- End mobilemenu -->

        @php
            $user = Auth::guard('dealer')->user();  
        @endphp
        <!-- Start Main content -->
        <div class="rbt-main-content mr--0 mb--0">
            <div class="rbt-daynamic-page-content center-width">

                <!-- Dashboard Center Content -->
                <div class="rbt-dashboard-content">
                    <div class="banner-area">
                        <!-- ChatenAI small Slider -->
                        <div class="settings-area mb-0">
                            <h3 class="title mb-0">Facebook Messenger Integration</h3>
                        </div>
                    </div>
                    <div class="content-page pb--50">

                        @if (session('error'))                                   
                            <div class="alert alert-danger" role="alert">
                            {{ session('error') }}
                            </div>
                        @endif 
                        @if (session('success'))                                   
                            <div class="alert alert-success" role="alert">
                            {{ session('success') }}
                            </div>
                        @endif

                        <!-- Facebook Integration Settings -->
                        <div class="single-settings-box profile-details-box top-flashlight light-xl leftside overflow-hidden">
                            <div class="wrapper">
                                <div class="section-title mb-4">
                                    <h4 class="mb-0">Connect Your Facebook Page</h4>
                                </div>
                                
                                @if(!$facebookPage)
                                <!-- Step 1: Connect Facebook Page -->
                                <div class="rbt-profile-row rbt-default-form row row--15">
                                    <div class="col-12">
                                        <div class="position-relative mb-4">
                                            <p class="mb-3">To connect your Facebook Page to AutoPulse AI, follow these steps:</p>
                                            <ol class="mb-4">
                                                <li>Click the button below to authenticate with Facebook</li>
                                                <li>Select the Facebook Page you want to connect</li>
                                                <li>Grant the necessary permissions</li>
                                            </ol>
                                            <a href="{{ route('facebook.connect') }}" class="btn btn-primary btn_fb">
                                                <i class="fab fa-facebook"></i> Connect Facebook Page
                                            </a>
                                        </div>
                                    </div>
                                </div>
                                @else
                                <!-- Step 2: Webhook Configuration -->
                                    <div class="rbt-profile-row rbt-default-form row row--15">
                                        <div class="col-12">
                                            <div class="alert alert-success">
                                                <h5>✅ Connected Page: {{ $facebookPage->page_name }}</h5>
                                                <p>All messages to this page are now automatically processed by AutoPulse AI.</p>
                                                <span class="badge bg-success">Active</span>
                                                
                                                <div class="mt-3">
                                                    <button type="button" class="btn btn-info btn_fb me-2" onclick="checkWebhookStatus()">
                                                        <i class="fas fa-info-circle"></i> Check Webhook Status
                                                    </button>
                                                    <button type="button" class="btn btn-warning btn_fb me-2" onclick="subscribeToWebhook()">
                                                        <i class="fas fa-sync"></i> Subscribe to Webhook
                                                    </button>
                                                    <button type="button" class="btn btn-primary btn_fb me-2" onclick="testWebhook()">
                                                        <i class="fas fa-test-tube"></i> Test Connection
                                                    </button>
                                                </div>
                                                
                                                <form action="{{ route('facebook.disconnect') }}" method="POST" class="mt-3">
                                                    @csrf
                                                    <button type="submit" class="btn btn_fb btn-danger">
                                                        <i class="fas fa-unlink"></i> Disconnect Page
                                                    </button>
                                                </form>
                                            </div>
                                        </div>
                                    </div>
                                @endif
                                
                                <!-- Documentation Section -->
                                <div class="rbt-profile-row rbt-default-form row row--15 mt-4">
                                    <div class="col-12">
                                        <div class="section-title mb-4">
                                            <h4 class="mb-0">How It Works</h4>
                                        </div>
                                        <div class="position-relative">
                                            <p class="mb-3">Once connected, your AutoPulse AI chatbot will:</p>

                                            <ul>
                                                <li>Respond to messages on your Facebook Page</li>
                                                <li>Use the same AI intelligence as your website chatbot</li>
                                                <li>Maintain consistent branding and responses across platforms</li>
                                            </ul>
                                        </div>

                                        <div class="section-title mb-4">
                                            <h4 class="mb-0">Requirements</h4>
                                        </div>
                                        <div class="position-relative">
                                            <ul class="mb-0">
                                                <li>You must be an admin of the Facebook Page</li>
                                                <li>Your Facebook account must have developer access</li>
                                                <li>The page must not be restricted or unpublished</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- End Main content  -->
    </div>
</main>
@endsection

@push('after-scripts')
<script>
    // Check if we're returning from Facebook auth with an error
    @if(session('facebook_error'))
        alert('Facebook Error: {{ session('facebook_error') }}');
    @endif
    
    // Function to test webhook connection
    function testWebhook() {
        $.ajax({
            url: '{{ route("facebook.test-webhook") }}',
            type: 'POST',
            data: {
                _token: '{{ csrf_token() }}',
                page_id: '{{ $facebookPage->page_id ?? '' }}'
            },
            success: function(response) {
                if(response.success) {
                    alert('Webhook test successful!');
                } else {
                    alert('Webhook test failed: ' + response.message);
                }
            },
            error: function() {
                alert('An error occurred while testing the webhook');
            }
        });
    }
    
    // Function to check webhook subscription status
    function checkWebhookStatus() {
        $.ajax({
            url: '{{ route("facebook.webhook-status") }}',
            type: 'GET',
            success: function(response) {
                if(response.success) {
                    let statusHtml = '<h6>Webhook Status:</h6>';
                    response.statuses.forEach(function(status) {
                        const badgeClass = status.is_subscribed ? 'bg-success' : 'bg-warning';
                        const badgeText = status.is_subscribed ? 'Subscribed' : 'Not Subscribed';
                        statusHtml += `<div class="mb-2">
                            <strong>${status.page_name}</strong>: 
                            <span class="badge ${badgeClass}">${badgeText}</span>
                        </div>`;
                    });
                    alert(statusHtml.replace(/<[^>]*>/g, ''));
                } else {
                    alert('Failed to check status: ' + response.message);
                }
            },
            error: function() {
                alert('An error occurred while checking webhook status');
            }
        });
    }
    
    // Function to subscribe page to webhook
    function subscribeToWebhook() {
        if(confirm('This will subscribe your Facebook page to webhook events. Continue?')) {
            $.ajax({
                url: '{{ route("facebook.subscribe-pages") }}',
                type: 'POST',
                data: {
                    _token: '{{ csrf_token() }}'
                },
                success: function(response) {
                    if(response.success) {
                        alert('Successfully subscribed to webhook events!');
                        // Refresh the page to show updated status
                        location.reload();
                    } else {
                        alert('Failed to subscribe: ' + response.message);
                    }
                },
                error: function() {
                    alert('An error occurred while subscribing to webhook');
                }
            });
        }
    }
</script>
@endpush