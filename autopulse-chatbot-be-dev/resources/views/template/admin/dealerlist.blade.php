@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="position-relative">
    <div class="row gx-1">
        <div class="col col-xxl-3 col-xl-2 col-lg-12 col-md-12 col-12">
            <div class="page_title mb-xl-0 mb-3">
                <h2>Manage Stores</h2>
            </div>
        </div>
        <div class="col col-xxl-9 col-xl-10 col-lg-12 col-md-12 col-12">
            <div class="position-relative">
                <div class="row gx-1 justify-content-end">
                    <div class="col col-lg-11 col-md-11 col-12">
                        <form id="userFilter" method="GET" class="row gx-1">
                            <div class="col col-lg-4 col-md-4 col-12">
                                <select class="form-select w-100" name="transaction_type" id="subscriptionTypeSelect">
                                    <option value="">Select Subscription Type</option>
                                    <option value="0">Automated</option>
                                    <option value="1">Manual Payment</option>
                                </select>
                            </div>
                            <label class="col col-lg-3 col-md-4 col-12 d-flex align-items-center">
                                From:&nbsp;<input type="date" id="dealer-from" name="from" class="form-control form-control-sm me-md-1" value="{{Request::get('from')}}">
                            </label>
                            <label class="col col-lg-3 col-md-4 col-12 d-flex align-items-center">
                                To:&nbsp;<input type="date" id="dealer-to" name="to" class="form-control form-control-sm" value="{{Request::get('to')}}"> 
                            </label>
                            <div class="col col-lg-1 col-md-2 col-6">
                                <button type="submit" class="btn btn_theme w-100" value="Filter">Submit</button>
                            </div>
                            <div class="col col-lg-1 col-md-2 col-6">
                                <a href="{{ route('dealerlist.index') }}" class="btn btn_theme w-100">Reset</a>
                            </div>
                        </form>
                    </div>
                    <div class="col col-lg-1 col-md-1 col-6">
                        <button type="button" class="btn btn_dark w-100" id="downloadData"><i class="fas fa-download me-2"></i>CSV</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- General Success Message -->
    <div id="generalSuccessMessage" class="alert alert-success d-none mb-3" role="alert">
        <i class="fa fa-check-circle me-2"></i>
        <span id="generalSuccessText">Operation completed successfully!</span>
    </div>
    
    <!-- General Error Message -->
    <div id="generalErrorMessage" class="alert alert-danger d-none mb-3" role="alert">
        <i class="fa fa-exclamation-circle me-2"></i>
        <span id="generalErrorText">An error occurred!</span>
    </div>

    @if(session()->has('success'))
        <div class="row">
            <div class="alert alert-success alert-dismissible text-white" role="alert">
                <span class="text-sm">{{ Session::get('success') }}</span>
                <button type="button" class="btn-close text-lg py-3 opacity-10"
                    data-bs-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    @endif

    <div class="tab_box">
        <!-- Nav pills -->
        <ul class="nav nav-pills underline_tabs border-bottom mt-3" role="tablist">
            <li class="nav-item">
                <a class="nav-link active" id="dealerlisttab" data-bs-toggle="pill" href="#dealerList">All Accounts</a>
            </li>
            <li class="nav-item">
                <a class="nav-link " id="dealerFormtab" data-bs-toggle="pill" href="#dealerForm">Add Store</a>
            </li>
        </ul>

        <!-- Tab panes -->
        <div class="tab-content">
            <!-- All Stores -->
            <div id="dealerList" class="tab-pane active">
                <div class="position-relative table-responsive pt-2 pb-3" style="min-height: 300px;">
                    <table class="table table-bordered w-100 dataTable" id="dealer_tabl">
                        <thead>
                            <tr>
                                <th>#</th>
                                <!-- <th>Chatbot Name</th> -->
                                <th>Dealership Name</th>
                                <th>Website</th>
                                <!-- <th>Adf Email</th> -->
                                <th>Contact Person</th>
                                <th>Email</th>
                                <th>Phone Number</th>
                                <!-- <th>Subscription Enabled</th>
                                <th>Subscription Type</th> -->
                                <th> Subscription Status</th>
                                <!-- <th>Subscription Price</th>
                                <th>Free Trial</th>
                                <th>Free Trial Start</th>
                                <th>Free Trial End</th>
                                <th>Expiry Date</th> -->
                                <th>Action</th>
                            </tr>
                        </thead>
                    </table>
                </div>
            </div>

            <!-- Store Form Tab -->
            <div id="dealerForm" class="tab-pane fade">
                <div class="row justify-content-center mt-3 mx-md-3 mx-0">
                    <div class="col col-xl-9 col-lg-9 col-md-12 col-12">
                        <div class="position-relative mb-3">
                            <!-- Success Message for Add Store -->
                            <div id="addStoreSuccess" class="alert alert-success d-none" role="alert">
                                <i class="fa fa-check-circle me-2"></i>
                                <span id="addStoreSuccessMessage">Store added successfully!</span>
                            </div>

                            <form action="{{ route('dealerlist.store') }}" id="dealerregisterForm" method="post" enctype="multipart/form-data">
                                @csrf
                                <div class="position-relative form-step">
                                    <div class="tab_box_form border bg-transparent rounded">
                                        <div class="row gx-2 mb-3">
                                            <div class="col col-12">
                                                <h6 class="mb-3">Personal Contact info</h6>
                                            </div>
                                            <div class="col col-md-12 col-12">
                                                <input type="text" id="name" name="name" placeholder="Name" value="" class="form-control required">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="text" id="phone_number" name="phone_number" placeholder="Phone number" value="" class="form-control required">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="text" id="email" name="email" placeholder="Email" value="" class="form-control required" autocomplete="off">
                                            </div>
                                            
                                            <div class="col col-md-6 col-12">
                                                <input type="password" id="password" name="password" placeholder="Password" value="" class="form-control required" autocomplete="new-password">
                                            </div>
                                            
                                            <div class="col col-md-6 col-12">
                                                <input type="password" id="confirm_password" name="confirm_password" placeholder="Confirm Password" value="" class="form-control required">
                                            </div>
                                        </div>
                                    </div>

                                    <div class="row justify-content-center">
                                        <div class="col col-lg-2 col-md-3 col-12">
                                            <div class="position-relative text-center">
                                                <button type="button" class="btn btn_theme w-100 next-step">Next</button> 
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="position-relative form-step" style="display: none;">
                                    <div class="tab_box_form border bg-transparent rounded">
                                        <div class="row gx-2 gy-2 mb-3">
                                            <div class="col col-12">
                                                <h6 class="mb-3">BDC Chatbot Information</h6>
                                            </div>

                                            <div class="col col-md-6 col-12">
                                                <label for="chatbot_name" class="form-label">Adf Email</label>
                                                <input type="text" name="adf_mail" class="form-control" id="adf_mail required" value="" >
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <label for="chatbot_name" class="form-label">What would you like to name your AI Bot ?</label>
                                                <input type="text" name="chatbot_name" class="form-control required" id="chatbot_name" value="{{ old('chatbot_name', $chatbotSetting->chatbot_name ?? '') }}" required>
                                            </div>
                                            
                                            <div class="col col-md-6 col-12">
                                                <label for="chatbot_name" class="form-label">Dealership Name</label>
                                                <input type="text" name="dealership_name" class="form-control required" id="dealership_name"  >
                                            </div>

                                            <div class="col col-md-6 col-12">
                                                <label for="dealership_url" class="form-label">Dealership URL</label>
                                                <input type="text" name="dealership_url" class="form-control required" id="dealership_url" >
                                            </div>

                                            <div class="col col-md-6 col-12">
                                                <label for="logo" class="form-label">Logo</label>
                                                <input type="file" name="logo" class="form-control required" id="logo" accept="image/*">
                                            </div>

                                            <div class="col col-md-6 col-12">
                                                <label for="icon_logo" class="form-label">Icon Logo</label>
                                                <input type="file" name="icon_logo" class="form-control required" id="icon_logo" accept="image/*">
                                            </div>

                                            <div class="col col-md-6 col-12">
                                                <label for="primary_color" class="form-label">Primary Color</label>
                                                <input type="color" name="primary_color" class="form-control required" id="primary_color" value="">
                                            </div>

                                            <div class="col col-md-6 col-12">
                                                <label for="primary_color" class="form-label d-block">Chatbot Position</label>
                                                <div class="row g-0">
                                                    <div class="form-check col col-md-6 col-6">
                                                        <input class="form-check-input" type="radio" name="position" id="inlineRadio1" value="right" 
                                                        @if(isset($chatbotSetting)) @if($chatbotSetting->position == 'right')  checked @endif 
                                                        @else checked @endif>
                                                        <label class="form-check-label" for="inlineRadio1">Right side</label>
                                                        <!-- *Need to add the 'chatbox_ri' class to both the 'chatboxO' and 'chatbx_main' classes. (widget.js) -->
                                                        <!-- *Default add 'chatbox_ri' -->
                                                    </div>
                                                    <div class="form-check col col-md-6 col-6">
                                                        <input class="form-check-input" type="radio" name="position" id="inlineRadio2" value="left" 
                                                        @if(isset($chatbotSetting) && $chatbotSetting->position == 'left')  checked @endif>
                                                        <label class="form-check-label" for="inlineRadio2">Left side</label>
                                                        <!-- *Need to add the 'chatbox_le' class to both the 'chatboxO' and 'chatbx_main' classes. (widget.js) -->
                                                    </div>
                                                </div>
                                            </div>

                                            <div class="col col-md-12 col-12">
                                                <label for="welcome_message" class="form-label">Welcome Message</label>
                                                <textarea name="welcome_message" class="form-control required" id="welcome_message"></textarea>
                                            </div>
                                        
                                        </div>

                                        <!-- Managerial Contact Information -->
                                        <div class="row gx-2 gy-2 mb-3">
                                            <div class="col col-12">
                                                <h6 class="mb-2">Managerial Contact Information</h6>
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="tel" name="managerial_contact_phone" id="managerial_contact_phone" placeholder="Managerial Contact Phone" value="" class="form-control">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <input type="email" name="managerial_contact_email" id="managerial_contact_email" placeholder="Managerial Contact Email" value="" class="form-control">
                                            </div>
                                        </div>

                                        <!-- Timezone and Store Hours -->
                                        <div class="row gx-2 gy-2 mb-3">
                                            <div class="col col-12">
                                                <h6 class="mb-2">Store Hours & Timezone</h6>
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <label for="timezone" class="form-label">Timezone</label>
                                                <select name="timezone" id="timezone" class="form-select">
                                                    <option value="America/New_York">Eastern Time (America/New_York)</option>
                                                    <option value="America/Chicago">Central Time (America/Chicago)</option>
                                                    <option value="America/Denver">Mountain Time (America/Denver)</option>
                                                    <option value="America/Los_Angeles">Pacific Time (America/Los_Angeles)</option>
                                                    <option value="America/Anchorage">Alaska Time (America/Anchorage)</option>
                                                    <option value="Pacific/Honolulu">Hawaii Time (Pacific/Honolulu)</option>
                                                </select>
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <div class="form-check mt-4">
                                                    <input class="form-check-input" type="checkbox" name="is_store_hours_enabled" id="is_store_hours_enabled" value="1" checked>
                                                    <label class="form-check-label mb-0" for="is_store_hours_enabled">
                                                        Enable Store Hours
                                                    </label>
                                                </div>
                                                <small class="form-text text-secondary">Check to enable store hours validation for the chatbot</small>
                                            </div>
                                        </div>

                                        <!-- Store Hours Schedule -->
                                        <div class="row gx-2 mb-3" id="store-hours-section">
                                            <div class="col col-12">
                                                <div class="row g-2">
                                                    <div class="col col-4">
                                                        <div class="form-group mb-2">
                                                            <label>Day</label>
                                                        </div>
                                                    </div>
                                                    <div class="col col-4">
                                                        <div class="form-group mb-2">
                                                            <label>Opening Time</label>
                                                        </div>
                                                    </div>
                                                    <div class="col col-4">
                                                        <div class="form-group mb-2">
                                                            <label>Close Time</label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="col col-12">
                                                <div class="store-hours-grid">
                                                    @php
                                                        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
                                                        $dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                                                        $defaultHours = [
                                                            'monday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
                                                            'tuesday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
                                                            'wednesday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
                                                            'thursday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
                                                            'friday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
                                                            'saturday' => ['open' => '09:00', 'close' => '17:00', 'closed' => false],
                                                            'sunday' => ['open' => '12:00', 'close' => '16:00', 'closed' => true]
                                                        ];
                                                    @endphp
                                                    
                                                    @foreach($days as $index => $day)
                                                        <div class="row g-2">
                                                            <div class="col col-4 d-flex align-items-center">
                                                                <div class="form-group mb-2">
                                                                    <div class="form-check">
                                                                        <input class="form-check-input" type="checkbox" name="store_hours[{{ $day }}][closed]" 
                                                                            id="closed-{{ $day }}"
                                                                            value="1" 
                                                                            {{ $defaultHours[$day]['closed'] ? 'checked' : '' }}
                                                                            onchange="toggleDayHours('{{ $day }}')">
                                                                        <label class="form-check-label mb-0" for="closed-{{ $day }}">{{ $dayLabels[$index] }}</label>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div class="col col-4">
                                                                <div class="form-group mb-2">
                                                                    <input type="time" 
                                                                        name="store_hours[{{ $day }}][open]" 
                                                                        id="open-{{ $day }}" 
                                                                        value="{{ $defaultHours[$day]['open'] }}" 
                                                                        {{ $defaultHours[$day]['closed'] ? '' : 'disabled' }}
                                                                        class="form-control">
                                                                </div>
                                                            </div>
                                                            <div class="col col-4">
                                                                <div class="form-group mb-2">
                                                                    <input type="time" 
                                                                        name="store_hours[{{ $day }}][close]" 
                                                                        id="close-{{ $day }}"
                                                                        value="{{ $defaultHours[$day]['close'] }}"
                                                                        {{ $defaultHours[$day]['closed'] ? '' : 'disabled' }}
                                                                        class="form-control">
                                                                </div>
                                                            </div>
                                                        </div>
                                                    @endforeach
                                                </div>
                                            </div>
                                        </div>

                                        <div class="row gx-2 gy-2 mb-3">
                                            <div class="col col-12">
                                                <label for="closed_message" class="form-label">Closed Message</label>
                                                <textarea name="closed_message" id="closed_message" cols="20" rows="2" placeholder="We are currently closed. Please leave a message and we'll get back to you during business hours." class="form-control"></textarea>
                                            </div>
                                        </div>

                                        <div class="row gx-2">
                                            <div class="col col-xl-12 col-md-12 col-12 d-flex align-items-center">
                                                <div class="position-relative d-flex align-items-center mb-3">
                                                    <span>Subscription&nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-solid fa-circle-info"></i></a></span>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input subscribed" type="radio" value="1" name="subscribed" id="add_subyes" checked>
                                                        <label class="form-check-label" for="add_subyes">Yes</label>
                                                    </div>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input subscribed" type="radio" value="0" name="subscribed" id="add_subno">
                                                        <label class="form-check-label" for="add_subno">No</label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="col col-xl-12 col-md-12 col-12 align-items-center subscription_type_div">
                                                <div class="position-relative d-flex align-items-center mb-3">
                                                    <span>Subscription Type&nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-solid fa-circle-info"></i></a></span>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input subscription_type" type="radio" value="0" name="subscription_type" id="add_default">
                                                        <label class="form-check-label" for="add_default">Automated</label>
                                                    </div>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input subscription_type" type="radio" value="1" name="subscription_type" id="add_manual" checked>
                                                        <label class="form-check-label" for="add_manual">Manual Payment</label>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="row gx-2 subscription_details">
                                            <div class="col col-md-6 col-12">
                                                <label class="mb-1">Monthly Subscription Price for manual billing</label>
                                                <input type="text" id="subscription_price" name="subscription_price" placeholder="Monthly Subscription Price for manual billing" class="form-control">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <label class="mb-1">Subscription End Date</label>
                                                <input type="date" id="subscription_end_date" name="subscription_end_date" placeholder="Subscription End Date" class="form-control">
                                            </div>
                                            <div class="col col-xl-12 col-md-12 col-12 align-items-center ">
                                                <div class="position-relative d-flex align-items-center mb-3">
                                                    <span>Free Trial&nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-solid fa-circle-info"></i></a></span>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input free_trial" type="radio" value="0" name="free_trial" id="free_trial" checked>
                                                        <label class="form-check-label" for="free_trial">No</label>
                                                    </div>
                                                    <div class="form-check mx-2">
                                                        <input class="form-check-input free_trial" type="radio" value="1" name="free_trial" id="free_trial_1" >
                                                        <label class="form-check-label" for="free_trial_1">Yes</label>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="row gx-2 free_trial_detail" style="display:none">
                                            <div class="col col-md-6 col-12">
                                                <label class="mb-1">Free Trial Start Date</label>
                                                <input type="date" id="free_trial_start_date" name="free_trial_start_date" placeholder="Free Trial Start Date" class="form-control">
                                            </div>
                                            <div class="col col-md-6 col-12">
                                                <label class="mb-1">Free Trial End Date</label>
                                                <input type="date" id="free_trial_end_date" name="free_trial_end_date" placeholder="Free Trial End Date" class="form-control">
                                            </div>
                                            
                                        </div>
                                    </div>
                                    <div class="row justify-content-center">
                                        <div class="col col-lg-2 col-md-3 col-12">
                                            <div class="position-relative text-center mt-3">
                                                <button type="submit" id="dealerSubmit" name="submit" class="btn btn_theme w-100">Submit</button> 
                                            </div>
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

