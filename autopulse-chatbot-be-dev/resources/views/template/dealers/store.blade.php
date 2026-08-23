@extends('layouts.dealer')

@section('content')

<section class="account_main" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-3 col-12">
                @include('template.dealers.include.sidebar')
            </div>
            <div class="col col-lg-9 col-12">
                @php
                    $user = Auth::guard('dealer')->user();  
                @endphp
                <div class="acc_right_main">
                    <div class="acc_page_head sticky" id="acc_page_head">
                        <div class="row align-items-center">
                            <div class="col col-md-6 col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    <div class="acc_page_heading">
                                        <h3>All Stores</h3>
                                    </div>
                                </div>
                            </div>
                            <div class="col col-md-6 col-12">
                                <form class="row gx-1">
                                    <div class="col col-md-6 col-12">
                                        <div class="acc_page_search">
                                            <input type="text" value="{{ $input['search'] ??'' }}" name="search" id="searchInput" class="form-control mb-md-0 mb-1" placeholder="Search">
                                        </div>
                                    </div>
                                    <div class="col col-md-3 col-6">
                                        <button type="submit" class="btn btn_theme w-100" >Search</button>
                                    </div>
                                    <div class="col col-md-3 col-6">
                                        <a href="{{ route('dealer.stores') }}" class="btn btn_theme w-100" >Reset</a>
                                    </div>
                                </form>
                            </div>
                            <div class="col col-12">
                                @if($user && !$user->email_verified_at)
                                    <div class="alert alert-danger" role="alert">
                                        Your email address is not verified. Please verify it to access all features. <a href="{{route('dealer.sendverify')}}">Send Verification Mail</a>
                                    </div>
                                @endif
                                @if (session('success'))
                                    <div class="alert alert-success">
                                        {{ session('success') }}
                                    </div>
                                @endif
                                @if (session('error'))
                                    <div class="alert alert-danger">
                                        {{ session('error') }}
                                    </div>
                                @endif
                            </div>
                        </div>
                    </div>

                    <div class="acc_page_content acc_page_box px-0 py-3">
                        <ul class="nav nav-pills border-bottom underline_tabs mb-2 mb-md-0" id="profileTab" role="tablist">
                            <li class="nav-item" role="presentation">
                                <a class="nav-link active" id="table-tab" data-bs-toggle="tab" href="#storeList" role="tab" aria-controls="storeList" aria-selected="true">All Stores</a>
                            </li>
                            <li class="nav-item" role="presentation">
                                <a class="nav-link" id="form-tab" data-bs-toggle="tab" href="#storeForm" role="tab" aria-controls="storeForm" aria-selected="false">Add Store</a>
                            </li>
                        </ul>
                        <div class="tab-content" id="employeesTabContent">
                            <!-- Stores List -->
                            <div class="tab-pane fade show active" id="storeList" role="tabpanel" aria-labelledby="table-tab">
                                <div class="position-relative">
                                    <div class="dealer_lead_card bg_yellow pt-2 px-3 d-none d-md-block">
                                        <div class="row gx-1">
                                            <div class="col col-md-3 col-8">
                                                <div class="leads_by">
                                                    <p class="mb-0">Dealership Name</p>
                                                </div>
                                            </div>
                                            <div class="col col-md-3 col-8">
                                                <div class="leads_by">
                                                    <p class="mb-0">Website</p>
                                                </div>
                                            </div>
                                            <div class="col col-md-3 col-8">
                                                <div class="leads_by">
                                                    <p class="mb-0">ADF Email</p>
                                                </div>
                                            </div>
                                            <div class="col col-md-2 col-8">
                                                <div class="leads_by">
                                                    <p class="mb-0">Subscription Status</p>
                                                </div>
                                            </div>
                                        </div>                                                                
                                    </div>
                                    @foreach($stores as $key =>$value)
                                    <div class="dealer_lead_card px-md-3" id="dealer_lead_{{ $value->id }}">
                                        <div class="row gx-1">
                                            <div class="col col-md-3 col-10">
                                                <div class="leads_by">
                                                    <p class="mb-0"><b>{{ $value->dealership_name }}</b></p>
                                                </div>
                                            </div>
                                            <div class="col col-md-3 col-10">
                                                <div class="leads_by">
                                                    <p class="mb-0">{{ $value->source }}</p>
                                                </div>
                                            </div>
                                            <div class="col col-md-3 col-10">
                                                <div class="leads_by">
                                                    <p class="mb-0">{{ $value->adf_mail }}</p>
                                                </div>
                                            </div>
                                           
                                            @if($value->is_subscribed )
                                                @php  
                                                    $currentDate = now();
                                                    $subscriptionEndDate = $value['cancelled_at'];  
                                                @endphp
                                                    @if (!empty($value['cancelled_at']) && $currentDate->gt($value['cancelled_at'])) 
                                                       
                                                    <div class="col col-md-2 col-10">
                                                            <div class="leads_by">
                                                                <a data-bs-toggle="modal" data-bs-target="#editStoreSubscrip" 
                                                                class="text_dark mb-0 edit-store"
                                                                data-id="{{ $value->id }}"
                                                                data-dealership-name="{{ $value->dealership_name }}"
                                                                data-source="{{ $value->source }}"
                                                                data-adf-email="{{ $value->adf_mail }}"
                                                                data-subscribed="{{ $value->subscribed }}">
                                                                <i class="fa-solid fa-triangle me-2 text_primary"></i>Subscribed
                                                                <small class="d-block text_secondary">Expire on {{ $value->cancelled_at }}</small>
                                                                </a>
                                                            </div>
                                                        </div>
                                                    @else
                                                        <div class="col col-md-2 col-10">
                                                            <div class="leads_by">
                                                                <a data-bs-toggle="modal" data-bs-target="#editStoreSubscrip" 
                                                                class="text_dark mb-0 edit-store"
                                                                data-id="{{ $value->id }}"
                                                                data-dealership-name="{{ $value->dealership_name }}"
                                                                data-source="{{ $value->source }}"
                                                                data-adf-email="{{ $value->adf_mail }}"
                                                                data-subscribed="{{ $value->subscribed }}">
                                                                <i class="fa-solid fa-triangle me-2 text_primary"></i>Subscribed
                                                                <small class="d-block text_secondary">Expire on {{ $value->cancelled_at }}</small>
                                                                </a>
                                                            </div>
                                                        </div>
                                                      


                                                    @endif
                                            @else

                                                <div class="col col-md-2 col-10">
                                                    <div class="leads_by">
                                                        <a data-bs-toggle="modal" onclick="loaddata(`{{ $value->id }}`)">
                                                        <i class="fa-solid fa-triangle me-2 text_primary"></i>Unsubscribed
                                                        
                                                        </a>
                                                    </div>
                                                </div>


                                            @endif
                                            <div class="col col-md-1 col-2">
                                                <div class="d-flex align-items-center">
                                                    <a href="javascript:;" 
                                                        data-bs-toggle="modal" 
                                                        data-bs-target="#editStore" 
                                                        class="text_primary ms-auto edit-store"
                                                        data-id="{{ $value->id }}"
                                                        data-dealership-name="{{ $value->dealership_name }}"
                                                        data-source="{{ $value->source }}"
                                                        data-adf-email="{{ $value->adf_mail }}"
                                                        data-is_subscribed="{{ $value->is_subscribed }}"
                                                        data-cancelled_at="{{ $value->cancelled_at }}"
                                                        data-subscribed="{{ $value->subscribed }}"
                                                        data-city="{{ $value->city }}"
                                                          data-state="{{ $value->state }}"
                                                       
                                                        data-address="{{ $value->address }}"
                                                        data-latitude="{{ $value->latitude }}"
                                                        data-longitude="{{ $value->longitude }}"
                                                        data-zip-code="{{ $value->zip_code }}"
                                                        data-phone="{{ $value->phone }}"
                                                        data-email="{{ $value->email }}"
                                                        data-call_tracking_number="{{ $value->call_tracking_number }}"
                                                        data-call_track_sms="{{ $value->call_track_sms }}">
                                                        <small>Edit</small>
                                                    </a>
                                                   
                                                </div>
                                            </div>
                                        </div>                                                                
                                    </div>
                                    @endforeach
                                </div>
                            </div>
                            
                            <!-- Add Store Form Tab -->
                            <div class="tab-pane fade" id="storeForm" role="tabpanel" aria-labelledby="form-tab">
                                <div class="row justify-content-center mt-3">
                                    <div class="col col-lg-9 col-md-12 col-12">
                                        <div class="position-relative mb-3">
                                            <form action="{{ route('dealer.addstore') }}" class="gx-3 gy-2" id="addstore" method="post" enctype="multipart/form-data">  
                                                @csrf    
                                                <div class="acc_profile_address acc_page_box border-0 bg_yellow rounded formContainer">
                                                    <div class="row gx-2">
                                                        <div class="col col-md-6 col-12">
                                                            <input type="text" id="store_dealership_name_0" name="dealership_name[]" placeholder="Dealership Name" value="" class="form-control required">
                                                        </div>
                                                        <div class="col col-md-6 col-12">
                                                            <input type="text" id="store_source_0" name="source[]" placeholder="Website" value="" class="form-control required">
                                                        </div>
                                                        <div class="col col-md-6 col-12">
                                                            <input type="text" id="store_adf_email_0" name="adf_email[]" placeholder="ADF Email" value="" class="form-control required">
                                                        </div>
                                                        <div class="col col-md-6 col-12">
                                                            <input type="text" id="store_phone_0" name="phone[]" placeholder="Contact Number" value="" class="form-control required">
                                                        </div>
                                                        <div class="col col-md-6 col-12">
                                                            <input type="text" id="store_email_0" name="email[]" placeholder="Email" value="" class="form-control required">
                                                        </div>
                                                        <div class="col col-md-6 col-12">
                                                            <input type="text" name="call_tracking_number[]" id="store_call_tracking_number_0" placeholder="Call Tracking Number" class="form-control ">
                                                        </div>
                                                        <div class="col col-md-6 col-12">
                                                            <input type="text" id="store_call_track_sms_0" name="call_track_sms[0]" placeholder="SMS Tracking Number" class="form-control ">
                                                        </div>
                                                        <div class="col col-12 d-flex align-items-center">
                                                            <div class="position-relative d-flex align-items-center mb-3">
                                                                <span><b>Subscription</b>&nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus"  data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-regular fa-circle-info"></i></a></span>
                                                                <div class="form-check mx-2">
                                                                    <input class="form-check-input required" value="1" type="radio" name="subscribed[0]" id="store_Subscription1_0" checked>
                                                                    <label class="form-check-label" for="store_Subscription1_0">Yes</label>
                                                                </div>
                                                                <div class="form-check mx-2">
                                                                    <input class="form-check-input required" value="0" type="radio" name="subscribed[0]" id="store_Subscription2_0">
                                                                    <label class="form-check-label" for="store_Subscription2_0">No</label>
                                                                </div>
                                                                <label id="store_subscribed0-error" class="error" for="store_subscribed0" ></label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div class="row gx-2">
                                                        <div class="col col-md-6 col-12">
                                                            <input type="text" id="store_address_0" name="address[]" placeholder="Address" value="" class="form-control required">
                                                            <input type="hidden" id="store_latitude_0" name="latitude[]">
                                                            <input type="hidden" id="store_longitude_0" name="longitude[]">
                                                            <input type="text" id="store_state_0" name="state[]" placeholder="state" value="" class="form-control required">
                                                        </div>
                                                        <div class="col col-md-3 col-12">
                                                            <input type="text" id="store_zip_code_0" name="zip_code[]" placeholder="ZIP Code" value="" class="form-control required">
                                                        </div>
                                                        <div class="col col-md-3 col-12">
                                                            <input type="text" id="store_city_0" name="city[]" placeholder="City" value="" class="form-control required">
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="row mt-3">
                                                    <div class="col col-6">
                                                        <div class="position-relative">
                                                            <button type="button" id="addMore" class="btn btn_theme_outline">Add More</button>
                                                        </div>
                                                    </div> 
                                                    <div class="col col-6">
                                                        <div class="leads_by text-end">
                                                            <p class="mb-0">Total Store-&nbsp;<span id="totalCount">1</span></p>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="row">
                                                    <div class="col col-md-12 col-12">
                                                        <div class="position-relative text-center mt-3">
                                                            <button type="button" id="submitStore" name="submit" class="btn btn_theme" >Submit</button> 
                                                        </div>
                                                    </div> 
                                                </div> 
                                            </form>
                                            <div id="errorMessages" class="mt-3"></div>
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
</section>

