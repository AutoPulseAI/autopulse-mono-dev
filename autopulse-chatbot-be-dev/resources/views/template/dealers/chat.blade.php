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
                        <div class="settings-area mb-0">
                            <h3 class="title mb-0">AutoPulse AI</h3>
                        </div>
                    </div>
                    <div class="content-page pb--50">

                        @if (session('error'))                                   
                            <div class="alert alert-danger" role="alert">
                            {{ session('error') }}
                            </div>
                        @endif 

                        <!-- ChatenAI Settings -->
                        <div class="single-settings-box profile-details-box top-flashlight light-xl leftside overflow-hidden">
                            <div class="wrapper">
                                <div class="section-title">
                                    <h4 class="rbt-title-style-3">Customize AutoPulse AI settings</h4>
                                </div>
                                <!-- Start Profile Row  -->
                                <form action="{{ (isset($chatbotSetting) && !empty($chatbotSetting->id)) ? route('chatbot_settings.update') : route('chatbot_settings.store') }}" class="rbt-profile-row rbt-default-form row row--15" method="POST" enctype="multipart/form-data" id="chatbot-settings-form">
                                    @csrf
                                    @if(isset($chatbotSetting) && !empty($chatbotSetting->id))
                                        <input type="hidden" name="id" id="id" value="{{  $chatbotSetting->id  }}" >
                                    @endif
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label>Adf Email</label>
                                            <input type="text" name="adf_mail" id="adf_mail" value="{{ old('adf_mail', $chatbotSetting->adf_mail ?? '') }}" required>
                                        </div>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label>What would you like to name your AI Bot ?</label>
                                            <input type="text" name="chatbot_name" id="chatbot_name" value="{{ old('chatbot_name', $chatbotSetting->chatbot_name ?? '') }}" required>
                                        </div>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label for="username">Dealership Name</label>
                                            <input type="text" name="dealership_name" id="dealership_name" value="{{ old('dealership_name', $chatbotSetting->dealership_name ?? '') }}" required>
                                        </div>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label for="username">Dealership URL</label>
                                            <input type="text" name="dealership_url" id="dealership_url" value="{{ old('dealership_url', $chatbotSetting->dealership_url ?? '') }}">
                                        </div>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label for="username">Logo</label>
                                            <input type="file" name="logo" id="logo" accept="image/*" class="input-file py-3">
                                        </div>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label for="username">Icon Logo</label>
                                            <input type="file" name="icon_logo" id="icon_logo" accept="image/*" class="input-file py-3">
                                        </div>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label for="username">Primary Color</label>
                                            <input type="color" name="primary_color" id="primary_color" value="{{ old('primary_color', $chatbotSetting->primary_color ?? '#000000') }}" class="bg-transparant px-0">
                                        </div>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label for="username">Chatbot Position</label>
                                            <div class="row g-0">
                                                <div class="col col-md-6 col-6">
                                                    <input type="radio" name="position" id="inlineRadio1" value="right" 
                                                    @if(isset($chatbotSetting)) @if($chatbotSetting->position == 'right')  checked @endif 
                                                    @else checked @endif>
                                                    <label for="inlineRadio1">Right side</label>
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
                                    </div>
                                    <div class="col-12">
                                        <div class="form-group">
                                            <label>Welcome Message</label>
                                            <textarea name="welcome_message" class="required" id="welcome_message" cols="20" rows="2">{{ old('welcome_message', $chatbotSetting->welcome_message ?? '') }}</textarea>
                                        </div>
                                    </div>

                                    <!-- Store Address Information -->
                                    <div class="col-12 mt-3">
                                        <h5 class="rbt-title-style-3">Store Information</h5>
                                    </div>
                                    <div class="col-lg-12 col-md-12 col-sm-12 col-12">
                                        <div class="form-group">
                                            <label>Store Address</label>
                                            <textarea name="store_address" id="store_address" cols="20" rows="2" placeholder="123 Main Street">{{ old('store_address', $chatbotSetting->store_address ?? '') }}</textarea>
                                        </div>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label>City</label>
                                            <input type="text" name="store_city" id="store_city" value="{{ old('store_city', $chatbotSetting->store_city ?? '') }}" placeholder="Springfield">
                                        </div>
                                    </div>
                                    <div class="col-lg-3 col-md-3 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label>State</label>
                                            <input type="text" name="store_state" id="store_state" value="{{ old('store_state', $chatbotSetting->store_state ?? '') }}" placeholder="IL">
                                        </div>
                                    </div>
                                    <div class="col-lg-3 col-md-3 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label>ZIP Code</label>
                                            <input type="text" name="store_zip" id="store_zip" value="{{ old('store_zip', $chatbotSetting->store_zip ?? '') }}" placeholder="62701">
                                        </div>
                                    </div>

                                    <!-- Contact Person Information -->
                                    <div class="col-12 mt-3">
                                        <h5 class="rbt-title-style-3">Contact Person</h5>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label>Contact Person Name</label>
                                            <input type="text" name="contact_person_name" id="contact_person_name" value="{{ old('contact_person_name', $chatbotSetting->contact_person_name ?? '') }}" placeholder="John Smith">
                                        </div>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label>Contact Phone</label>
                                            <input type="tel" name="contact_person_phone" id="contact_person_phone" value="{{ old('contact_person_phone', $chatbotSetting->contact_person_phone ?? '') }}" placeholder="+1 (555) 123-4567">
                                        </div>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label>Contact Email</label>
                                            <input type="email" name="contact_person_email" id="contact_person_email" value="{{ old('contact_person_email', $chatbotSetting->contact_person_email ?? '') }}" placeholder="john.smith@dealership.com">
                                        </div>
                                    </div>

                                    <!-- Managerial Contact Information -->
                                    <div class="col-12 mt-3">
                                        <h5 class="rbt-title-style-3">Managerial Contact</h5>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label>Managerial Contact Phone</label>
                                            <input type="tel" name="managerial_contact_phone" id="managerial_contact_phone" value="{{ old('managerial_contact_phone', $chatbotSetting->managerial_contact_phone ?? '') }}" placeholder="+1 (555) 987-6543">
                                        </div>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label>Managerial Contact Email</label>
                                            <input type="email" name="managerial_contact_email" id="managerial_contact_email" value="{{ old('managerial_contact_email', $chatbotSetting->managerial_contact_email ?? '') }}" placeholder="manager@dealership.com">
                                        </div>
                                    </div>

                                    <!-- Timezone and Store Hours -->
                                    <div class="col-12 mt-3">
                                        <h5 class="rbt-title-style-3">Store Hours & Timezone</h5>
                                    </div>
                                    <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                        <div class="form-group">
                                            <label>Timezone</label>
                                            <select name="timezone" id="timezone" class="form-select">
                                                <option value="America/New_York" {{ old('timezone', $chatbotSetting->timezone ?? '') == 'America/New_York' ? 'selected' : '' }}>Eastern Time (America/New_York)</option>
                                                <option value="America/Chicago" {{ old('timezone', $chatbotSetting->timezone ?? '') == 'America/Chicago' ? 'selected' : '' }}>Central Time (America/Chicago)</option>
                                                <option value="America/Denver" {{ old('timezone', $chatbotSetting->timezone ?? '') == 'America/Denver' ? 'selected' : '' }}>Mountain Time (America/Denver)</option>
                                                <option value="America/Los_Angeles" {{ old('timezone', $chatbotSetting->timezone ?? '') == 'America/Los_Angeles' ? 'selected' : '' }}>Pacific Time (America/Los_Angeles)</option>
                                                <option value="America/Anchorage" {{ old('timezone', $chatbotSetting->timezone ?? '') == 'America/Anchorage' ? 'selected' : '' }}>Alaska Time (America/Anchorage)</option>
                                                <option value="Pacific/Honolulu" {{ old('timezone', $chatbotSetting->timezone ?? '') == 'Pacific/Honolulu' ? 'selected' : '' }}>Hawaii Time (Pacific/Honolulu)</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div class="col col-12">
                                        <div class="form-group">
                                            <div class="form-check ps-0">
                                                <input class="form-check-input" type="checkbox" name="is_store_hours_enabled" id="is_store_hours_enabled" value="1" 
                                                    {{ old('is_store_hours_enabled', $chatbotSetting->is_store_hours_enabled ?? true) ? 'checked' : '' }}>
                                                <label class="form-check-label mb-0" for="is_store_hours_enabled">
                                                    Enable Store Hours
                                                </label>
                                            </div>                                            
                                            <small class="form-text text-muted">Check to enable store hours validation for the chatbot</small>
                                        </div>
                                    </div>

                                    <!-- Store Hours Schedule -->
                                    <div class="col-12 mb-3" id="store-hours-section">
                                        <div class="position-relative">
                                            <div class="row ">
                                                <div class="col col-4">
                                                    <div class="form-group mb-2">
                                                        <label>Day</label>
                                                    </div>
                                                </div>
                                                <div class="col col-4">
                                                    <div class="form-group mb-2">
                                                        <label>Openning Time</label>
                                                    </div>
                                                </div>
                                                <div class="col col-4">
                                                    <div class="form-group mb-2">
                                                        <label>Close Time</label>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="position-relative">

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
                                                    $storeHours = old('store_hours', $chatbotSetting->store_hours ?? $defaultHours);
                                                @endphp
                                                
                                                @foreach($days as $index => $day)
                                                    <div class="row g-2">
                                                        <div class="col col-4 d-flex align-items-center">
                                                            <div class="form-group mb-2">
                                                                <div class="form-check ps-0">
                                                                    <input class="form-check-input" type="checkbox" name="store_hours[{{ $day }}][closed]" 
                                                                        id="closed-{{ $day }}"
                                                                        value="1" 
                                                                        {{ ($storeHours[$day]['closed'] ?? false) ? 'checked' : '' }}
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
                                                                    value="{{ $storeHours[$day]['open'] ?? '09:00' }}" >
                                                            </div>
                                                        </div>
                                                        <div class="col col-4">
                                                            <div class="form-group mb-2">
                                                                <input type="time" 
                                                                    name="store_hours[{{ $day }}][close]" 
                                                                    id="close-{{ $day }}"
                                                                    value="{{ $storeHours[$day]['close'] ?? '18:00' }}">
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <!-- <div class="day-hours-row" style="margin-bottom: 20px; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #fafafa;">
                                                        <div style="display: flex; align-items: center; margin-bottom: 10px;">
                                                            <div style="min-width: 120px;">
                                                                <strong style="font-size: 16px;">{{ $dayLabels[$index] }}</strong>
                                                            </div>
                                                            <div class="closed-checkbox-container" style="margin-left: 20px;">
                                                                <label style="margin: 0; display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;">
                                                                    <input type="checkbox" 
                                                                        name="store_hours[{{ $day }}][closed]" 
                                                                        id="closed-{{ $day }}"
                                                                        value="1" 
                                                                        {{ ($storeHours[$day]['closed'] ?? false) ? 'checked' : '' }}
                                                                        onchange="toggleDayHours('{{ $day }}')"
                                                                        style="margin: 0; transform: scale(1.2);">
                                                                    <span style="font-weight: 500; color: #d32f2f;">Closed</span>
                                                                </label>
                                                            </div>
                                                        </div>
                                                        
                                                        <div class="time-inputs-container" 
                                                            id="time-inputs-{{ $day }}" 
                                                            style="display: {{ ($storeHours[$day]['closed'] ?? false) ? 'none' : 'block' }};">
                                                            <div style="display: flex; align-items: center; gap: 20px; padding: 15px; background-color: white; border-radius: 6px; border: 1px solid #ddd;">
                                                                <div style="display: flex; flex-direction: column; gap: 5px;">
                                                                    <label style="font-size: 13px; font-weight: 500; color: #333;">Opening Time</label>
                                                                    <input type="time" 
                                                                        name="store_hours[{{ $day }}][open]" 
                                                                        id="open-{{ $day }}"
                                                                        value="{{ $storeHours[$day]['open'] ?? '09:00' }}" 
                                                                        style="padding: 10px 12px; border: 2px solid #ccc; border-radius: 6px; font-size: 14px; min-width: 140px; background-color: white;"
                                                                        onfocus="this.style.borderColor='#2196F3'; this.style.outline='none';"
                                                                        onblur="this.style.borderColor='#ccc';">
                                                                </div>
                                                                
                                                                <div style="display: flex; align-items: center; font-weight: 500; color: #666; font-size: 16px;">
                                                                    to
                                                                </div>
                                                                
                                                                <div style="display: flex; flex-direction: column; gap: 5px;">
                                                                    <label style="font-size: 13px; font-weight: 500; color: #333;">Closing Time</label>
                                                                    <input type="time" 
                                                                        name="store_hours[{{ $day }}][close]" 
                                                                        id="close-{{ $day }}"
                                                                        value="{{ $storeHours[$day]['close'] ?? '18:00' }}" 
                                                                        style="padding: 10px 12px; border: 2px solid #ccc; border-radius: 6px; font-size: 14px; min-width: 140px; background-color: white;"
                                                                        onfocus="this.style.borderColor='#2196F3'; this.style.outline='none';"
                                                                        onblur="this.style.borderColor='#ccc';">
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div> -->
                                                @endforeach
                                            </div>

                                        </div>
                                    </div>

                                    <div class="col-12">
                                        <div class="form-group">
                                            <label>Closed Message</label>
                                            <textarea name="closed_message" id="closed_message" cols="20" rows="2" placeholder="We are currently closed. Please leave a message and we'll get back to you during business hours.">{{ old('closed_message', $chatbotSetting->closed_message ?? '') }}</textarea>
                                        </div>
                                    </div>

                                    <div class="col-12 mt--20">
                                        <div class="form-group mb--0">
                                            <button class="rainbow-gradient-btn m-0" type="submit"><span>{{ isset($chatbotSetting) ? 'Update My AutoPulse AI' : 'Create My AutoPulse AI' }}</span></button>
                                        </div>
                                    </div>
                                </form>
                                <!-- End Profile Row  -->
                            </div>
                        </div>

                        @if(isset($chatbotSetting))  
                            <!-- Start Script Row  -->
                            <div class="row">
                                @if($dealer->storelist && $dealer->storelist->is_subscribed == 1 && (!$dealer->storelist->cancelled_at || \Carbon\Carbon::now()->lessThanOrEqualTo(\Carbon\Carbon::parse($dealer->storelist->cancelled_at))))   
                                <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                    <div class="single-settings-box profile-details-box top-flashlight light-xl leftside overflow-hidden">
                                        <div class="rbt-profile-row rbt-default-form row row--15">
                                            <div class="wrapper">
                                                <div class="section-title">
                                                    <h4 class="rbt-title-style-3">Embed Code</h4>
                                                </div>
                                                <div class="form-group">
                                                    <label>Copy and paste the code below into your website to embed the chatbot.</label>
                                                    <textarea id="embed-code" cols="20" rows="3" readonly><script src="{{ asset('assets/js/shaddow.js') }}?userid_id={{ $chatbotSetting->uuid }}"></script></textarea>
                                                </div>
                                                <div class="form-group mb--0">
                                                    <button class="rainbow-gradient-btn m-0" type="submit" id="copy-button"><span>Copy</span></button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>  
                                @endif

                                @php
                                    function hexToRgba($hex, $opacity = 0.5) {
                                        $hex = ltrim($hex, '#');
                                        if (strlen($hex) == 3) {
                                            $hex = $hex[0].$hex[0] . $hex[1].$hex[1] . $hex[2].$hex[2];
                                        }
                                        $r = hexdec(substr($hex, 0, 2));
                                        $g = hexdec(substr($hex, 2, 2));
                                        $b = hexdec(substr($hex, 4, 2));
                                        return "rgba($r, $g, $b, $opacity)";
                                    }
                                @endphp

                                <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                    <style>
                                        :root{
                                            --chbxprimary: {{ $chatbotSetting->primary_color ?? '#ccc' }};
                                            --chbxprimary-light: {{ hexToRgba($chatbotSetting->primary_color ?? '#ccc', 0.1) }};
                                            --white: #ffffff;
                                        }
                                        .chatboxAi_prev .chatbx_response .chatbx_msg_l:before {
                                            content: '';
                                            background: url("{{ $chatbotSetting && $chatbotSetting->icon_logo ? $chatbotSetting->icon_logo : 'https://via.placeholder.com/25' }}");
                                            width: 28px;
                                            height: 28px;
                                            background-position: center;
                                            background-repeat: no-repeat;
                                            background-size: cover;
                                            display: block;
                                            position: absolute;
                                            left: -32px;
                                            top: 0;
                                            border-radius: 4px 0 4px 4px;
                                        }
                                        /* Preview */
                                        .chatboxAi_prev .chatbx_primary{
                                            position: relative;
                                            width: 350px;
                                            height: auto;
                                            background-color: #FFFFFF;
                                            box-shadow: 0px 6px 10px rgba(0, 0, 0, .05);
                                            border-radius: 10px;
                                            overflow: hidden;
                                        }
                                        .chatboxAi_prev .chatbx_head{
                                            position: relative;
                                            display: flex;
                                            align-items: center;
                                            padding: 6px 12px !important;
                                            height: 50px;
                                            background-color: var(--white);
                                            --border-color: rgba(52, 59, 74, 0.05);
                                            border-bottom: 1px solid var(--border-color);
                                        }
                                        .chatboxAi_prev .chatbx_head img{
                                            width: auto;
                                            max-height: 36px;
                                            object-fit: contain;
                                        }
                                        .chatboxAi_prev .chatbx_primary .chatbx_head a{
                                            color: #051622;
                                        }
                                        .chatboxAi_prev .chatbx_head, .chatboxAi_prev .chatbx_response {
                                            padding: 12px;
                                        }
                                        .chatboxAi_prev .chatbx_window {
                                            position: relative;
                                            height: 447px;
                                            overflow-y: auto;
                                            overflow-x: hidden;
                                        }
                                        .chatboxAi_prev .chatbx_input{
                                            position: relative;
                                            border-top: 1px solid rgba(36, 39, 44, .1);
                                        }
                                        .chatboxAi_prev .chatbx_input a{
                                            color: var(--chbxprimary);
                                            cursor: pointer;
                                            background-color: var(--chbxprimary-light);
                                            padding: 3px 8px !important;
                                            margin-right: 2px;
                                            border-radius: 5px !important;
                                            margin-left: 0 !important;
                                        }
                                        .chatboxAi_prev .chatbx_input .form-control{
                                            padding-bottom: 8px;
                                        }
                                        .chatboxAi_prev .chatbx_input .form-control:disabled, .chatboxAi_prev .chatbx_input .form-control[readonly] {
                                            background-color: #FFFFFF;
                                            opacity: 1;
                                        }
                                        .chatboxAi_prev .chatbx_input small{
                                            font-size: 11px;
                                            line-height: 11px;
                                            padding-bottom: 6px;
                                            display: block;
                                            padding-left: 12px;
                                        }
                                        .chatboxAi_prev .chatbx_response .chatbx_msg_l {
                                            position: relative;
                                            max-width: 82%;
                                            line-height: 18px;
                                            font-size: 15px;
                                            margin-bottom: 8px;
                                            display: block;
                                            margin-left: 32px;
                                        }
                                        .chatboxAi_prev .chatbx_response .chatbx_msg_l small {
                                            position: relative;
                                            background-color: #EFF3FA;
                                            border-radius: 0 5px 5px 5px;
                                            padding: 8px;
                                            display: inline-block;
                                            color: #051622;
                                            font-weight: 500;
                                        }
                                    </style>
                                    <div class="position-relative authscreen_prev">
                                        <div class="wrapper">
                                            <div class="section-title">
                                                <h4 class="rbt-title-style-3">Chatbot Preview</h4>
                                            </div>
                                            <div class="position-relative chatboxAi_prev">
                                                <div class="chatbx_primary mx-auto" style="width: 350px;">
                                                    <div class="chatbx_head">
                                                        <img src="{{ $chatbotSetting && $chatbotSetting->logo ? $chatbotSetting->logo : 'https://via.placeholder.com/50' }}" alt="img" id="chatbot-auto-logo">
                                                        <a class="full_screen ms-auto"><i class="fa-solid fa-expand"></i></a>
                                                        <a class="mini_a ms-3"><i class="fa-solid fa-minus"></i></a>
                                                        <a class="ms-3 chatboxO_a"><i class="fa-solid fa-xmark"></i></a>
                                                    </div>
                                                    <div class="chatbx_window">
                                                        <div class="chatbx_response">
                                                            <div class="chatbx_msg_l"><small class="welcome_message"> {{ $chatbotSetting->welcome_message ?? 'Chatbot' }}</small></div>
                                                        </div>
                                                    </div>
                                                    <div class="chatbx_input">
                                                        <div class="input-group align-items-center flex-nowrap">
                                                            <input type="text" class="form-control mb-0 border-0" placeholder="Type any questions here..." disabled>
                                                            <a id="sendBtn" class="px-2">
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-send"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                                                <!-- <i class="fa-solid fa-paper-plane"></i> -->
                                                            </a>
                                                        </div>
                                                        <small id="charCount" class="text-muted">0/2000</small>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>   
                                <div class="col-lg-6 col-md-6 col-sm-6 col-12">        
                                    @if($dealer->storelist && $dealer->storelist->is_subscribed == 0 )
                            
                                    <!-- If not subscribed, append this code -->
                                    <div class="position-relative authscreen">
                                        <div class="position-relative text-center">
                                            <p>Unlock your AI Bot Integration! Subscribe now to receive your custom JavaScript code and elevate your website's interactivity.</p>
                                            <a href="{{route('dealer.billing') }}" class="rainbow-gradient-btn m-0"><span>Subscribe Now</span></a>
                                        </div>
                                    </div>
                                    @elseif (isset($dealer->storelist->cancelled_at) && \Carbon\Carbon::now()->greaterThanOrEqualTo(\Carbon\Carbon::parse($dealer->storelist->cancelled_at)))
                                        <div class="position-relative authscreen">
                                            <div class="position-relative text-center">
                                                <p>Unlock your AI Bot Integration! Subscribe now to receive your custom JavaScript code and elevate your website's interactivity.</p>
                                                <a href="{{route('dealer.billing') }}" class="rainbow-gradient-btn m-0"><span>Subscribe Now</span></a>
                                            </div>
                                        </div>                        
                                    @endif
                                </div>    
                            </div>   
                            
                            <!-- End Script Row  -->                       
                        
                        @endif
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
    document.getElementById('chatbot_name').addEventListener('input', function() {
        document.getElementById('preview_name').innerText = this.value || 'Chatbot';
    });

    document.getElementById('primary_color').addEventListener('input', function() {
        document.getElementById('preview_banner').style.backgroundColor = this.value;
    });

    //document.getElementById('secondary_color').addEventListener('input', function() {
       // document.getElementById('preview_header').style.backgroundColor = this.value;
    //});

    document.getElementById('welcome_message').addEventListener('input', function() {
        document.getElementById('preview_welcome_message').innerText = this.value || 'Hello, I am your assistant. How can I help you?';
    });

    document.getElementById('logo').addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('preview_logo').src = e.target.result;
                document.getElementById('preview_header_logo').src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('icon_logo').addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('preview_icon_logo').src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    $('#chatbot-settings-form button').click(function(e){
        e.preventDefault();
        let $button = $(this);
        $button.find('span').text('Please wait...');
        $button.attr('disabled','disabled');

        if ($('#chatbot-settings-form').valid()) {
            let url = '{{ isset($chatbotSetting) ? route("chatbot_settings.update", $chatbotSetting->id) : route("chatbot_settings.store") }}';
            let formData = new FormData($('#chatbot-settings-form')[0]);

            $.ajax({
                url: url,
                type: '{{ isset($chatbotSetting) ? "POST" : "POST" }}',
                data: formData,
                processData: false,
                contentType: false,
                success: function(response) {
                    $button.find('span').text('{{ isset($chatbotSetting) ? "Update Settings" : "Create Settings" }}');
                    $button.removeAttr('disabled');
                    if (response.success) {
                        window.location.reload();
                        $('.successmsgdiv').html(response.message);
                        $('#thank_you').modal('show');
                    } else {
                        alert('Something went wrong.');
                    }
                },
                error: function(xhr) {
                    $button.find('span').text('{{ isset($chatbotSetting) ? "Update Settings" : "Create Settings" }}');
                    $button.removeAttr('disabled');
                    let errors = xhr.responseJSON.data;
                    for (let key in errors) {
                        let existvalue = $('#'+key).val();
                        jQuery.validator.addMethod(key + "error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(errors[key][0]));
                        $('#'+key).addClass(key + "error");
                        $('#'+key).valid();
                        let errorMessage = errors[key][0];
                        let inputField = $('#'+key);

                        inputField.addClass('is-invalid'); // Add Bootstrap's is-invalid class for styling

                        // Append the error message
                        if (!inputField.next('.invalid-feedback').length) {
                        //inputField.after('<div class="invalid-feedback">' + errorMessage + '</div>');
                        }
                        $('#chatbot-settings-form').valid()
                    }
                }
            });
        } else {
            $button.find('span').text('{{ isset($chatbotSetting) ? "Update Settings" : "Create Settings" }}');
            $button.removeAttr('disabled');
        }
    });

    $('.form-control').on('input change', function() {
        $(this).removeClass('is-invalid'); // Remove error class
        $(this).next('.invalid-feedback').remove(); // Remove the error message
    });

    document.getElementById('copy-button').addEventListener('click', function() {
        var embedCode = document.getElementById('embed-code');
        embedCode.select();
        document.execCommand('copy');
        alert('Embed code copied to clipboard');
    });

    function showhide(classvariable, classid){
        $('.'+classvariable).hide();
        $('#'+classid).show();
    }

    // Store Hours Management
    function toggleDayHours(day) {
        console.log('Toggling day hours for:', day); // Debug log
        
        const checkbox = document.getElementById(`closed-${day}`);
        // const timeInputsContainer = document.getElementById(`time-inputs-${day}`);
        const openInput = document.getElementById(`open-${day}`);
        const closeInput = document.getElementById(`close-${day}`);
        
        if (!checkbox) {
            console.error('Required elements not found for day:', day);
            return;
        }
        
        if (checkbox.checked) {
            // timeInputsContainer.style.display = 'none';
            // Remove required attribute when closed
            if (openInput) openInput.setAttribute('required', 'required');
            if (closeInput) closeInput.setAttribute('required', 'required');
            if (openInput) openInput.removeAttribute('disabled');
            if (closeInput) closeInput.removeAttribute('disabled');
            console.log('Day closed:', day);
        } else {
            // timeInputsContainer.style.display = 'block';
            // Add required attribute when open
            if (openInput) openInput.removeAttribute('required');
            if (closeInput) closeInput.removeAttribute('required');            
            if (openInput) openInput.setAttribute('disabled', 'true');
            if (closeInput) closeInput.setAttribute('disabled', 'true');
            console.log('Day opened:', day);
        }
    }

    // Initialize store hours functionality
    document.addEventListener('DOMContentLoaded', function() {
        console.log('Initializing store hours functionality');
        
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        
        // Initialize each day
        days.forEach(day => {
            const checkbox = document.getElementById(`closed-${day}`);
            const openInput = document.getElementById(`open-${day}`);
            const closeInput = document.getElementById(`close-${day}`);
            
            if (checkbox) {
                // Set initial state
                toggleDayHours(day);
            }
            
            // Ensure time inputs don't trigger any parent events
            if (openInput) {
                openInput.addEventListener('click', function(e) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                });
                openInput.addEventListener('focus', function(e) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    console.log('Open time input focused for:', day);
                });
                openInput.addEventListener('change', function(e) {
                    console.log('Open time changed for', day, 'to:', e.target.value);
                });
            }
            
            if (closeInput) {
                closeInput.addEventListener('click', function(e) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                });
                closeInput.addEventListener('focus', function(e) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    console.log('Close time input focused for:', day);
                });
                closeInput.addEventListener('change', function(e) {
                    console.log('Close time changed for', day, 'to:', e.target.value);
                });
            }
        });
        
        console.log('Store hours functionality initialized');
    });

    // Toggle store hours section based on enable checkbox
    document.getElementById('is_store_hours_enabled').addEventListener('change', function() {
        const storeHoursSection = document.getElementById('store-hours-section');
        if (this.checked) {
            storeHoursSection.style.display = 'block';
        } else {
            storeHoursSection.style.display = 'none';
        }
    });

    // Initialize store hours visibility on page load
    document.addEventListener('DOMContentLoaded', function() {
        const isEnabled = document.getElementById('is_store_hours_enabled').checked;
        const storeHoursSection = document.getElementById('store-hours-section');
        
        if (!isEnabled) {
            storeHoursSection.style.display = 'none';
        }
    });
</script>
@endpush
