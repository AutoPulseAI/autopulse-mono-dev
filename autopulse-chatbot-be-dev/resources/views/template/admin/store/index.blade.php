@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">

<div class="position-relative">
    <div class="row gx-2">
        <div class="col col-md-12 col-12 page_title">
            <div class="page_title mb-3">
                <h2>Manage Store</h2>
            </div>
        </div>
        <div class="col col-lg-10 col-md-12 col-12">
            <div class="position-relative">
                <form id="searchForm" class="row gx-1 justify-content-md-end">
                    <div class="col col-lg-3 col-md-3 col-12 ">
                        <div class="position-relative">
                            <select class="form-select w-100" name="dealer_id" id="dealerGroupSelect">
                                <option value="">Select Dealer Group</option>
                                @foreach($dealerGroup as $key => $value)
                                    @if($value->dealership_group )
                                    <option value="{{ $value->id }}">{{ $value->dealership_group }}</option>
                                    @endif
                                @endforeach
                            </select>
                        </div>                        
                    </div>
                    <div class="col col-lg-3 col-md-3 col-12 ">
                        <select class="form-select w-100" name="is_manage_by_admin" id="subscriptionTypeSelect">
                            <option value="">Subscription Type</option>
                            <option value="0">Automated</option>
                            <option value="1">Manual Payment</option>
                        </select>
                    </div>
                    <div class="col col-lg-2 col-md-2 col-12 ">
                        <select class="form-select w-100" name="is_subscribed" id="isSubscribedSelect">
                            <option value="">Subscribed</option>
                            <option value="0">Not Subscribed</option>
                            <option value="1">Subscribed</option>
                        </select>
                    </div>
                    <div class="col col-lg-2 col-md-2 col-6 ">
                        <button type="submit" class="btn btn_theme w-100">Search</button>
                    </div>
                    <div class="col col-lg-2 col-md-2 col-6 ">
                        <a href="{{ route('admin.stores') }}" class="btn btn_theme w-100">Reset</a>
                    </div>
                </form>
            </div>
        </div>
        <div class="col col-lg-2 col-md-3 col-6 ms-auto ms-lg-0">
            <button id="downloadCSV" class="btn btn_dark w-100">Download CSV</button>
        </div>
        <!--div class="col col-lg-2 col-md-3 col-6">
            <button class="btn btn_dark w-100" data-bs-toggle="modal" data-bs-target="#uploadCSVModal">Upload CSV</button>
        </div-->
    </div>

    @if(session()->has('success'))
        <div class="row">
            <div class="alert alert-success alert-dismissible text-white" role="alert">
                <span class="text-sm">{{ Session::get('success') }}</span>
                <button type="button" class="btn-close text-lg py-3 opacity-10" data-bs-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    @endif

    <div class="tab_box">
        <ul class="nav nav-pills underline_tabs border-bottom mt-3" role="tablist">
            <li class="nav-item">
                <a class="nav-link active" data-bs-toggle="pill" id="storelistall" href="#storesList">All Stores</a>
            </li>
            <li class="nav-item">
                <a class="nav-link" data-bs-toggle="pill" href="#storesForm">Add Store</a>
            </li>
        </ul>

        <div class="tab-content">
            <div id="storesList" class="tab-pane active">
                <div class="position-relative table-responsive pt-2" style="min-height: 300px;">
                    <table class="table table-bordered w-100 dataTable" id="store_tabl">
                        <thead>
                            <tr>
                                <td>#</td>
                                <td>Dealership Group</td>
                                <td>Dealership Store</td>
                                <td>Dealership Website</td>
                                <td>ADF Email</td>
                                <td>Subscription Enabled</td>
                                <td>Subscription Type</td>
                                <td>Subscription Price</td>
                                <td>Subscription Status</td>
                                <td>Free Trial</td>
                                <td>Free Trial Start</td>
                                <td>Free Trial End</td>
                                <td>Expiry Date</td>
                                <td>Action</td>
                            </tr>
                        </thead>
                        <tbody>
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="storesForm" class="tab-pane fade">
                <div class="row justify-content-center mt-3">
                    <div class="col col-xl-7 col-lg-9 col-md-12 col-12">
                        <div class="position-relative mb-3">
                            <form id="storeFormform" class="gx-3 gy-2">
                                @csrf
                                <input type="hidden" id="store_id" name="id">
                                <div id="storeContainer">
                                    <div class="tab_box_form border-0 bg_yellow rounded formContainer">
                                        <div class="row gx-2 mb-3">
                                            <div class="col col-12">
                                                <h6 class="mb-3">Dealership Details</h6>
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <select class="form-select w-100 dealergroupselect required" id="store_dealer_id_0" name="dealer_id[]">
                                                    <option selected disabled>Select Dealer Group</option>
                                                    @foreach($dealerGroup as $key => $value)
                                                        <option value="{{ $value->id }}">{{ $value->dealership_group }}</option>
                                                    @endforeach
                                                </select>
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="text" name="dealership_name[0]" id="store_dealership_name_0" placeholder="Dealership name" class="form-control required">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="text" name="source[0]" id="store_source_0"  placeholder="Dealership url" class="form-control required">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="text" name="adf_mail[0]" id="store_adf_mail_0"  placeholder="Adf Email" class="form-control required">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="text" id="call_tracking_number_0" name="call_tracking_number[0]" placeholder="Call Tracking Number" class="form-control ">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="text" id="call_track_sms_0" name="call_track_sms[0]" placeholder="SMS Tracking Number" class="form-control ">
                                            </div>
                                            
                                        </div>

                                        <div class="row gx-2 mb-3">
                                            <div class="col col-12">
                                                <h6 class="mb-3">BDC Contact Information</h6>
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="text" name="email[0]" id="store_email_0" placeholder="Dealer Email" class="form-control required">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="text" name="phone[0]" id="store_phone_0" placeholder="Contact Number" class="form-control required">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="text" name="address[0]" id="store_address_0"  placeholder="Store Address" class="form-control required">
                                                <input type="hidden" id="store_latitude_0" name="latitude[]">
                                                <input type="hidden" id="store_longitude_0" name="longitude[]">
                                            </div>
                                            <div class="col col-md-3 col-12">
                                                <input type="text" name="city[0]" id="store_city_0" placeholder="City" class="form-control required">
                                                <input type="hidden" name="state[0]" id="store_state_0" placeholder="State" class="form-control required">
                                            </div>
                                            <div class="col col-md-3 col-12">
                                                <input type="text" name="zip_code[0]" id="store_zip_code_0" placeholder="Zip code" class="form-control required">
                                            </div>
                                        </div>

                                        <div class="row gx-2">
                                            <div class="col col-xl-12 col-md-12 col-12 d-flex align-items-center">
                                                <div class="position-relative d-flex align-items-center mb-3">
                                                    <span>Subscription&nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-solid fa-circle-info"></i></a></span>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input subscribed" type="radio" value="1" name="subscribed[0]" id="add_subyes_0" checked>
                                                        <label class="form-check-label" for="add_subyes_0">Yes</label>
                                                    </div>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input subscribed" type="radio" value="0" name="subscribed[0]" id="add_subno_0">
                                                        <label class="form-check-label" for="add_subno_0">No</label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="col col-xl-12 col-md-12 col-12 align-items-center subscription_type_div_0">
                                                <div class="position-relative d-flex align-items-center mb-3">
                                                    <span>Subscription Type&nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-solid fa-circle-info"></i></a></span>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input subscription_type" type="radio" value="0" name="subscription_type[0]" id="add_default_0">
                                                        <label class="form-check-label" for="add_default_0">Automated</label>
                                                    </div>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input subscription_type" type="radio" value="1" name="subscription_type[0]" id="add_manual_0" checked>
                                                        <label class="form-check-label" for="add_manual_0">Manual Payment</label>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="row gx-2 subscription_details_0">
                                            <div class="col col-md-6 col-12">
                                                <label class="mb-1">Monthly Subscription Price for manual billing</label>
                                                <input type="text" id="store_subscription_price_0" name="subscription_price[]" placeholder="Monthly Subscription Price for manual billing" class="form-control">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <label class="mb-1">Subscription End Date</label>
                                                <input type="date" id="store_subscription_end_date_0" name="subscription_end_date[]" placeholder="Subscription End Date" class="form-control">
                                            </div>
                                            <div class="col col-xl-12 col-md-12 col-12 align-items-center ">
                                                <div class="position-relative d-flex align-items-center mb-3">
                                                    <span>Free Trial&nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-solid fa-circle-info"></i></a></span>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input free_trial" type="radio" value="0" name="free_trial[0]" id="free_trial_0" checked>
                                                        <label class="form-check-label" for="free_trial_0">No</label>
                                                    </div>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input free_trial" type="radio" value="1" name="free_trial[0]" id="free_trial_1" >
                                                        <label class="form-check-label" for="free_trial_1">Yes</label>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="row gx-2 free_trial_detail_0" style="display:none">
                                            <div class="col col-md-6 col-12">
                                                <label class="mb-1">Free Trial Start Date</label>
                                                <input type="date" id="free_trial_start_date_0" name="free_trial_start_date[]" placeholder="Free Trial Start Date" class="form-control">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <label class="mb-1">Free Trial End Date</label>
                                                <input type="date" id="free_trial_end_date_0" name="free_trial_end_date[]" placeholder="Free Trial End Date" class="form-control">
                                            </div>
                                            
                                        </div>
                                        
                                    </div>
                                </div>

                                <div class="row mt-3">
                                    <div class="col col-6">
                                        <div class="position-relative">
                                            <button type="button" id="addMore" class="btn btn-outline-primary">Add More</button>
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
                                            <button type="submit" id="submitStore" class="btn btn_theme">Submit</button>
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

    <!-- Modals for View, Edit, and Delete -->
    <div class="modal fade" id="viewStore" tabindex="-1" aria-labelledby="viewStoreLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-body">
                    <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                    <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                        <h5 class="modal-title text_primary mb-3"><b>View Store Details</b></h5>
                        <!-- Form for viewing store details -->
                        <form id="viewStoreForm" class="gx-3 gy-2">
                            @csrf
                            <div class="row gx-2 mb-3">
                                <div class="col col-12">
                                    <h6 class="mb-3">Dealership Details</h6>
                                </div>
                                <div class="col col-md-6 col-12">
                                    <select class="form-select w-100" id="view_dealergroupselect" disabled>
                                        <option selected disabled>Select Dealer Group</option>
                                        @foreach($dealerGroup as $key => $value)
                                            <option value="{{ $value->id }}">{{ $value->dealership_group }}</option>
                                        @endforeach
                                    </select>
                                </div>
                                
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="view_store_dealership_name" placeholder="Dealership name" class="form-control" disabled>
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="view_store_source" placeholder="Dealership url" class="form-control" disabled>
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="view_store_adf_email" placeholder="Adf Email" class="form-control" disabled>
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="view_store_call_tracking_number" name="call_tracking_number" placeholder="Call Tracking Number" class="form-control ">
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="view_store_call_track_sms" name="call_track_sms" placeholder="SMS Tracking Number" class="form-control ">
                                </div>
                            </div>

                            <div class="row gx-2 mb-3">
                                <div class="col col-12">
                                    <h6 class="mb-3">BDC Contact Information</h6>
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="view_store_email" placeholder="Dealer Email" class="form-control" disabled>
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="view_store_phone" placeholder="Contact Number" class="form-control" disabled>
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="view_store_address" placeholder="Address" class="form-control" disabled>
                                </div>
                                <div class="col col-md-3 col-12">
                                    <input type="text" id="view_store_city" placeholder="City" class="form-control" disabled>
                                    <input type="hidden" id="view_store_state" placeholder="State" class="form-control" disabled>
                                </div>
                                <div class="col col-md-3 col-12">
                                    <input type="text" id="view_store_zip_code" placeholder="Zip code" class="form-control" disabled>
                                </div>
                            </div>

                            <div class="row gx-2">
                                <div class="col col-6">
                                    <button type="button" data-bs-dismiss="modal" class="btn btn-outline-primary w-100 mt-3">Cancel</button>
                                </div>
                                <div class="col col-6">
                                    <button type="button" class="btn btn_theme w-100 mt-3" data-bs-toggle="modal" data-bs-target="#editStore" data-bs-dismiss="modal">Edit</button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Edit Store Modal -->
    <div class="modal fade" id="editStore" tabindex="-1" aria-labelledby="editStoreLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-body">
                    <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                    <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                        <h5 class="modal-title text_primary mb-3"><b>Edit Store Details</b></h5>
                        <!-- Form for editing store details -->
                        <form id="editStoreForm" class="gx-3 gy-2">
                            @csrf
                            <input type="hidden" id="edit_store_id" name="id">
                            <div class="row gx-2 mb-3">
                                <div class="col col-12">
                                    <h6 class="mb-3">Dealership Details</h6>
                                </div>
                                <div class="col col-md-6 col-12">
                                    <select class="form-select w-100" id="edit_dealergroupselect" name="dealer_id">
                                        <option selected disabled>Select Dealer Group</option>
                                        @foreach($dealerGroup as $key => $value)
                                            <option value="{{ $value->id }}">{{ $value->dealership_group }}</option>
                                        @endforeach
                                    </select>
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="edit_store_dealership_name" name="dealership_name" placeholder="Dealership name" class="form-control required">
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="edit_store_source" name="source" placeholder="Dealership url" class="form-control required">
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="edit_store_adf_email" name="adf_mail" placeholder="Adf Email" class="form-control required">
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="edit_store_call_tracking_number" name="call_tracking_number" placeholder="Call Tracking Number" class="form-control ">
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="edit_store_call_track_sms" name="call_track_sms" placeholder="SMS Tracking Number" class="form-control ">
                                </div>
                            </div>

                            <div class="row gx-2 mb-3">
                                <div class="col col-12">
                                    <h6 class="mb-3">Personal Contact Information</h6>
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="edit_store_email" name="email" placeholder="Dealer Email" class="form-control required">
                                </div>
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="edit_store_phone" name="phone" placeholder="Contact Number" class="form-control required">
                                </div>
                                
                                <div class="col col-md-6 col-12">
                                    <input type="text" id="edit_store_address" name="address" placeholder="Address" class="form-control required">
                                    <input type="hidden" id="edit_latitude" name="latitude">
                                    <input type="hidden" id="edit_longitude" name="longitude">
                                    <input type="hidden" id="edit_store_state" name="state" placeholder="State" class="form-control required">
                               
                                </div>
                                <div class="col col-md-3 col-12">
                                    <input type="text" id="edit_store_city" name="city" placeholder="City" class="form-control required">
                                </div>
                                
                                   
                                <div class="col col-md-3 col-12">
                                    <input type="text" id="edit_store_zip_code" name="zip_code" placeholder="Zip code" class="form-control required">
                                </div>
                            </div>
                            <div class="row gx-2">
                                <div class="col col-md-12 col-12  align-items-center cant_edit" style="display:none;">
                                    <p>Can`t Edit as this subscripiton is managed manually.&nbsp;<a type="button" class="text_primary cursor-pointer first_cancelled"><i class="fa-solid fa-circle-info"></i></a></p>
                                    <!-- <button type="button" class="btn btn-outline-primary w-100 mt-3 first_cancelled">info</button> -->
                                </div>
                            </div>
                            <div class="row gx-2">
                                <div class="col col-md-6 col-12 d-flex align-items-center">
                                    <div class="position-relative d-flex align-items-center mb-3">
                                        <span>Subscription&nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-solid fa-circle-info"></i></a></span>
                                        <div class="form-check mx-2">
                                            <input class="form-check-input" type="radio" value="1" name="subscribed" id="edit_subyes">
                                            <label class="form-check-label" for="edit_subyes">Yes</label>
                                        </div>
                                        <div class="form-check mx-2 " >
                                            <input class="form-check-input" type="radio" value="0" name="subscribed" id="edit_subno">
                                            <label class="form-check-label" for="edit_subno">No</label>
                                        </div>
                                    </div>
                                </div>
                                <div class="col col-md-6 col-12 d-flex align-items-center">
                                    <div class="position-relative d-flex align-items-center mb-3">
                                        <span>Subscription Type&nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-solid fa-circle-info"></i></a></span>
                                        <div class="form-check mx-2">
                                            <input class="form-check-input" type="radio" value="0" name="is_manage_by_admin" id="edit_default">
                                            <label class="form-check-label" for="edit_default">Automated</label>
                                        </div>
                                        <div class="form-check mx-2">
                                            <input class="form-check-input" type="radio" value="1" name="is_manage_by_admin" id="edit_manual">
                                            <label class="form-check-label" for="edit_manual">Manual Payment</label>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Subscription type manual -->
                            <div class="row gx-2 subscription_details">
                                <div class="col col-md-4 col-12">
                                    <input type="text" id="edit_subscription_price" name="subscription_price" placeholder="Monthly Subscription Price for manual billing" class="form-control required">
                                </div>
                              
                                <div class="col col-md-4 col-12">
                                    <input type="date" id="edit_subscription_end_date" name="subscription_end_date" placeholder="Subscription End Date" class="form-control required">
                                </div>
                                <div class="col col-xl-12 col-md-12 col-12 align-items-center ">
                                    <div class="position-relative d-flex align-items-center mb-3">
                                        <span>Free Trial&nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-solid fa-circle-info"></i></a></span>
                                        <div class="form-check mx-2">
                                            <input class="form-check-input free_trial" type="radio" value="0" name="free_trial" id="free_trial_no" checked>
                                            <label class="form-check-label" for="free_trial_0">No</label>
                                        </div>
                                        <div class="form-check mx-2">
                                            <input class="form-check-input free_trial" type="radio" value="1" name="free_trial" id="free_trial_yes" >
                                            <label class="form-check-label" for="free_trial_1">Yes</label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="row gx-2 edit_free_trial_detail" style="display:none">
                                <div class="col col-md-6 col-12">
                                    <label class="mb-1">Free Trial Start Date</label>
                                    <input type="date" id="edit_free_trial_start_date" name="free_trial_start_date" placeholder="Free Trial Start Date" class="form-control">
                                </div>
                                <div class="col col-md-6 col-12">
                                    <label class="mb-1">Free Trial End Date</label>
                                    <input type="date" id="edit_free_trial_end_date" name="free_trial_end_date" placeholder="Free Trial End Date" class="form-control">
                                </div>
                                
                            </div>

                            <div class="row gx-2">
                                <div class="col col-6">
                                    <button type="button" data-bs-dismiss="modal" class="btn btn-outline-primary w-100 mt-3">Cancel</button>
                                </div>
                                <div class="col col-6">
                                    <button type="submit" id="updateStore" class="btn btn_theme w-100 mt-3">Update Details</button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Delete Store Modal -->
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
                            <div class="row gx-2">
                                <div class="col col-6">
                                    <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button>
                                </div>
                                <div class="col col-6">
                                    <button type="button" id="confirmDelete" class="btn btn_theme w-100">Yes</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="cancelmodel" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header border-0">
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body pb-4">
                    <div class="position-relative text-center">
                        <i class="fa-regular fa-circle-xmark fa-4x mb-3 text-danger"></i>
                        <h5 class="mb-4">Are you sure? You want to Cancel?</h5>
                        <div class="position-relative text-center">
                            <div class="row gx-2">
                                <div class="col col-6">
                                    <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button>
                                </div>
                                <div class="col col-6">
                                    <button type="button" id="confirmcancel" class="btn btn_theme w-100">Yes</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="cancelled_model" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
             
                <div class="modal-body pb-4">
                    <div class="position-relative text-center">
                        <i class="fa-regular fa-circle-xmark fa-4x mb-3 text-danger"></i>
                        <h5 class="mb-4">To change the subscription you need to cancelled it first.</h5>
                        
                    </div>
                </div>
            </div>
        </div>
    </div>
    <!-- Upload CSV Modal -->
    <div class="modal fade" id="uploadCSVModal" tabindex="-1" aria-labelledby="uploadCSVModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="uploadCSVModalLabel">Upload CSV</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <form id="uploadCSVForm" enctype="multipart/form-data">
                        @csrf
                        <div class="mb-3">
                            <label for="csvFile" class="form-label">CSV File</label>
                            <input type="file" class="form-control" id="csvFile" name="csvFile" required>
                        </div>
                        <button type="submit" class="btn btn-primary">Upload</button>
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

@endsection

@section('script')
<script src="https://maps.googleapis.com/maps/api/js?key={{ env('GOOGLE_PLACE_API') }}&libraries=places"></script>
<script>
    initializeAutocomplete('store_address_0', 'store_latitude_0', 'store_longitude_0','store_zip_code_0','store_city_0','store_state_0');
    initializeAutocomplete('edit_store_address', 'edit_latitude', 'edit_longitude','edit_store_zip_code','edit_store_city','edit_store_state');

    var storeTable = $('#store_tabl').DataTable({
        processing: true,
        serverSide: true,
        order: [[0, 'desc']], 
        ajax: {
            url: '{{ route('admin.store.tableData') }}',
            type: 'GET',
            data: function (d) {
                d.dealer_id = $('#dealerGroupSelect').val();
                d.is_manage_by_admin = $('#subscriptionTypeSelect').val();
                d.is_subscribed = $('#isSubscribedSelect').val();
            }
        },
        columns: [
            { data: 'id', name: 'id' },
            { data: 'dealer.dealership_group', name: 'dealer.dealership_group' },
            { data: 'dealership_name', name: 'dealership_name' },
            { data: 'source', name: 'source' },
            { data: 'adf_mail', name: 'adf_mail' },
            { 
                data: 'subscribed', 
                name: 'subscribed',
                render: function(data, type, row) {
                    return data == 1 ? 'Enabled' : 'Disabled';
                }
            },
            
            { 
                data: 'is_manage_by_admin', 
                name: 'is_manage_by_admin',
                render: function(data, type, row) {
                    return data == 0 ? 'Automated' : 'Manual Payment';
                }
            },
            { data: 'subscription_price', name: 'subscription_price' },
            { 
                data: 'is_subscribed', 
                name: 'is_subscribed',
                render: function(data, type, row) {
                    return data == 1 ? 'Subscribed' : 'Not Subscribed';
                }
            },
            { 
                data: 'free_trial', 
                name: 'free_trial',
                render: function(data, type, row) {
                    return data == 1 ? 'Yes' : 'No';
                }
            },
            { 
                data: 'free_trial_start_date', 
                name: 'free_trial_start_date',
               
            },
            { 
                data: 'free_trial_end_date', 
                name: 'free_trial_end_date',
               
            },
            { data: 'cancelled_at', name: 'cancelled_at' },
            {
                data: null,
                orderable: false,
                searchable: false,
                render: function (data, type, row) {
                    var cancelsubscritpion='';
                    var editButton = `<a class="dropdown-item editDealer" data-id="` + row.id + `" data-bs-toggle="modal" data-bs-target="#editStore">Edit</a>`;
                    var deleteButton = `<a class="dropdown-item" data-id="` + row.id + `" data-bs-toggle="modal" data-bs-target="#deleteModal">Delete</a>`;
                    var viewButton = `<a class="dropdown-item" data-id="` + row.id + `" data-bs-toggle="modal" data-bs-target="#viewStore">View</a>`;
                    var loginas = `<a target="_blank" class="dropdown-item " href="{{ route('loginasdealer') }}?dealer=` + row.dealer_id + `">Login As Dealer</a>`;
                    if(row.is_manage_by_admin==0 && row.is_subscribed ==1)
                     cancelsubscritpion = `<a class="dropdown-item" data-id="` + row.id + `" data-bs-toggle="modal" data-bs-target="#cancelmodel">Cancel Subscription</a>`;
                    return `
                        <div class="table_action dropdown">
                            <a class="dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical"></i></a>
                            <ul class="dropdown-menu">
                                <li>` + editButton + `</li>
                                <li>` + viewButton + `</li>
                                <li>` + cancelsubscritpion + `</li>
                                  <li>` + loginas + `</li>
                               
                            </ul>
                        </div>
                    `;
                },
            },
        ],
    });

    $('#searchForm').on('submit', function (e) {
        e.preventDefault();
        storeTable.draw();
    });

    var count = 1;
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

    $('#addMore').click(function () {
        var newFormContainer = $('.formContainer').first().clone();
        newFormContainer.find('input').not(':radio').val('');
        newFormContainer.find('input[type="radio"]').prop('checked', false);

        newFormContainer.find('input').each(function () {
            var name = $(this).attr('name');
            var newName = name.replace(/\[\d+\]/, '[' + count + ']');
            $(this).attr('name', newName);

            var id = $(this).attr('id');
            if (id) {
                var newId = id.replace(/_\d+$/, '_' + count);
                $(this).attr('id', newId);
            }
        });

        newFormContainer.find('input[type="radio"]').each(function () {
            var name = $(this).attr('name');
            var newName = name.replace(/\[\d+\]/, '[' + count + ']');
            $(this).attr('name', newName);

            var id = $(this).attr('id');
            var newId = id.replace(/_\d+$/, '_' + count);
            $(this).attr('id', newId);
            var label = $(this).next('label');
            label.attr('for', newId);
        });

        newFormContainer.find('.subscription_type_div_0').each(function () {
           $(this).removeClass('subscription_type_div_0').addClass('subscription_type_div_' + count);
        });
        newFormContainer.find('.subscription_details_0').each(function () {
           $(this).removeClass('subscription_details_0').addClass('subscription_details_' + count);
        });
        newFormContainer.find('.free_trial_detail_0').each(function () {
           $(this).removeClass('free_trial_detail_0').addClass('free_trial_detail_' + count);
        });

        $('#storeContainer').append(newFormContainer);
        initializeAutocomplete('store_address_' + count, 'store_latitude_' + count, 'store_longitude_' + count, 'store_zip_code_' + count, 'store_city_' + count,'store_state_' + count);
        count++;
        $('#totalCount').text(count);
    });

    $('#storeFormform').on('submit', function (e) {
        e.preventDefault();
        var formData = $(this).serialize();
        if($('#storeFormform').valid()) {    
               
            $('#submitStore').text('Please Wait');

            runajax('{{ route('admin.addstore') }}', formData, 'post', '', 'json', function(output) {
                $('#submitStore').text('Submit ');
                $('#submitStore').removeAttr('disabled');
                console.log(output);
                if (output.success) {
                    $('#storeFormform')[0].reset();
                    window.location.href ='{{ route("admin.stores") }}'
                    //storeTable.ajax.reload();
                    $('#storeFormform').removeClass('active');
                    $('#storelistall').trigger('click');
                } else {
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
        }
        
    });

    $('#editStoreForm').on('submit', function (e) {
        e.preventDefault();
        var formData = $(this).serialize();
        runajax('{{ route('admin.updateStore') }}', formData, 'post', '', 'json', function(output) {
            console.log(output)
            if (output.success) {
                $('#editStoreForm')[0].reset();
                storeTable.ajax.reload();
                $('#editStore').modal('hide');
            } else {
                for (var item in output.data) {

                    var key = item
                    console.log(key);
                    existvalue = $('#edit_store_' + key).val();
                    jQuery.validator.addMethod(key + "error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.data[item][0]));
                    jQuery('#edit_store_' + key).addClass(key + "error");
                    jQuery('#edit_store_' + key).valid();
                }
            }
        })
       
    });

    $('#confirmDelete').on('click', function () {
        var id = $('#deleteModal').data('id');
        $.ajax({
            url: '{{ route('admin.deleteStore') }}',
            type: 'get',
            data: { id: id, _token: '{{ csrf_token() }}' },
            success: function (response) {
                if (response.success) {
                    storeTable.ajax.reload();
                    $('#deleteModal').modal('hide');
                } else {
                    // Handle deletion errors
                }
            },
        });
    });

    $('#confirmcancel').on('click', function () {
        var id = $('#cancelmodel').data('id');
        data = {'id':id};
        runajax('{{ route('admin.cancelrequest.Subscription') }}', data, 'get', '', 'json', function(output) {
            storeTable.ajax.reload();
            $('#cancelmodel').modal('hide');
        });
    });

    $('#store_tabl').on('click', '.editDealer', function () {
        var id = $(this).data('id');
        $.get('{{ route('admin.store.view', '') }}/?store_id=' + id, function (data) {
            $('#edit_store_id').val(data.id);
            $('.cant_edit').removeClass('first_cancelled');
            $('#edit_dealergroupselect').val(data.dealer.id);
            $('#edit_store_dealership_name').val(data.dealership_name);
            $('#edit_store_source').val(data.source);
            $('#edit_store_adf_email').val(data.adf_mail);
            $('#edit_store_email').val(data.email);
            $('#edit_store_phone').val(data.phone);
            $('#edit_store_address').val(data.address);
            $('#edit_store_city').val(data.city);
            $('#edit_store_state').val(data.state);
            $('#edit_latitude').val(data.latitude);
            $('#edit_longitude').val(data.longitude);
            $('#edit_store_zip_code').val(data.zip_code);
            $('#edit_store_call_tracking_number').val(data.call_tracking_number);
            $('#edit_store_call_track_sms').val(data.call_track_sms);

           
            if (data.subscribed == 1) {
                $('#edit_subyes').prop('checked', true);
            } else {
                $('#edit_subno').prop('checked', true);
            }
            if (data.is_manage_by_admin == 1) {
                $('#edit_manual').prop('checked', true);
            } else {
                $('#edit_default').prop('checked', true);
            }
            if (data.is_subscribed == 1 && data.is_manage_by_admin != 1) {
               
                $('#edit_subno').prop('disabled', true);
                $('.cant_edit').show()
                $('.cant_edit').addClass('first_cancelled');
                $('#edit_manual').prop('disabled', true);
                $('.subscription_details').hide();
            } else{
                $('#edit_subno').prop('disabled', false);
                $('.cant_edit').hide()
                $('.cant_edit').removeClass('first_cancelled');
                $('#edit_manual').prop('disabled', false);
                $('.subscription_details').show();
                    if (data.free_trial == 1) {
                        $('#free_trial_yes').prop('checked', true);
                        $('.edit_free_trial_detail').show();
                        $('#edit_free_trial_start_date').val(data.free_trial_start_date);
                        $('#edit_free_trial_end_date').val(data.free_trial_end_date);
                    } else {
                         $('#free_trial_no').prop('checked', true);
                         $('.edit_free_trial_detail').hide();
                         $('#edit_free_trial_start_date').val(data.free_trial_start_date);
                         $('#edit_free_trial_end_date').val(data.free_trial_end_date);
                    }
            }
            $('#edit_subscription_price').val(data.subscription_price);
            $('#edit_subscription_start_date').val(data.subscription_start_date);
            $('#edit_subscription_end_date').val(data.subscription_end_date);
            initializeAutocomplete('edit_store_address', 'edit_latitude', 'edit_longitude','edit_store_zip_code','edit_store_city','edit_store_state');

        });
    });
    $('.first_cancelled').click(function(){
       
        $('.modal').modal('hide');
        $('#cancelled_model').modal('show');
    })

    $('#store_tabl').on('click', '.viewDealer', function () {
        var id = $(this).data('id');
        $.get('{{ route('admin.store.view', '') }}/?store_id=' + id, function (data) {
            $('#view_dealergroupselect').val(data.dealer.id);
            $('#view_store_dealership_name').val(data.dealership_name);
            $('#view_store_source').val(data.source);
            $('#view_store_adf_email').val(data.adf_mail);
            $('#view_store_email').val(data.email);
            $('#view_store_phone').val(data.phone);
            $('#view_store_address').val(data.address);
            $('#view_store_city').val(data.city);
            $('#view_store_state').val(data.state);
            $('#view_store_zip_code').val(data.zip_code);
            $('#view_store_call_tracking_number').val(data.call_tracking_number);
            $('#view_store_call_track_sms').val(data.call_track_sms);
        });
    });

    $('#deleteModal').on('show.bs.modal', function (e) {
        var button = $(e.relatedTarget);
        var id = button.data('id');
        $('#deleteModal').data('id', id);
    });
    $('#cancelmodel').on('show.bs.modal', function (e) {
        var button = $(e.relatedTarget);
        var id = button.data('id');
        $('#cancelmodel').data('id', id);
    });

    $(document).on('change', '.subscription_type', function () {
        var index = $(this).attr('name').match(/\d+/)[0];
        if ($(this).val() == '1') {
            $('.subscription_details_' + index).show();
        } else {
            $('.subscription_details_' + index).hide();
        }
    });

    $(document).on('change', '.free_trial', function () {
        var index = $(this).attr('name').match(/\d+/)[0];
        if ($(this).val() == '1') {
            $('.free_trial_detail_' + index).show();
        } else {
            $('.free_trial_detail_' + index).hide();
        }
    });
    $(document).on('change', '.subscribed', function () {
        var index = $(this).attr('name').match(/\d+/)[0];
        console.log($(this).val());
        if ($(this).val() == '1') {
            $('.subscription_type_div_' + index).show();
            $('.subscription_details_' + index).show();
        } else {
            $('.subscription_type_div_' + index).hide();
            $('.subscription_details_' + index).hide();
        }
    });

    // Handle CSV upload
    $('#uploadCSVForm').on('submit', function (e) {
        e.preventDefault();
        var formData = new FormData(this);
        $.ajax({
            url: '{{ route('admin.store.uploadCSV') }}',
            type: 'POST',
            data: formData,
            contentType: false,
            processData: false,
            success: function (response) {
                if (response.success) {
                    $('#uploadCSVModal').modal('hide');
                    storeTable.ajax.reload();
                    alert('CSV uploaded successfully.');
                } else {
                    alert('Failed to upload CSV.');
                }
            },
        });
    });

    // Handle CSV download
    $('#downloadCSV').on('click', function () {
        var dealer_id = $('#dealerGroupSelect').val();
        var is_manage_by_admin = $('#subscriptionTypeSelect').val();
        var is_subscribed = $('#isSubscribedSelect').val();
        var url = '{{ route('admin.store.downloadCSV') }}?dealer_id=' + dealer_id + '&is_manage_by_admin=' + is_manage_by_admin + '&is_subscribed=' + is_subscribed;
        window.location.href = url;
    });

</script>
@endsection