<!-- Edit Store Modal -->
<div class="modal fade" id="editStore" tabindex="-1" aria-labelledby="editStoreLabel" aria-hidden="true">
  <div class="modal-dialog modal-lg modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-body">
        <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
        <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
            <h5 class="modal-title text_primary mb-3"><b>Edit Store Details</b></h5>

            <!-- Form -->
            <form action="" class="row" id="update_store_form" method="post" enctype="multipart/form-data">  
                @csrf
              
                <input type="hidden" id="edit_store_id" name="id" value="">
                <div class="row gx-2">
                    <div class="col col-md-6 col-12">
                        <input type="text" id="edit_dealership_name" name="dealership_name" placeholder="Dealership Name" value="" class="form-control required">
                    </div>
                    <div class="col col-md-6 col-12">
                        <input type="text" id="edit_source" name="source" placeholder="Website" value="" readonly class="form-control required">
                    </div>
                    <div class="col col-md-6 col-12">
                        <input type="text" id="edit_adf_email" name="adf_email" placeholder="Adf Email" value="" class="form-control required">
                    </div>
                    <div class="col col-md-6 col-12">
                        <input type="text" id="edit_phone" name="phone" placeholder="Contact Number" value="" class="form-control required">
                    </div>
                    <div class="col col-md-6 col-12">
                        <input type="text" id="edit_call_tracking_number" name="call_tracking_number" placeholder="Call Tracking Number" class="form-control ">
                    </div>
                    <div class="col col-md-6 col-12">
                        <input type="text" id="edit_call_track_sms" name="call_track_sms" placeholder="SMS Tracking Number" class="form-control ">
                    </div>
                    <div class="col col-md-6 col-12">
                        <input type="text" id="edit_email" name="email" placeholder="Email" value="" class="form-control required">
                    </div>
                    <div class="col col-12  align-items-center storesubscriptioncheck" >
                        <div class="position-relative d-flex align-items-center mb-3">
                            <span><b>Subscription</b>&nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-regular fa-circle-info"></i></a></span>
                            <div class="form-check mx-2">
                                <input class="form-check-input" type="radio" value="1" name="subscribed" id="edit_storeSubscription1">
                                <label class="form-check-label" for="edit_storeSubscription1">Yes</label>
                            </div>
                            <div class="form-check mx-2">
                                <input class="form-check-input" type="radio" value="0" name="subscribed" id="edit_storeSubscription2">
                                <label class="form-check-label" for="edit_storeSubscription2">No</label>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="row gx-2">
                    <div class="col col-md-6 col-12">
                        <input type="text" id="edit_address" name="address" placeholder="Address" value="" class="form-control required">
                        <input type="hidden" id="edit_latitude" name="latitude">
                        <input type="hidden" id="edit_longitude" name="longitude">
                        <input type="hidden" id="edit_state" name="state">
                        
                    </div>
                    <div class="col col-md-3 col-12">
                        <input type="text" id="edit_zip_code" name="zip_code" placeholder="ZIP Code" value="" class="form-control required">
                    </div>
                    <div class="col col-md-3 col-12">
                        <input type="text" id="edit_city" name="city" placeholder="City" value="" class="form-control required">
                    </div>
                </div>
                <div class="row">
                    <div class="col col-md-12 col-12">
                        <div class="position-relative text-center mt-3">
                            <button type="button" id="updateStore" name="submit" class="btn btn_theme">Update</button> 
                        </div>
                    </div>
                </div>
            </form>
        </div>
      </div>
    </div>
  </div>