<!-- View Script Modal -->
<div class="modal fade" id="viewScriptModal" tabindex="-1" aria-labelledby="viewScriptLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-body">
                <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                    <h5 class="modal-title text_primary mb-3"><b>Script</b></h5>

                    <div class="mb-3">
                        <textarea id="embed-code" class="form-control" rows="3" readonly>Lorem ipsum, dolor sit amet consectetur adipisicing elit.</textarea>
                    </div>
                    <button id="copy-button" class="btn btn_theme w-100">Copy</button>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- View Store Modal -->
<div class="modal fade" id="viewDealer" tabindex="-1" aria-labelledby="viewDealerLabel" aria-hidden="true">
  <div class="modal-dialog modal-lg modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-body">
        <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
        <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
            <h5 class="modal-title text_primary mb-3"><b>View Account Details</b></h5>

            <!-- Form -->
            <form class="gx-3 gy-2">
                @csrf    
                <div class="row gx-2 mb-3">
                    <div class="col col-12">
                        <h6 class="mb-3">Contact Details</h6>
                    </div>
                    <div class="col col-md-6 col-12">
                        <input type="text" id="view-dealer-name" name="name" placeholder="First Name" value="" class="form-control required" disabled>
                    </div>
                  
                    <div class="col col-12">
                        <input type="text" id="view-dealer-email" name="email" placeholder="Email" value="" class="form-control required" disabled>
                    </div>
                </div>

                <div class="row gx-2">
                    <div class="col col-12">
                        <h6 class="mb-3">Dealership Details</h6>
                    </div>
                    <div class="col col-md-6 col-12">
                        <input type="text" id="view-dealer-designation" name="designation" placeholder="Title" value="" class="form-control required" disabled>
                    </div>
                    <div class="col col-md-6 col-12">
                        <input type="text" id="view-dealer-dealership_group" name="dealership_group" placeholder="Dealership Group Name" value="" class="form-control required" disabled>
                    </div>
                    <div class="col col-md-6 col-12">
                        <input type="text" id="view-dealer-phone_number" name="phone_number" placeholder="Contact Number" value="" class="form-control required" disabled>
                    </div>
                </div>
            </form>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Edit Store Modal -->
