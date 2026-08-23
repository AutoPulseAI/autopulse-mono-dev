@extends('layouts.front')

@section('content')
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
                        <div class="settings-area">
                            <h3 class="title">Manage Billing</h3>
                        </div>
                    </div>
                    <div class="content-page pb--50">
                        <h5 class="title">Step 3</h5>
                        
                        <!-- Show success and error messages -->
                        @if(session('success'))
                            <div class="alert alert-success">
                                {{ session('success') }}
                            </div>
                        @endif

                        @if(session('error'))
                            <div class="alert alert-danger">
                                {{ session('error') }}
                            </div>
                        @endif

                        <div class="row row--15">
                            <div class="col-lg-5 col-md-6 col-12">
                                <div class="rainbow-pricing style-2 active mt-0 mb--30">
                                    <div class="pricing-table-inner bg-flashlight">
                                        <div class="pricing-header">
                                            <h4 class="title">Plan</h4>
                                            <div class="pricing">
                                                <div class="price-wrapper"><span class="currency">$</span><span class="price">{{ $user->storelist->subscription_price??$plan['price']}}</span></div><span class="subtitle">USD Per
                                                {{ $plan->name}}</span>
                                            </div>
                                        </div>
                                        <div class="separator-animated animated-true mt--30 mb--30"></div>
                                        <div class="pricing-footer">
                                            @php 
                                              # dd($user->storelist);
                                            @endphp
                                            @if($user->storelist && $user->storelist->is_subscribed == 1 && (!$user->storelist->cancelled_at || \Carbon\Carbon::now()->lessThan(\Carbon\Carbon::parse($user->storelist->cancelled_at))))   
                                                <a data-bs-toggle="modal" data-bs-target="#editStoreSubscrip" class="rainbow-gradient-btn m-0 mb-3"><span>End Purchase</span></a>
                                                <!-- <p class="mb-0">*By ending your subscription you will lose access to your subscription benefits.</p> -->
                                            @else
                                                <a class="rainbow-gradient-btn m-0 mb-3" href="{{ route('subscription.create') }}"><span>Purchase Now</span></a>
                                                <!-- <p class="mb-0">Unlock your AI Bot Integration! Subscribe now to receive your custom JavaScript code and elevate your website's interactivity.</p> -->
                                            @endif                                            
                                        </div>
                                        <div class="pricing-body mb-0 mt--30">
                                            <ul class="list-style--1 text-start">
                                                <li><i class="feather-check-circle"></i> AI-Powered Inventory Search</li>
                                                <li><i class="feather-check-circle"></i> Detailed Car Insights</li>
                                                <li><i class="feather-check-circle"></i> Seamless Lead Generation</li>
                                                <li><i class="feather-check-circle"></i> Boost Dealer Sales & Efficiency</li>
                                                <li><i class="feather-check-circle"></i> Customizable for Your Dealership</li>
                                               
                                            </ul>
                                        </div>
                                        
                                    </div>
                                </div>
                            </div>

                            <div class="col-lg-7 col-md-6 col-12">
                                @if($user->storelist && $user->storelist->is_subscribed == 1 && (!$user->storelist->cancelled_at || \Carbon\Carbon::now()->lessThan(\Carbon\Carbon::parse($user->storelist->cancelled_at))))   
                                <div class="single-settings-box profile-details-box top-flashlight light-xl leftside overflow-hidden mb--30">
                                    <div class="rbt-profile-row rbt-default-form row row--15">
                                        <div class="wrapper">
                                            <div class="section-title mb-0">
                                                <h4 class="rbt-title-style-3 mb-0">
                                                    <label>Renewal Date:</label> 
                                                    <span>@php
                                                        // Get the subscription and its next renewal date
                                                        $user = auth()->guard('dealer')->user();
                                                        $subscription = $user->subscription('default');
                                                        if ($subscription) {
                                                            $renewalDate = \Carbon\Carbon::createFromTimestamp($subscription->asStripeSubscription()->current_period_end)->format('d M, Y');
                                                        } else {
                                                            $renewalDate = 'N/A';
                                                        }
                                                    @endphp
                                                    {{ $renewalDate }}</span>
                                                </h4>
                                            </div>

                                        </div>
                                    </div>
                                </div>
                                @endif

                                <!-- Start Pricing Compare Detailed  -->
                                <div class="rainbow-pricing-detailed-area">
                                    <div class="row">
                                        <div class="col-lg-12">
                                            <div class="section-title text-left mb--30">
                                                <h4 class="rbt-title-style-3">Transaction History</h4>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="row row--15">
                                        <div class="col-lg-12">
                                            <div class="rainbow-compare-table style-1">
                                                <table class="table-responsive">
                                                    <thead>
                                                        <tr>
                                                            <th class="sm-radius-top-left">Date</th>
                                                            <th class="style-prymary">Amount</th>
                                                            <th class="style-prymary">Coupon</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>        
                                                        @forelse($transactions as $transaction)
                                                            <tr>
                                                                <td>{{ $transaction->created_at->format('Y-m-d H:i:s') }}</td>
                                                                <td>${{ number_format($transaction->total_amount , 2) }}</td>
                                                                <td>{{ $transaction->coupon_code ?? 'N/A' }}</td>                                                
                                                            </tr>
                                                        @empty
                                                            <tr>
                                                                <td colspan="3">No transactions found.</td>
                                                            </tr>
                                                        @endforelse                                                        
                                                    </tbody>
                                                </table>
                                            </div>
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
            <!-- Start Reason Row  -->
            <form id="cancelSubscriptionForm" method="POST" action="" class="rbt-profile-row rbt-default-form row row--15">
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
            <!-- End Reason Row  -->
          
            <button class="close-button" data-bs-dismiss="modal">
                <i class="feather-x"></i>
            </button>
        </div>
    </div>
</div>
<!-- End Modal  -->

@endsection
@push('after-scripts')
<script>
$('#contactNowButton').click(function() {
        $('#editStoreSubscrip').modal('hide');
        $('#cancelSubscriptionModal').modal('show');
    });

$('#editStoreSubscrip').on('show.bs.modal', function (event) {
    var button = $(event.relatedTarget);
    var storeId = button.data('id');
    $('#cancel_store_id').val(storeId);
});
$('#cancelSubscriptionForm  button').click(function(e){
            e.preventDefault();
            $('#cancelSubscriptionForm button').text('Please wait...');
            $('#cancelSubscriptionForm button').attr('disabled', 'disabled');
            
            if($('#cancelSubscriptionForm').valid()) {    
                url = `{{route('create_cancel_request')}}`;
                var formData = new FormData($('#cancelSubscriptionForm')[0]);
                
                uploadajax(url, formData, 'post', '', 'json', function(output) {
                    $('#cancelSubscriptionForm button').text('Submit ');
                    $('#cancelSubscriptionForm button').removeAttr('disabled');
                    if (output.success) {
                        $('.modal').modal('hide');
                        $('.successmsgdiv').html(output.message)
                        $('#thank_you').modal('show');
                    } else {
                        for (var key in output.data) {
                            existvalue = $('#store_' + key).val();
                            jQuery.validator.addMethod(key + "error", function(value, element) {
                                return this.optional(element) || value !== existvalue;
                            }, jQuery.validator.format(output.data[key][0]));
                            jQuery('#store_' + key).addClass(key + "error");
                            jQuery('#store_' + key).valid();
                        }
                    }
                });
            } else {
                $('#cancelSubscriptionForm button').text('Submit ');
                $('#cancelSubscriptionForm button').removeAttr('disabled');
            }
        });
</script>
@endpush