</div>



<!-- Subscribed Modal -->
<div class="modal fade" id="editStoreSubscrip" tabindex="-1" aria-labelledby="editStoreSubscripLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-body">
        <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
        <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
            <!--  -->
            <div class="position-relative text-center mb-4">
                <div class="leads_by">
                    <p class="mb-0">Kindly contact on <b><a class="text_dark" href="mailto:info@autopulse.ai">info@autopulse.ai</a></b> regarding your subscription!</p>
                </div>
            </div>
            <div class="position-relative text-center">
                <button data-bs-dismiss="modal" class="btn btn_theme_outline">Cancel</button>
                <button class="btn btn_theme" id="contactNowButton" >Contact Now</button>
            </div>
        </div>
      </div>
    </div>
  </div>
</div>


<!-- Cancel Subscription Modal -->
<div class="modal fade" id="cancelSubscriptionModal" tabindex="-1" aria-labelledby="cancelSubscriptionModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-body">
            <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
            <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                <h5 class="modal-title text_primary mb-3"><b>Cancel Subscription</b></h5>

                <!-- Form -->
                <form id="cancelSubscriptionForm" method="POST" action="">
                    @csrf
                    <input type="hidden" id="cancel_store_id" name="store_id">
                    <div class="mb-3">
                        <label for="cancel_reason" class="form-label">Reason for Cancellation</label>
                        <textarea class="form-control" id="cancel_reason" name="reason" rows="3" required></textarea>
                    </div>
                    <div class="row gx-2">
                        <div class="col col-6">
                            <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button> 
                        </div> 
                        <div class="col col-6">
                            <button type="submit" class="btn btn_theme w-100">Submit</button> 
                        </div> 
                    </div> 
                </form>
            </div>
        </div>
        </div>
    </div>