<div class="modal fade" id="editDealer" tabindex="-1" aria-labelledby="editDealerLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-body">
                <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                    <h5 class="modal-title text_primary mb-3"><b>Edit Dealer</b></h5>

                    <!-- Success Message for Edit Store -->
                    <div id="editStoreSuccess" class="alert alert-success d-none" role="alert">
                        <i class="fa fa-check-circle me-2"></i>
                        <span id="editStoreSuccessMessage">Store updated successfully!</span>
                    </div>

                    <!-- Form -->
                    <form action="{{ route('dealerlist.update') }}" id="editdealerform" method="post" enctype="multipart/form-data">
                        @csrf
                        <input type="hidden" id="edit-dealer-id" name="dealer_id">

                        <!-- Personal Contact Info -->
                        <div class="row gx-2 mb-3">
                            <div class="col col-12">
                                <h6 class="mb-3">Personal Contact info</h6>
                            </div>
                            <div class="col col-md-12 col-12 mb-2">
                                <label class="form-label">Name</label>
                                <input type="text" id="edit-name" name="name" placeholder="Name" class="form-control required">
                            </div>
                            <div class="col col-md-6 col-12 mb-2">
                                <label class="form-label">Email</label>
                                <input type="text" id="edit-email" name="email" placeholder="Email" class="form-control required" autocomplete="false">
                            </div>
                            <div class="col col-md-6 col-12">
                                <label class="form-label">Phone Number</label>
                                <input type="text" id="edit-phone_number" name="phone_number" placeholder="Phone number" class="form-control required">
                            </div>
                        </div>

                        <!-- BDC Chatbot Information -->
                        <div class="row gx-2 mb-3">
                            <div class="col col-12">
                                <h6 class="mb-3">BDC Chatbot Information</h6>
                            </div>
                            <div class="col col-md-12 col-12 mb-2">
                                <label for="adf_mail" class="form-label">Adf Email</label>
                                <input type="text" name="adf_mail" class="form-control" id="edit-adf_mail">
                            </div>
                            <div class="col col-md-6 col-12 mb-2">
                                <label for="chatbot_name" class="form-label">Chatbot Name</label>
                                <input type="text" name="chatbot_name" class="form-control" id="edit-chatbot_name">
                            </div>
                            <div class="col col-md-6 col-12 mb-2">
                                <label for="dealership_name" class="form-label">Dealership Name</label>
                                <input type="text" name="dealership_name" class="form-control" id="edit-dealership_name">
                            </div>
                            <div class="col col-md-12 col-12 mb-2">
                                <label for="dealership_url" class="form-label">Dealership URL</label>
                                <input type="text" name="dealership_url" class="form-control" id="edit-dealership_url">
                            </div>
                            <div class="col col-md-12 col-12 mb-2">
                                <label for="logo" class="form-label">Logo</label>
                                <input type="file" name="logo" class="form-control" id="edit-logo" accept="image/*">
                            </div>
                            <div class="col col-md-12 col-12 mb-2">
                                <label for="icon_logo" class="form-label">Icon Logo</label>
                                <input type="file" name="icon_logo" class="form-control" id="edit-icon_logo" accept="image/*">
                            </div>
                            <div class="col col-md-12 col-12 mb-2">
                                <label for="primary_color" class="form-label">Primary Color</label>
                                <input type="color" name="primary_color" class="form-control required" id="edit-primary_color" value="">
                            </div>
                        </div>

                        <!-- Managerial Contact Information -->
                        <div class="row gx-2 mb-3">
                            <div class="col col-12">
                                <h6 class="mb-3">Managerial Contact Information</h6>
                            </div>
                            <div class="col col-md-6 col-12 mb-2">
                                <label for="managerial_contact_phone" class="form-label">Managerial Contact Phone</label>
                                <input type="tel" name="managerial_contact_phone" id="edit-managerial_contact_phone" placeholder="+1 (555) 987-6543" class="form-control">
                            </div>
                            <div class="col col-md-6 col-12 mb-2">
                                <label for="managerial_contact_email" class="form-label">Managerial Contact Email</label>
                                <input type="email" name="managerial_contact_email" id="edit-managerial_contact_email" placeholder="manager@dealership.com" class="form-control">
                            </div>
                        </div>

                        <!-- Timezone and Store Hours -->
                        <div class="row gx-2 mb-3">
                            <div class="col col-12">
                                <h6 class="mb-3">Store Hours & Timezone</h6>
                            </div>
                            <div class="col col-md-6 col-12 mb-2">
                                <label for="timezone" class="form-label">Timezone</label>
                                <select name="timezone" id="edit-timezone" class="form-select">
                                    <option value="America/New_York">Eastern Time (America/New_York)</option>
                                    <option value="America/Chicago">Central Time (America/Chicago)</option>
                                    <option value="America/Denver">Mountain Time (America/Denver)</option>
                                    <option value="America/Los_Angeles">Pacific Time (America/Los_Angeles)</option>
                                    <option value="America/Anchorage">Alaska Time (America/Anchorage)</option>
                                    <option value="Pacific/Honolulu">Hawaii Time (Pacific/Honolulu)</option>
                                </select>
                            </div>
                            <div class="col col-md-6 col-12 mb-2">
                                <div class="form-check mt-4">
                                    <input class="form-check-input" type="checkbox" name="is_store_hours_enabled" id="edit-is_store_hours_enabled" value="1">
                                    <label class="form-check-label mb-0" for="edit-is_store_hours_enabled">
                                        Enable Store Hours
                                    </label>
                                </div>
                                <small class="form-text text-secondary">Check to enable store hours validation for the chatbot</small>
                            </div>
                        </div>

                        <!-- Store Hours Schedule -->
                        <div class="row gx-2 mb-3" id="edit-store-hours-section">
                            <div class="col col-12">
                                <div class="row g-2">
                                    <div class="col col-4">
                                        <div class="form-group mb-2">
                                            <label>Day</label>
                                        </div>
                                    </div>
                                    <div class="col col-4">
                                        <div class="form-group mb-2">
                                            <label>Opening Time</label>
                                        </div>
                                    </div>
                                    <div class="col col-4">
                                        <div class="form-group mb-2">
                                            <label>Close Time</label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="col col-12">
                                <div class="store-hours-grid">
                                    @php
                                        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
                                        $dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                                        $defaultHours = [
                                            'monday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
                                            'tuesday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
                                            'wednesday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
                                            'thursday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
                                            'friday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
                                            'saturday' => ['open' => '09:00', 'close' => '17:00', 'closed' => false],
                                            'sunday' => ['open' => '12:00', 'close' => '16:00', 'closed' => true]
                                        ];
                                    @endphp
                                    
                                    @foreach($days as $index => $day)
                                        <div class="row g-2">
                                            <div class="col col-4 d-flex align-items-center">
                                                <div class="form-group mb-2">
                                                    <div class="form-check">
                                                        <input class="form-check-input" type="checkbox" name="store_hours[{{ $day }}][closed]" 
                                                            id="edit-closed-{{ $day }}"
                                                            value="1" 
                                                            {{ $defaultHours[$day]['closed'] ? 'checked' : '' }}
                                                            onchange="toggleEditDayHours('{{ $day }}')">
                                                        <label class="form-check-label mb-0" for="edit-closed-{{ $day }}">{{ $dayLabels[$index] }}</label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="col col-4">
                                                <div class="form-group mb-2">
                                                    <input type="time" 
                                                        name="store_hours[{{ $day }}][open]" 
                                                        id="edit-open-{{ $day }}" 
                                                        value="{{ $defaultHours[$day]['open'] }}" 
                                                        {{ $defaultHours[$day]['closed'] ? '' : 'disabled' }}
                                                        class="form-control">
                                                </div>
                                            </div>
                                            <div class="col col-4">
                                                <div class="form-group mb-2">
                                                    <input type="time" 
                                                        name="store_hours[{{ $day }}][close]" 
                                                        id="edit-close-{{ $day }}"
                                                        value="{{ $defaultHours[$day]['close'] }}"
                                                        {{ $defaultHours[$day]['closed'] ? '' : 'disabled' }}
                                                        class="form-control">
                                                </div>
                                            </div>
                                        </div>
                                    @endforeach
                                </div>
                            </div>
                        </div>

                        <div class="row gx-2 mb-3">
                            <div class="col col-12">
                                <label for="closed_message" class="form-label">Closed Message</label>
                                <textarea name="closed_message" id="edit-closed_message" cols="20" rows="2" placeholder="We are currently closed. Please leave a message and we'll get back to you during business hours." class="form-control"></textarea>
                            </div>
                        </div>

                        <!-- Subscription Type -->
                        <div class="row gx-2 mb-3">

                            <div class="col col-12">
                                <h6 class="mb-3">Subscription Information</h6>
                            </div>
                             <!-- Cant Edit Notice -->
                            <div class="row gx-2">
                                <div class="col col-md-12 col-12 align-items-center cant_edit" style="display:none;">
                                    <p>Can't Edit as this subscription is managed automatically.&nbsp;<a type="button" class="text_primary cursor-pointer first_cancelled"><i class="fa-solid fa-circle-info"></i></a></p>
                                </div>
                            </div>
                            
                            <!-- Cancel Subscription Button -->
                            <div class="row gx-2 mb-3">
                                <div class="col col-md-12 col-12">
                                    <button type="button" id="cancelSubscriptionBtn" class="btn btn-danger" style="display:none;" data-store-id="">
                                        <i class="fa fa-times-circle me-2"></i>Cancel Subscription
                                    </button>
                                </div>
                            </div>

                            <div class="col col-xl-12 col-md-12 col-12 d-flex align-items-center">
                                <div class="position-relative d-flex align-items-center mb-3">
                                    <span>Subscription</span>
                                    <div class="form-check mx-2">
                                        <input class="form-check-input edit-subscribed" type="radio" value="1" name="subscribed" id="edit_subyes">
                                        <label class="form-check-label" for="edit_subyes">Yes</label>
                                    </div>
                                    <div class="form-check mx-2">
                                        <input class="form-check-input edit-subscribed" type="radio" value="0" name="subscribed" id="edit_subno">
                                        <label class="form-check-label" for="edit_subno">No</label>
                                    </div>
                                </div>
                            </div>

                            <!-- Subscription Type Radio -->
                            <div class="col col-xl-12 col-md-12 col-12 align-items-center edit-subscription_type_div">
                                <div class="position-relative d-flex align-items-center mb-3">
                                    <span>Subscription Type</span>
                                    <div class="form-check mx-2">
                                        <input class="form-check-input edit-subscription_type" type="radio" value="0" name="subscription_type" id="edit_default">
                                        <label class="form-check-label" for="edit_default">Automated</label>
                                    </div>
                                    <div class="form-check mx-2">
                                        <input class="form-check-input edit-subscription_type" type="radio" value="1" name="subscription_type" id="edit_manual">
                                        <label class="form-check-label" for="edit_manual">Manual Payment</label>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Free Trial -->
                        <div class="row gx-2 mb-3 edit-subscription_details">
                            <div class="col col-md-4 col-12">
                                <label class="mb-1">Subscription Price</label>
                                <input type="text" id="edit_subscription_price" name="subscription_price" placeholder="Monthly Subscription Price for manual billing" class="form-control required">
                            </div>
                            
                            <div class="col col-md-4 col-12">
                                <label class="mb-1">Subscription End Date</label>
                                <input type="date" id="edit_subscription_end_date" name="subscription_end_date" placeholder="Subscription End Date" class="form-control required">
                            </div>
                            <div class="col col-xl-12 col-md-12 col-12 align-items-center">
                                <div class="position-relative d-flex align-items-center mb-3">
                                    <span>Free Trial</span>
                                    <div class="form-check mx-2">
                                        <input class="form-check-input edit-free_trial" type="radio" value="0" name="free_trial" id="edit_free_trial_no" checked>
                                        <label class="form-check-label" for="edit_free_trial_no">No</label>
                                    </div>
                                    <div class="form-check mx-2">
                                        <input class="form-check-input edit-free_trial" type="radio" value="1" name="free_trial" id="edit_free_trial_yes">
                                        <label class="form-check-label" for="edit_free_trial_yes">Yes</label>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Subscription Details -->
                        <div class="row gx-2 mb-3 edit-free_trial_detail" style="display:none">
                            <div class="col col-md-6 col-12">
                                <label class="mb-1">Free Trial Start Date</label>
                                <input type="date" id="edit_free_trial_start_date" name="free_trial_start_date" class="form-control">
                            </div>
                            <div class="col col-md-6 col-12">
                                <label class="mb-1">Free Trial End Date</label>
                                <input type="date" id="edit_free_trial_end_date" name="free_trial_end_date" class="form-control">
                            </div>
                        </div>

                        <div class="row justify-content-center gx-2">
                            <div class="col col-lg-3 col-6">
                                <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100 mt-3">Cancel</button> 
                            </div>
                            <div class="col col-lg-3 col-6">
                                <button type="submit" id="submitEditDealer" class="btn btn_theme w-100 mt-3">Update</button> 
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Change Password Modal -->
<div class="modal fade" id="changePasswordModal" tabindex="-1" aria-labelledby="changePasswordLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-body">
        <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
        <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
            <h5 class="modal-title text_primary mb-3"><b>Change Password</b></h5>

            <!-- Error Messages -->
            <div id="changePasswordErrors" class="alert alert-danger d-none" role="alert">
                <ul class="mb-0" id="changePasswordErrorList"></ul>
            </div>

            <!-- Success Message -->
            <div id="changePasswordSuccess" class="alert alert-success d-none" role="alert">
                <i class="fa fa-check-circle me-2"></i>
                <span id="changePasswordSuccessMessage">Password changed successfully!</span>
            </div>

            <!-- Form -->
            <form action="{{ route('dealerlist.changepassword') }}" id="changePasswordForm" class="gx-3 gy-2">
                @csrf    
                <input type="hidden" id="change-password-dealer-id" name="dealer_id">
                <div class="row gx-2">
                    <div class="col col-12">
                        <div class="position-relative">
                            <input type="password" id="change-password-password" name="password" placeholder="New Password" class="form-control required">
                            <button type="button" class="btn btn-link position-absolute end-0 top-50 translate-middle-y pe-3" id="toggleDealerlistNewPassword" style="border: none; background: none; z-index: 10;">
                                <i class="fa fa-eye" id="dealerlistNewPasswordEyeIcon"></i>
                            </button>
                        </div>
                        <div class="invalid-feedback d-block" id="password_error" style="display: block !important; margin-top: 5px;"></div>
                    </div>
                    <div class="col col-12">
                        <div class="position-relative">
                            <input type="password" id="change-password-confirm" name="password_confirmation" placeholder="Confirm Password" class="form-control required">
                            <button type="button" class="btn btn-link position-absolute end-0 top-50 translate-middle-y pe-3" id="toggleDealerlistConfirmPassword" style="border: none; background: none; z-index: 10;">
                                <i class="fa fa-eye" id="dealerlistConfirmPasswordEyeIcon"></i>
                            </button>
                        </div>
                        <div class="invalid-feedback d-block" id="password_confirmation_error" style="display: block !important; margin-top: 5px;"></div>
                    </div>
                </div>

                <div class="row justify-content-center gx-2">
                    <div class="col col-lg-5 col-6">
                        <button type="button" data-bs-dismiss="modal" class="btn btn-outline-primary w-100 mt-3">Cancel</button> 
                    </div>
                    <div class="col col-lg-5 col-6">
                        <button type="submit" id="submitPasswordChange" name="submit" class="btn btn_theme w-100 mt-3">Change Password</button> 
                    </div>
                </div>
            </form>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Delete Modal -->