</div>

<!-- Some fields can't be editable, Please check and confirm to proceed Modal -->
<div class="modal fade" id="checkandconfirm" tabindex="-1" aria-labelledby="checkandconfirmLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-body">
        <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
        <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
            <h5 class="modal-title mb-lg-4 mb-3 text-center"><b>Some fields can't be editable, Please check and confirm to proceed</b></h5>
            <div class="position-relative text-center">
                <button data-bs-dismiss="modal" class="btn btn_theme_outline">Cancel</button>
                <button id="confirmedbtn"  class="btn btn_theme">Confirm</button>
            </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Store Added Successfully! Modal -->
<div class="modal fade" id="storeAdded" tabindex="-1" aria-labelledby="storeAddedLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-body">
        <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
        <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
            <div class="position-relative text-center text_primary mb-3">
            <i class="fa-duotone fa-circle-check fa-4x"></i>
            </div>
            <h5 class="modal-title mb-2 text-center"><b>Store Added Successfully!</b></h5>
            <div class="position-relative text-center mb-4">
                <div class="leads_by">
                    <p class="mb-0 text_primary">Complete Subscription Payment to Avail the Premium Features</p>
                </div>
            </div>
            <div class="position-relative text-center">
            <a data-bs-toggle="modal" data-bs-target="#storeCheckout" onclick="storesubscription()" data-bs-dismiss="modal" class="btn btn_theme w-100">Pay Now</a>
            </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header border-0">
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body pb-4">
                <div class="position-relative text-center">
                    <i class="fa-regular fa-circle-xmark fa-4x mb-3 text-danger"></i>
                    <h5 class="mb-4">Are you sure? You want to delete?</h5>
                    <div class="position-relative text-center">                    
                        <button type="button" class="btn btn-danger" id="confirmDelete">Yes</a>
                        <button type="button" class="btn btn-secondary ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