<div class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="deleteModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header border-0">
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body pb-4">
                <div class="position-relative text-center">
                    <i class="fa-light fa-circle-xmark fa-3x mb-3 text-white"></i>
                    <h5 class="mb-4">Are you sure you want to delete this record?</h5>
                    <div class="position-relative text-center">
                        <div class="row justify-content-center gx-2">
                            <div class="col col-lg-3 col-6">
                                <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button> 
                            </div> 
                            <div class="col col-lg-3 col-6">
                                <button type="button" class="btn btn_theme w-100" onclick="actionmethod()">Yes</button> 
                            </div> 
                        </div> 
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

@endsection
@section('script')
<style>
@keyframes slideDown {
    from {
        opacity: 0;
        transform: translateY(-20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

#addStoreSuccess.show,
#generalSuccessMessage.show,
#generalErrorMessage.show {
    display: block !important;
}
</style>
<script>
var dealer ='';
var myurl = '{{route('dealerlist.tableData')}}';

$(function () {
    $(document).on('change', '.subscribed', function () {
        //var index = $(this).attr('name').match(/\d+/);
        console.log($(this).val());
        if ($(this).val() == '1') {
            $('.subscription_type_div').show();
            $('.subscription_details').show();
        } else {
            $('.subscription_type_div').hide();
            $('.subscription_details').hide();
        }
    });
    // Handle subscription and free trial toggle
    $(document).on('change', '.edit-subscribed', function () {
        if ($(this).val() == '1') {
            $('.edit-subscription_type_div').show();
        } else {
            $('.edit-subscription_type_div').hide();
        }
    });

    $(document).on('change', '.edit-free_trial', function () {
        if ($(this).val() == '1') {
            $('.edit-free_trial_detail').show();
        } else {
            $('.edit-free_trial_detail').hide();
        }
    });
    $(document).on('change', '.free_trial', function () {
       // var index = $(this).attr('name').match(/\d+/)[0];
        if ($(this).val() == '1') {
            $('.free_trial_detail').show();
        } else {
            $('.free_trial_detail').hide();
        }
    });
    $(document).on('change', '.subscription_type', function () {
       
        if ($(this).val() == '1') {
            $('.subscription_details').show();
        } else {
            $('.subscription_details').hide();
        }
    });
    $(document).on('change', '.edit-subscription_type', function () {
       
       if ($(this).val() == '1') {
           $('.edit-subscription_details').show();
       } else {
           $('.edit-subscription_details').hide();
       }
   });

    $('#createDealer').click(function () {
        $('#dealerSubmit').val("create-dealer");
        $('#dealer_id').val('');
        $('#dealerForm').trigger("reset");
        $('#dealerHeading').html("Create Dealer");
        $('#dealerModal').modal('show');
    });

    $('body').on('click', '.editDealer', function () {
        var dealer_id = $(this).data('id');
        
        $.get("{{ route('dealerlist.edit') }}?dealer_id=" + dealer_id, function (data) {
            var dealer = data;

            // Populate personal details
            $('#edit-dealer-id').val(dealer.id);
            $('#edit-name').val(dealer.name || '');
            $('#edit-email').val(dealer.email || '');
            $('#edit-phone_number').val(dealer.phone_number || '');

            // Check if chat_setting is available
            var chatSetting = dealer.chat_setting || {};
            $('#edit-adf_mail').val(chatSetting.adf_mail || '');
            $('#edit-chatbot_name').val(chatSetting.chatbot_name || '');
            $('#edit-dealership_url').val(chatSetting.dealership_url || '');
            $('#edit-primary_color').val(chatSetting.primary_color || '');
          
            // Check if storelist is available
            var storeList = dealer.storelist || {};
            console.log( 'dealership_name',chatSetting.dealership_name);
            $('#edit-dealership_name').val(chatSetting.dealership_name || '');
            console.log( 'manageby',storeList.is_manage_by_admin);
            // Subscription handling: Manage by Admin and Subscription Check
            if (storeList.is_subscribed === 1 && storeList.is_manage_by_admin == 0) {
               // If subscribed and not managed by admin, disable the 'No' option
               $('#edit_subyes').prop('checked', true);
               $('#edit_subno').prop('disabled', true);  
               // If not subscribed or managed by admin, allow editing
               $('#edit_subno').prop('disabled', true);  // Enable the "No" option
               //$('#edit_subyes').prop('checked', true);   // Ensure the "Yes" option is checked
               $('.cant_edit').show();  // Show the "Can't Edit" message
               $('.cant_edit').addClass('first_cancelled');
               $('.edit-subscription_details').hide();
               $('.subscription_details').hide();
               $('#edit_manual').prop('disabled', true);
               
               // Show cancel subscription button
               $('#cancelSubscriptionBtn').show();
               $('#cancelSubscriptionBtn').attr('data-store-id', storeList.id);
           
               // Hide cancel subscription button if not applicable
              
           } else {
            $('#cancelSubscriptionBtn').hide();
                $('.edit-subscription_details').hide();
                $('#edit_subyes').prop('checked', true);
                $('#edit_subno').prop('disabled', false);  
                $('#edit_subno').prop('disabled', false);  
                $('.cant_edit').hide();  // Show the "Can't Edit" message
                $('.cant_edit').removeClass('first_cancelled');
                $('.subscription_details').show();  // Hide subscription details
                $('.edit-subscription_details').show();
                $('#edit_manual').prop('disabled', false);
            }

            // Manage by Admin handling
            if (storeList.is_manage_by_admin === 1) {
                
                $('#edit_manual').prop('checked', true);  // Ensure 'manual' option is checked
                $('#edit_manual').prop('disabled', false);  // Ensure 'manual' option is always enabled
                $('.subscription_details').show();  // Hide subscription details
                $('.edit-subscription_details').show();
            } else {
                $('#edit_default').prop('checked', true);  // Set to automated if not managed by admin
                $('.subscription_details').hide();  // Hide subscription details
                $('.edit-subscription_details').hide();
            }

            // Free trial handling
            if (storeList.free_trial === 1) {
                $('#edit_free_trial_yes').prop('checked', true);
                $('.edit-free_trial_detail').show();
                $('#edit_free_trial_start_date').val(storeList.free_trial_start_date || '');
                $('#edit_free_trial_end_date').val(storeList.free_trial_end_date || '');
            } else {
                $('#edit_free_trial_no').prop('checked', true);
                $('.edit-free_trial_detail').hide();
                $('#edit_free_trial_start_date').val('');
                $('#edit_free_trial_end_date').val('');
            }

            // Populate subscription price
            $('#edit_subscription_price').val(storeList.subscription_price || '');
            $('#edit_subscription_end_date').val(storeList.cancelled_at || '');

            // Populate managerial contact information
            $('#edit-managerial_contact_phone').val(chatSetting.managerial_contact_phone || '');
            $('#edit-managerial_contact_email').val(chatSetting.managerial_contact_email || '');

            // Populate timezone and store hours
            $('#edit-timezone').val(chatSetting.timezone || 'America/New_York');
            $('#edit-is_store_hours_enabled').prop('checked', chatSetting.is_store_hours_enabled == 1);
            $('#edit-closed_message').val(chatSetting.closed_message || '');

            // Populate store hours for each day
            var storeHours = chatSetting.store_hours || {};
            
            // If store_hours is a string, parse it as JSON
            if (typeof storeHours === 'string') {
                try {
                    storeHours = JSON.parse(storeHours);
                } catch (e) {
                    console.error('Error parsing store_hours JSON:', e);
                    storeHours = {};
                }
            }
            
            var days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            
            days.forEach(function(day) {
                var dayHours = storeHours[day] || {};
                var isClosed = dayHours.closed == 1;
                
                // Set the closed checkbox first
                $('#edit-closed-' + day).prop('checked', isClosed);
                
                // Set the time values
                $('#edit-open-' + day).val(dayHours.open || '09:00');
                $('#edit-close-' + day).val(dayHours.close || '18:00');
                
                // Toggle the day hours based on closed status
                // If closed (checked), ENABLE time inputs. If open (unchecked), DISABLE time inputs
                if (isClosed) {
                    $('#edit-open-' + day).prop('disabled', false);
                    $('#edit-close-' + day).prop('disabled', false);
                } else {
                    $('#edit-open-' + day).prop('disabled', true);
                    $('#edit-close-' + day).prop('disabled', true);
                }
            });

            // Toggle store hours section visibility
            if (chatSetting.is_store_hours_enabled == 1) {
                $('#edit-store-hours-section').show();
            } else {
                $('#edit-store-hours-section').hide();
            }

            $('#editDealer').modal('show');
        });
    });

   
    $(document).on('click', '.viewDealer', function () {
    // Get the data-script attribute from the clicked button
    var scriptUrl = $(this).data('script');
    console.log("Script URL:", scriptUrl); // Debug: Check the scriptUrl value
    
    // Ensure scriptUrl is not undefined or empty
    if (!scriptUrl) {
        console.error("Error: scriptUrl is undefined or empty."); 
        return; // Exit the function to avoid errors
    }

    // Construct the <script> tag with the URL
    var embedCode = '<scr' + 'ipt src="' + scriptUrl + '"></scr' + 'ipt>';
    $('#embed-code').val(embedCode);
    console.log("Embed Code:", embedCode); // Debug: Check the embedCode output
    
    // Set the value of the embed-code textarea with the constructed <script> tag
    $('#embed-code').val(embedCode);
});

    $('body').on('click', '.changePassword', function () {
        var dealer_id = $(this).data('id');
        $('#change-password-dealer-id').val(dealer_id);
        // Clear form and errors when opening modal
        clearDealerlistChangePasswordErrors();
        $('#changePasswordForm')[0].reset();
        $('#changePasswordModal').modal('show');
    });

    // Clear form and errors when modal is shown
    $('#changePasswordModal').on('show.bs.modal', function() {
        clearDealerlistChangePasswordErrors();
        $('#changePasswordForm')[0].reset();
    });



    // Clear success messages when modals are shown
    $('#editDealer').on('show.bs.modal', function() {
        $('#editStoreSuccess').addClass('d-none');
    });

    // Clear success message when switching to add store tab
    $('#dealerFormtab').on('click', function() {
        $('#addStoreSuccess').addClass('d-none');
    });

    // Eye icon functionality for password visibility in dealerlist
    $('#toggleDealerlistNewPassword').on('click', function() {
        var passwordField = $('#change-password-password');
        var eyeIcon = $('#dealerlistNewPasswordEyeIcon');
        
        if (passwordField.attr('type') === 'password') {
            passwordField.attr('type', 'text');
            eyeIcon.removeClass('fa-eye').addClass('fa-eye-slash');
        } else {
            passwordField.attr('type', 'password');
            eyeIcon.removeClass('fa-eye-slash').addClass('fa-eye');
        }
    });

    $('#toggleDealerlistConfirmPassword').on('click', function() {
        var passwordField = $('#change-password-confirm');
        var eyeIcon = $('#dealerlistConfirmPasswordEyeIcon');
        
        if (passwordField.attr('type') === 'password') {
            passwordField.attr('type', 'text');
            eyeIcon.removeClass('fa-eye').addClass('fa-eye-slash');
        } else {
            passwordField.attr('type', 'password');
            eyeIcon.removeClass('fa-eye-slash').addClass('fa-eye');
        }
    });

    // Date validation
    $('#userFilter').on('submit', function(event) {
        event.preventDefault();
        dealer.draw();
        var fromDate = new Date($('#dealer-from').val());
        var toDate = new Date($('#dealer-to').val());
        var today = new Date();
        
        if (fromDate >= toDate) {
            alert('From date should be less than To date.');
            return false;
        }
        
        if (toDate > today) {
            alert('To date should not be greater than today.');
            return false;
        }
        
        //this.submit();
    });

});

dealer = $('#dealer_tabl').DataTable({
    processing: true,
    serverSide: true,
    order: [[0, 'desc']],
    pageLength: 10,
    ajax: {
        url: '{{route('dealerlist.tableData')}}?source=dealer',
        type: 'GET',
        data: function (d) {
            d.transaction_type = $('#subscriptionTypeSelect').val();
            d.start_date = $('#dealer-from').val();
            d.end_date = $('#dealer-to').val();
        }
    },
    columns: [
        { data: 'id', name: 'id' }, // ID

        // Chatbot Name
        // {
        //     orderable: false,
        //     data: 'chat_setting.chatbot_name',
        //     name: 'chatbot_name',
        //     defaultContent: 'N/A',
        //     render: function (data, type, row) {
        //         return row.chat_setting ? row.chat_setting.chatbot_name : 'N/A';
        //     }
        // },
        // Dealership Name
        {
            orderable: false,
            data: 'storelist.dealership_name',
            name: 'dealership_name',
            defaultContent: 'N/A',
            render: function (data, type, row) {
                return row.storelist ? row.chat_setting.dealership_name : 'N/A';
            }
        },

        // Dealership URL
        {
            data: 'chat_setting.dealership_url',
            name: 'dealership_url',
            defaultContent: 'N/A',
            render: function (data, type, row) {
                return row.chat_setting ? row.chat_setting.dealership_url : 'N/A';
            },
            orderable: false,
        },

        // ADF Email
        // {
        //     orderable: false,
        //     data: 'chat_setting.adf_mail',
        //     name: 'adf_mail',
        //     defaultContent: 'N/A',
        //     render: function (data, type, row) {
        //         return row.chat_setting ? row.chat_setting.adf_mail : 'N/A';
        //     }
        // },

        // Dealer Name (merge first name and last name)
        {
            data: null,
            name: 'dealer_name',
            render: function (data, type, row) {
                return (row.name || '') + ' ' + (row.last_name || '');
            }
        },

        // Email
        {
            data: 'email',
            name: 'email',
        },

        // Phone Number (with dial code if present)
        {
            
            data: null,
            name: 'phone_number',
            render: function (data, type, row) {
                return row.dial_code ? row.dial_code + ' ' + row.phone_number : row.phone_number;
            }
        },

        // Is Subscribed (custom column)

        // {
        //     orderable: false,
        //     searchable: false,
        //     data: 'storelist.subscribed',
        //     name: 'subscribed',
        //     render: function (data, type, row) {
        //         return row.storelist && row.storelist.subscribed === 1 ? 'Enable' : 'Disable';
        //     }
        // },
        // {
        //     orderable: false,
        //     searchable: false,
        //     data: 'storelist.is_manage_by_admin',
        //     name: 'is_manage_by_admin',
        //     render: function (data, type, row) {
        //         return row.storelist && row.storelist.is_manage_by_admin === 1 ? 'Manual Payment' : 'Automated';
        //     }
        // },
        {
            orderable: false,
            searchable: false,
            data: 'storelist.is_subscribed',
            name: 'is_subscribed',
            render: function (data, type, row) {
                return row.storelist && row.storelist.is_subscribed === 1 ? 'Subscribed' : 'Not Subscribed';
            }
        },

        // Is Manage by Admin (custom column)
        // {
        //     orderable: false,
        //     searchable: false,
        //     data: 'storelist.subscription_price',
        //     name: 'subscription_price',
        //     render: function (data, type, row) {
        //         return row.storelist ? row.storelist.subscription_price : 'N/A';
        //     }
        // },

        // Free Trial (custom column)
        // {
        //     orderable: false,
        //     searchable: false,
        //     data: 'storelist.free_trial',
        //     name: 'free_trial',
        //     render: function (data, type, row) {
        //         return row.storelist && row.storelist.free_trial === 1 ? 'Yes' : 'No';
        //     }
        // },

        // {
        //     orderable: false,
        //     searchable: false,
        //     data: 'storelist.free_trial_start_date',
        //     name: 'free_trial',
        //     render: function (data, type, row) {
        //         return row.storelist && row.storelist.free_trial === 1 ? 'Yes' : 'No';
        //     }
        // },

        // {
        //     orderable: false,
        //     searchable: false,
        //     data: 'storelist.free_trial_end_date',
        //     name: 'free_trial',
        //     render: function (data, type, row) {
        //         return row.storelist && row.storelist.free_trial === 1 ? 'Yes' : 'No';
        //     }
        // },

        // Cancellation Date (custom column)
        // {
        //     orderable: false,
        //     searchable: false,
        //     data: 'storelist.cancelled_at',
        //     name: 'cancelled_at',
        //     render: function (data, type, row) {
        //         return row.storelist && row.storelist.cancelled_at ? row.storelist.cancelled_at : 'N/A';
        //     }
        // },

        // Action (Edit, View, Change Password, Delete)
        {
            data: null,
            orderable: false,
            searchable: false,
            render: function (data, type, row) {
                var editButton = `<a class="dropdown-item editDealer" data-id="` + row.id + `">Edit</a>`;
                var deleteButton = `<a class="dropdown-item" data-bs-toggle="modal" data-bs-target="#deleteModal" onclick="seturl('` + `{{ route('dealerlist.delete') }}?dealer_id=` + row.id + `')">Delete</a>`;
               // var viewButton = `<a class="dropdown-item viewDealer" data-id="` + row.id + `">View</a>`;
               viewScriptButton=''
               if(row.chat_setting )
                    var viewScriptButton = `<a class="dropdown-item viewDealer" data-script="https://chat.autopulse.ai/assets/js/shaddow.js?userid_id=` + row.chat_setting.uuid + `" data-bs-toggle="modal" data-bs-target="#viewScriptModal">View Script</a>`;
                var changePasswordButton = `<a class="dropdown-item changePassword" data-id="` + row.id + `">Change Password</a>`;

                var loginas = `<a target="_blank" class="dropdown-item " href="{{ route('loginasdealer') }}?dealer=` + row.id + `">Login As Dealer</a>`;
                return `<div class="table_action dropdown">
                            <a class="dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical"></i></a>
                            <ul class="dropdown-menu">
                                <li>`+ viewScriptButton +`</li><li>` + editButton + '</li><li>' + changePasswordButton + '</li><li>' + deleteButton + `</li><li>`+loginas+`</li>
                            </ul>
                        </div>`;
            }
        }
    ],
    language: {
        paginate: {
            first: 'First',
            last: 'Last',
            next: '&rarr;',
            previous: '&larr;',
        },
        lengthMenu: 'Show <select>' +
            '<option value="1" selected>1</option>' +
            '<option value="2">2</option>' +
            '<option value="3">4</option>' +
            '<option value="4">6</option>' +
            '<option value="-1">All</option>' +
            '</select> records',
        info: 'Showing _START_ to _END_ of _TOTAL_ records',
        infoFiltered: '(filtered from _MAX_ total records)',
    }
});

// ========== Global Helper Functions ==========

// Function to show success message for add store
function showAddStoreSuccess(message) {
    $('#addStoreSuccessMessage').text(message || 'Dealer registered successfully!');
    $('#addStoreSuccess').removeClass('d-none').addClass('show');
    
    // Add animation effect
    $('#addStoreSuccess').css({
        'animation': 'slideDown 0.3s ease-out',
        'box-shadow': '0 4px 6px rgba(0, 0, 0, 0.1)'
    });
    
    // Auto-hide success message after 6 seconds
    setTimeout(function() {
        $('#addStoreSuccess').addClass('d-none').removeClass('show');
    }, 6000);
}

// General success message function
function showSuccessMessage(message) {
    $('#generalSuccessText').text(message || 'Operation completed successfully!');
    $('#generalSuccessMessage').removeClass('d-none').addClass('show');
    
    // Add animation effect
    $('#generalSuccessMessage').css({
        'animation': 'slideDown 0.3s ease-out',
        'box-shadow': '0 4px 6px rgba(40, 167, 69, 0.2)'
    });
    
    // Auto-hide after 5 seconds
    setTimeout(function() {
        $('#generalSuccessMessage').addClass('d-none').removeClass('show');
    }, 5000);
}

// General error message function
function showErrorMessage(message) {
    $('#generalErrorText').text(message || 'An error occurred!');
    $('#generalErrorMessage').removeClass('d-none').addClass('show');
    
    // Add animation effect
    $('#generalErrorMessage').css({
        'animation': 'slideDown 0.3s ease-out',
        'box-shadow': '0 4px 6px rgba(220, 53, 69, 0.2)'
    });
    
    // Auto-hide after 6 seconds
    setTimeout(function() {
        $('#generalErrorMessage').addClass('d-none').removeClass('show');
    }, 6000);
}

// Function to show success message for edit store
function showEditStoreSuccess(message) {
    $('#editStoreSuccessMessage').text(message || 'Store updated successfully!');
    $('#editStoreSuccess').removeClass('d-none').addClass('show');
    
    // Add animation effect
    $('#editStoreSuccess').css({
        'animation': 'slideDown 0.3s ease-out',
        'box-shadow': '0 4px 6px rgba(0, 0, 0, 0.1)'
    });
    
    // Auto-hide success message after 3 seconds
    setTimeout(function() {
        $('#editStoreSuccess').addClass('d-none').removeClass('show');
    }, 3000);
}

// ========== End Global Helper Functions ==========

// Cancel Subscription Handler
$('#cancelSubscriptionBtn').on('click', function() {
    var storeId = $(this).attr('data-store-id');
    
    if (!storeId) {
        showErrorMessage('Store ID not found!');
        return;
    }
    
    // Confirm cancellation
    if (!confirm('Are you sure you want to cancel this subscription? This action cannot be undone.')) {
        return;
    }
    
    // Disable button and show loading
    var $btn = $(this);
    var originalText = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin me-2"></i>Cancelling...');
    
    // Make AJAX request
    $.ajax({
        url: '{{ route("admin.dealer.cancel.subscription") }}',
        type: 'POST',
        data: {
            dealer_id: storeId,
            _token: '{{ csrf_token() }}'
        },
        success: function(response) {
            $btn.prop('disabled', false).html(originalText);
            
            if (response.success) {
                // Show success message
                showSuccessMessage(response.message || 'Subscription cancelled successfully!');
                
                // Close modal
                $('#editDealer').modal('hide');
                
                // Scroll to top
                $('html, body').animate({ scrollTop: 0 }, 500);
                
                // Reload dealer table after 1 second
                setTimeout(function() {
                    dealer.ajax.reload();
                }, 1000);
            } else {
                showErrorMessage(response.message || 'Failed to cancel subscription.');
            }
        },
        error: function(xhr, status, error) {
            $btn.prop('disabled', false).html(originalText);
            var errorMessage = 'An error occurred while cancelling subscription.';
            
            if (xhr.responseJSON && xhr.responseJSON.message) {
                errorMessage = xhr.responseJSON.message;
            }
            
            showErrorMessage(errorMessage);
        }
    });
});

function actionmethod() {
    var actionsurl = $('#seturl').val();
    runajax(actionsurl, '', 'get', '', 'json', function (output) {
        if (output.success) {
            $('.modal').modal('hide');
            
            // Show success message
            showSuccessMessage(output.message || 'Record deleted successfully!');
            
            // Scroll to top to show success message
            $('html, body').animate({ scrollTop: 0 }, 500);
            
            // Reload the dealer table
            dealer.ajax.reload();
        } else {
            // Show error message if deletion failed
            showErrorMessage(output.message || 'Failed to delete record.');
        }
    });
}

function seturl(url) {
    $('#seturl').val(url);
}

$('#editdealerform').on('submit', function(event) {
    event.preventDefault();
    if ($(this).valid()) {
        var submitButton = $(this).find('[type="submit"]');
        submitButton.prop('disabled', true).text('Please wait...');
        var formData = $(this).serialize();
        var url = $(this).attr('action');
        runajax(url, formData, 'post', '', 'json', function(output) {
            submitButton.prop('disabled', false).text('Submit');
            if (output.success) {
                showEditStoreSuccess(output.message || 'Store updated successfully!');
                
                // Close modal after showing success message
                setTimeout(function() {
                    $('#editDealer').modal('hide');
                    dealer.ajax.reload();
                    $('#editdealerform')[0].reset();
                }, 2000);
            } else {
                for (var key in output.data) {
                    var existvalue = $('#edit-dealer-' + key).val();
                    // Extract the error message (handle both array and string)
                    var errorMessage = Array.isArray(output.data[key]) ? output.data[key][0] : output.data[key];
                    
                    // Use closure to capture variables correctly
                    (function(fieldKey, existVal, errorMsg) {
                        jQuery.validator.addMethod(fieldKey + "error", function(value, element) {
                            return this.optional(element) || value !== existVal;
                        }, errorMsg); // Pass the error message directly, not through format()
                        jQuery('#edit-dealer-' + fieldKey).addClass(fieldKey + "error");
                        jQuery('#edit-dealer-' + fieldKey).valid();
                        
                        // Scroll to the first error field
                        if ($('.error:visible').length > 0) {
                            $('html, body').animate({
                                scrollTop: $('.error:visible').first().offset().top - 100
                            }, 500);
                        }
                    })(key, existvalue, errorMessage);
                }
            }
        });
    }
});

$('#dealerregisterForm').on('submit', function(event) {
    event.preventDefault();
    if ($(this).valid()) {
        var submitButton = $(this).find('[type="submit"]');
        submitButton.prop('disabled', true).text('Please wait...');
        var formData = $(this).serialize();
        var url = $(this).attr('action');
        runajax(url, formData, 'post', '', 'json', function(output) {
            submitButton.prop('disabled', false).text('Submit');
            if (output.success) {
                // Show success message
                showAddStoreSuccess(output.message || 'Dealer registered successfully!');
                
                // Scroll to top to show success message
                $('html, body').animate({ scrollTop: 0 }, 500);
                
                // Reset form
                $('#dealerregisterForm')[0].reset();
                
                // Switch to All Accounts tab after 1.5 seconds
                setTimeout(function() {
                    $('#dealerlisttab').trigger('click');
                    // Reload the dealer table
                    dealer.ajax.reload();
                }, 1500);
                
                // Optionally reload the entire page after showing the message for 3 seconds
                // Uncomment the line below if you want full page reload
                // setTimeout(function() { window.location.reload(); }, 3000);
            } else {
                for (var key in output.data) {
                    let existvalue = $('#' + key).val(); // Get the current value of the element

                    // Ensure existvalue is a string
                    existvalue = existvalue ? String(existvalue) : '';
                    
                    // Extract the error message (handle both array and string)
                    var errorMessage = Array.isArray(output.data[key]) ? output.data[key][0] : output.data[key];
                    // Ensure error message is a string
                    errorMessage = errorMessage ? String(errorMessage) : 'Validation error';

                    // Use closure to capture variables correctly
                    (function(fieldKey, existVal, errorMsg) {
                        // Add a custom validation method for each field
                        jQuery.validator.addMethod(fieldKey + "_error", function(value, element) {
                            // Ensure the value is a string
                            value = value ? String(value) : '';

                            // Check if the value is different from the existing value
                            return this.optional(element) || value !== existVal;
                        }, errorMsg); // Pass the error message directly, not through format()

                        // Apply the custom validation method to the element
                        jQuery('#' + fieldKey).rules('add', {
                            [fieldKey + "_error"]: true
                        });

                        // Validate the element to check if it's valid or not
                        jQuery('#' + fieldKey).valid();
                        
                        // Scroll to the first error field
                        if ($('.error:visible').length > 0) {
                            $('html, body').animate({
                                scrollTop: $('.error:visible').first().offset().top - 100
                            }, 500);
                        }
                    })(key, existvalue, errorMessage);
                }

            }
        });
    }
});

// Function to clear all error messages and states for dealerlist
function clearDealerlistChangePasswordErrors() {
    $('#changePasswordErrors').addClass('d-none');
    $('#changePasswordErrorList').empty();
    $('#changePasswordSuccess').addClass('d-none');
    
    // Clear field errors
    $('#change-password-password, #change-password-confirm').removeClass('is-invalid');
    $('#password_error, #password_confirmation_error').text('');
}

// Function to show error messages for dealerlist
function showDealerlistChangePasswordErrors(errors) {
    clearDealerlistChangePasswordErrors();
    
    if (errors && Object.keys(errors).length > 0) {
        $('#changePasswordErrors').removeClass('d-none');
        
        // Show general errors
        if (errors.general) {
            $('#changePasswordErrorList').append('<li>' + errors.general + '</li>');
        }
        
        // Show field-specific errors
        for (var field in errors) {
            if (field !== 'general') {
                var fieldElement;
                var errorElement;
                
                // Map server field names to actual DOM element IDs
                if (field === 'password') {
                    fieldElement = $('#change-password-password');
                    errorElement = $('#password_error');
                } else if (field === 'password_confirmation') {
                    fieldElement = $('#change-password-confirm');
                    errorElement = $('#password_confirmation_error');
                } else {
                    // Try direct mapping for other fields
                    fieldElement = $('#change-password-' + field);
                    errorElement = $('#' + field + '_error');
                }
                
                if (fieldElement.length && errorElement.length) {
                    fieldElement.addClass('is-invalid');
                    errorElement.text(errors[field][0] || errors[field]);
                } else {
                    // Add to general error list if field not found
                    $('#changePasswordErrorList').append('<li>' + (errors[field][0] || errors[field]) + '</li>');
                }
            }
        }
    }
}

// Function to show success message for dealerlist
function showDealerlistChangePasswordSuccess(message) {
    clearDealerlistChangePasswordErrors();
    $('#changePasswordSuccessMessage').text(message || 'Password changed successfully!');
    $('#changePasswordSuccess').removeClass('d-none');
    
    // Auto-hide success message after 3 seconds
    setTimeout(function() {
        $('#changePasswordSuccess').addClass('d-none');
    }, 3000);
}

// Function to validate password confirmation for dealerlist
function validateDealerlistPasswordConfirmation() {
    var password = $('#change-password-password').val();
    var confirmPassword = $('#change-password-confirm').val();
    
    if (password && confirmPassword && password !== confirmPassword) {
        $('#change-password-confirm').addClass('is-invalid');
        $('#password_confirmation_error').text('Passwords do not match');
        return false;
    } else {
        $('#change-password-confirm').removeClass('is-invalid');
        $('#password_confirmation_error').text('');
        return true;
    }
}

// Real-time password confirmation validation for dealerlist
$('#change-password-confirm').on('input', function() {
    validateDealerlistPasswordConfirmation();
});

$('#change-password-password').on('input', function() {
    validateDealerlistPasswordConfirmation();
});

$('#changePasswordForm').on('submit', function(event) {
    event.preventDefault();
    
    // Clear previous errors
    clearDealerlistChangePasswordErrors();
    
    // Validate password confirmation
    if (!validateDealerlistPasswordConfirmation()) {
        // Don't show generic message, just return - field errors are already shown
        return;
    }
    
    // Basic form validation
    var password = $('#change-password-password').val();
    var confirmPassword = $('#change-password-confirm').val();
    
    if (!password || !confirmPassword) {
        // Show specific field errors instead of generic message
        if (!password) {
            $('#change-password-password').addClass('is-invalid');
            $('#password_error').text('Password is required');
        }
        if (!confirmPassword) {
            $('#change-password-confirm').addClass('is-invalid');
            $('#password_confirmation_error').text('Password confirmation is required');
        }
        return;
    }
    
    if (password.length < 8) {
        showDealerlistChangePasswordErrors({
            password: ['Password must be at least 8 characters long']
        });
        return;
    }
    
    var submitButton = $('#submitPasswordChange');
    var originalText = submitButton.text();
    
    // Show loading state
    submitButton.prop('disabled', true).html('<i class="fa fa-spinner fa-spin me-2"></i>Changing...');

    var formData = $(this).serialize();
    var url = $(this).attr('action');

    runajax(url, formData, 'post', '', 'json', function(output) {
        // Reset button state
        submitButton.prop('disabled', false).text(originalText);
        
        if (output.success) {
            showDealerlistChangePasswordSuccess(output.message || 'Password changed successfully!');
            
            // Clear form
            $('#changePasswordForm')[0].reset();
            
            // Close modal after showing success message
            setTimeout(function() {
                $('#changePasswordModal').modal('hide');
                dealer.ajax.reload();
            }, 2000);
        } else {
            // Show server-side validation errors
            if (output.data && typeof output.data === 'object') {
                showDealerlistChangePasswordErrors(output.data);
            } else if (output.errors && typeof output.errors === 'object') {
                showDealerlistChangePasswordErrors(output.errors);
            } else {
                showDealerlistChangePasswordErrors({
                    general: output.message || 'An error occurred while changing the password'
                });
            }
        }
    });
});




    // Multistep form
$(document).ready(function () {
    $('.next-step').on('click', function () {
        var currentStep = $(this).closest('.form-step');
        var nextStep = currentStep.next('.form-step');

        nextStep.show(); // Show the next form field below
        $(this).hide(); // Hide the "Next" button of the current step
    });
});

$('#downloadData').on('click', function() {
    // Construct the URL for the download request with the filters
    var downloadUrl = '{{ route("dealerlist.downloadCSV") }}' +
        '?transaction_type=' + $('#subscriptionTypeSelect').val() +
        '&from=' + $('#dealer-from').val() +
        '&to=' + $('#dealer-to').val();
    
    // Trigger the download
    window.location.href = downloadUrl;
});

// Store Hours Toggle Functions
function toggleDayHours(day) {
    var isClosed = document.getElementById('closed-' + day).checked;
    var openInput = document.getElementById('open-' + day);
    var closeInput = document.getElementById('close-' + day);
    
    if (isClosed) {
        // If day is closed (checked), ENABLE time inputs and set default values
        openInput.disabled = false;
        closeInput.disabled = false;
        if (!openInput.value) openInput.value = '09:00';
        if (!closeInput.value) closeInput.value = '18:00';
    } else {
        // If day is open (unchecked), DISABLE time inputs and clear values
        openInput.disabled = true;
        closeInput.disabled = true;
        openInput.value = '';
        closeInput.value = '';
    }
}

function toggleEditDayHours(day) {
    var isClosed = document.getElementById('edit-closed-' + day).checked;
    var openInput = document.getElementById('edit-open-' + day);
    var closeInput = document.getElementById('edit-close-' + day);
    
    if (isClosed) {
        // If day is closed (checked), ENABLE time inputs and set default values
        openInput.disabled = false;
        closeInput.disabled = false;
        if (!openInput.value) openInput.value = '09:00';
        if (!closeInput.value) closeInput.value = '18:00';
    } else {
        // If day is open (unchecked), DISABLE time inputs and clear values
        openInput.disabled = true;
        closeInput.disabled = true;
        openInput.value = '';
        closeInput.value = '';
    }
}

// Store Hours Enable/Disable Toggle
$(document).ready(function() {
    // For add form
    $('#is_store_hours_enabled').change(function() {
        if ($(this).is(':checked')) {
            $('#store-hours-section').show();
        } else {
            $('#store-hours-section').hide();
        }
    });
    
    // For edit form
    $('#edit-is_store_hours_enabled').change(function() {
        if ($(this).is(':checked')) {
            $('#edit-store-hours-section').show();
        } else {
            $('#edit-store-hours-section').hide();
        }
    });
    
    // Initialize store hours section visibility
    if ($('#is_store_hours_enabled').is(':checked')) {
        $('#store-hours-section').show();
    } else {
        $('#store-hours-section').hide();
    }
    
    if ($('#edit-is_store_hours_enabled').is(':checked')) {
        $('#edit-store-hours-section').show();
    } else {
        $('#edit-store-hours-section').hide();
    }
});

// Script
document.getElementById('copy-button').addEventListener('click', function() {
    var embedCode = document.getElementById('embed-code');
    embedCode.select();
    document.execCommand('copy');
    alert('Embed code copied to clipboard');
});
</script>
@endsection