@endsection

@push('after-scripts')
<script src="https://maps.googleapis.com/maps/api/js?key={{ env('GOOGLE_PLACE_API') }}&libraries=places"></script>
<script>
    var popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'))
    var popoverList = popoverTriggerList.map(function (popoverTriggerEl) {
    return new bootstrap.Popover(popoverTriggerEl)
    })

    storelist =[];
    function initializeAutocomplete(inputId, latId, lngId,zipId,cityId,stateId) {
        var input = document.getElementById(inputId);
        var autocomplete = new google.maps.places.Autocomplete(input);

        autocomplete.addListener('place_changed', function() {
            var place = autocomplete.getPlace();
            if (place.geometry) {
                document.getElementById(latId).value = place.geometry.location.lat();
                document.getElementById(lngId).value = place.geometry.location.lng();
            }
            // Reset the zip and city values
            document.getElementById(zipId).value = '';
            document.getElementById(cityId).value = '';
            document.getElementById(stateId).value = '';
            // Loop through the address components and set the zip and city values
            for (var i = 0; i < place.address_components.length; i++) {
                var component = place.address_components[i];
                if (component.types.includes('postal_code')) {
                    document.getElementById(zipId).value = component.long_name;
                }
                if (component.types.includes('locality')) {
                    document.getElementById(cityId).value = component.long_name;
                }
                if (component.types.includes('administrative_area_level_1')) {
                    document.getElementById(stateId).value = component.long_name; // You can also use short_name for state code (e.g., CA)
                }
            }
        });
    }

    $('#deleteModal').on('show.bs.modal', function (e) {
        var button = $(e.relatedTarget);
        var id = button.data('id');
        $('#deleteModal').data('id', id);
    });
    $('#confirmDelete').on('click', function () {
        var id = $('#deleteModal').data('id');
        formData ={ id: id };
      
        uploadajax(url, formData, 'get', '', 'json', function(output) {
        
           
                if (output.success) {
                    $('#dealer_lead_'+id).remove();
                    $('#deleteModal').modal('hide');
                } else {
                    // Handle deletion errors
                }
            
        });
    });

    $(document).ready(function() {
        var count = 1;
        initializeAutocomplete('store_address_0', 'store_latitude_0', 'store_longitude_0','store_zip_code_0','store_city_0','store_state_0');

        $('#addMore').click(function() {
            var newFormContainer = $('.formContainer').first().clone();
            newFormContainer.find('input').not(':radio').val('');
            newFormContainer.find('input').each(function() {
                var name = $(this).attr('name');
                var newName = name.replace(/\[\d+\]/, '[' + count + ']');
                $(this).attr('name', newName);
                var id = $(this).attr('id');
                var newId = id.replace(/_\d+$/, '_' + count);
                $(this).attr('id', newId);
            });
            newFormContainer.find('input[type="radio"]').each(function() {
                var name = $(this).attr('name');
                var newName = name.replace(/\[\d+\]/, '[' + count + ']');
                $(this).attr('name', newName);
                var id = $(this).attr('id');
                var newId = id.replace(/_\d+$/, '_' + count);
                $(this).attr('id', newId);
                var label = $(this).next('label');
                label.attr('for', newId);
            });
            $('.formContainer').last().after(newFormContainer);
            initializeAutocomplete('store_address_' + count, 'store_latitude_' + count, 'store_longitude_' + count, 'store_zip_code_' + count, 'store_city_' + count,'store_state_' + count);
            count++;
            $('#totalCount').text(count);
        });
        $('#submitStore').click(function(){
            $('#checkandconfirm').modal('show');
        });
        $('#confirmedbtn ').click(function(e){
            e.preventDefault();
            $('#checkandconfirm').modal('hide');
            $('#submitStore').text('Please wait...');
            $('#submitStore').attr('disabled', 'disabled');
            
            if($('#addstore').valid()) {    
                url = `{{route('dealer.addstore')}}`;
                var formData = new FormData($('#addstore')[0]);
                
                uploadajax(url, formData, 'post', '', 'json', function(output) {
                    $('#submitStore').text('Add Store ');
                    $('#submitStore').removeAttr('disabled');
                   
                    if (output.success) {
                        $('.successmsgdiv').html(output.message)
                      
                        $('#addstore')[0].reset();
                      
                        storelist = [];
                        output.data.forEach(function(value, key) {
                            storelist.push(value);
                        });
                        if (storelist.length) {
                            $('#storeAdded').modal('show');
                            // You can add any logic here if needed when storelist is not empty
                        } else {
                            $('#thank_you').modal('show');
                            window.location.href ="{{ route('dealer.stores') }}";
                        }


                    } else {
                        console.log(output.data);
                        for (var item in output.data) {
                            
                            var key = item.replace('.', '_');
                            console.log(key);
                            existvalue = $('#store_' + key).val();
                            jQuery.validator.addMethod(key + "error", function(value, element) {
                                return this.optional(element) || value !== existvalue;
                            }, jQuery.validator.format(output.data[item][0]));
                            jQuery('#store_' + key).addClass(key + "error");
                            jQuery('#store_' + key).valid();
                        }
                    }
                });
            } else {
                
                $('#submitStore').text('Add Store');
                $('#submitStore').removeAttr('disabled');
            }
        });

        function displayErrors(errors) {
            var errorHtml = '<div class="alert alert-danger"><ul>';
            $.each(errors, function(key, error) {
                errorHtml += '<li>' + error[0] + '</li>';
            });
            errorHtml += '</ul></div>';
            $('#errorMessages').html(errorHtml);
        }

        function displayFieldErrors(errors) {
            for (var key in errors) {
                var inputId = key.replace('.', '_');
                var errorMessage = errors[key][0];
                $('#store_' + inputId).addClass('is-invalid');
                $('#store_' + inputId).after('<span class="invalid-feedback">' + errorMessage + '</span>');
            }
        }

        // Edit Store Modal
        $('.edit-store').click(function() {
            var id = $(this).data('id');
            var dealershipName = $(this).data('dealership-name');
            var source = $(this).data('source');
            var adfEmail = $(this).data('adf-email');
            var subscribed = $(this).data('subscribed');
            var address = $(this).data('address');
            var latitude = $(this).data('latitude');
            var longitude = $(this).data('longitude');
            var zipCode = $(this).data('zip-code');
            var city = $(this).data('city');
            var state = $(this).data('state');
            var phone = $(this).data('phone');
            var email = $(this).data('email');
            var edit_call_tracking_number = $(this).data('call_tracking_number');
            var call_tracking_sms = $(this).data('call_tracking_sms');
            var is_subscribed = $(this).data('is_subscribed');
           // var is_subscribed = $(this).data('call_tracking_sms');

           

            $('#edit_call_tracking_number').val(edit_call_tracking_number);
            $('#edit_call_track_sms').val(call_tracking_sms);

            $('#edit_store_id').val(id);
            $('#edit_dealership_name').val(dealershipName);
            $('#edit_source').val(source);
            $('#edit_adf_email').val(adfEmail);
            
            if(subscribed == "1") {
                $('#edit_storeSubscription1').prop('checked', true);
            } else {
                $('#edit_storeSubscription2').prop('checked', true);
            }
            $('#edit_address').val(address);
            $('#edit_phone').val(phone);
            $('#edit_email').val(email);
            $('#edit_latitude').val(latitude);
            $('#edit_longitude').val(longitude);
            $('#edit_zip_code').val(zipCode);
            $('#edit_city').val(city);
            $('#edit_state').val(state);
            console.log('is_subscribed',is_subscribed);
            if(is_subscribed){
                $('.storesubscriptioncheck').hide()
            }else{
                $('.storesubscriptioncheck').show()
            }

            initializeAutocomplete('edit_address', 'edit_latitude', 'edit_longitude', 'edit_zip_code', 'edit_city', 'edit_state');
        });
        $('#update_store_form  button').click(function(e){
            e.preventDefault();
            $('#update_store_form button').text('Please wait...');
            $('#update_store_form button').attr('disabled', 'disabled');
            
            if($('#update_store_form').valid()) {    
                url = `{{route('dealer.updateStore')}}`;
                var formData = new FormData($('#update_store_form')[0]);
                
                uploadajax(url, formData, 'post', '', 'json', function(output) {
                    $('#update_store_form button').text('Update ');
                    $('#update_store_form button').removeAttr('disabled');
                    if (output.success) {
                        $('.modal').modal('hide')
                        $('.successmsgdiv').html(output.message)
                      

                        storelist = [];
                        output.data.forEach(function(value, key) {
                            storelist.push(value);
                        });
                        if (storelist.length) {
                            $('#storeAdded').modal('show');
                            // You can add any logic here if needed when storelist is not empty
                        } else {
                            $('#thank_you').modal('show');
                            window.location.href ="{{ route('dealer.stores') }}";
                        }


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
                $('#update_store_form button').text('Submit');
                $('#update_store_form button').removeAttr('disabled');
            }
        });

        $('#cancelSubscriptionForm  button').click(function(e){
            e.preventDefault();
            $('#cancelSubscriptionForm button').text('Please wait...');
            $('#cancelSubscriptionForm button').attr('disabled', 'disabled');
            
            if($('#cancelSubscriptionForm').valid()) {    
                url = `{{route('dealer.store.create.request')}}`;
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
    });

    function loaddata(store_id){
        var storelist = [];
        storelist.push(store_id);
        data ={ storelist: storelist };
        loadStoreCartPopup(data);
    }

    function loadStoreCartPopup(data = {}) {
        url = '{{ route("dealer.cart") }}';
        data = {
                ...data,
                _token: '{{ csrf_token() }}'
            };
        runajax(url,data , 'post', '', 'json', function(response) {
        
            $('#storeCheckout').modal('show');
            $('#cardpopupbody').html(response.html);
        
        }); 
        
    }
    function storesubscription()
    {
        data ={ storelist: storelist };
        loadStoreCartPopup(data);
    }

    $('#searchInput').on('keyup', function() {
            var value = $(this).val().toLowerCase();
            $('.store-item').filter(function() {
                $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1);
            });
        });

    $('#contactNowButton').click(function() {
        $('#editStoreSubscrip').modal('hide');
        $('#cancelSubscriptionModal').modal('show');
    });

    $('#editStoreSubscrip').on('show.bs.modal', function (event) {
        var button = $(event.relatedTarget);
        var storeId = button.data('id');
        $('#cancel_store_id').val(storeId);
    });
</script>
@endpush
