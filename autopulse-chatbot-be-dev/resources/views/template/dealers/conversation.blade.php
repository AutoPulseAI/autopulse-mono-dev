@extends('layouts.front')

@section('content')
@php
    $today = date('Y-m-d');
@endphp
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
                <div class="rbt-dashboard-content px-0">
                    <div class="banner-area pb-0">
                        <!-- ChatenAI small Slider -->
                        <div class="settings-area mb-0">
                            <h3 class="title">Conversation</h3>
                        </div>

                        <!-- Filter -->
                        <div class="rbt-dashboard-content">
                            <div class="row justify-content-center">
                                <div class="col-lg-12 col-md-12 col-12">
                                    <form id="convFilter" method="GET" class="rbt-profile-row rbt-default-form row gx-2">
                                        <div class="col-lg-3 col-md-3 col-12">
                                            <div class="form-group d-lg-flex align-items-center mb-3">
                                                <span>From:</span>&nbsp;
                                                <input type="date" id="dealer-from" name="from" class="ms-auto ms-md-1" 
                                                    max="{{ $today }}" value="{{ Request::get('from') }}">
                                            </div>
                                        </div>
                                        <div class="col-lg-3 col-md-3 col-12">
                                            <div class="form-group d-lg-flex align-items-center mb-3">
                                                <span>To:</span>&nbsp;
                                                <input type="date" id="dealer-to" name="to" class="ms-auto ms-md-1" 
                                                    max="{{ $today }}" value="{{ Request::get('to') ?? $today }}"> 
                                            </div>
                                        </div>
                                        
                                        <div class="col col-lg-1 col-md-1 col-4 d-flex align-items-end">
                                            <button type="submit" class="btn-default btn-border w-100 mb-3" value="Filter"><i class="fa-solid fa-magnifying-glass"></i></button>
                                        </div>
                                        <div class="col col-lg-1 col-md-1 col-4 d-flex align-items-end">
                                            <a href="{{ route('dealer.conversation') }}" class="react-btn btn-default btn-border w-100 mb-3"><i class="fa-solid fa-arrow-rotate-right"></i></a>
                                        </div>
                                        <div class="col col-lg-1 col-md-1 col-4 d-flex align-items-end">
                                            <a id="exportLink" href="{{ route('dealer.conversionexport') }}" class="react-btn btn-default btn-border w-100 mb-3"><i class="fa-solid fa-download"></i></a>
                                        </div>

                                        <div class="col col-lg-3 col-md-3 col-12 d-flex align-items-end">
                                            <div class="form-group d-lg-flex align-items-center mb-3">
                                                <select name="order_by_clicks" id="order_by_clicks" class=""  onchange="document.getElementById('convFilter').submit();">
                                                    <option value="" disabled selected>Sort By</option>
                                                    <option value="followup_lead_desc" {{ request('order_by_clicks') == 'followup_lead_desc' ? 'selected' : '' }}>Conversation Count (Desc)</option>
                                                    <option value="followup_lead_asc" {{ request('order_by_clicks') == 'followup_lead_asc' ? 'selected' : '' }}>Conversation Count (Asc)</option>
                                                    <option value="clicks_visit_dealer_website_count_desc" {{ request('order_by_clicks') == 'clicks_visit_dealer_website_count_desc' ? 'selected' : '' }}>Visit Dealer Website Count (Desc) </option>
                                                    <option value="clicks_visit_dealer_website_count_asc" {{ request('order_by_clicks') == 'clicks_visit_dealer_website_count_asc' ? 'selected' : '' }}>Visit Dealer Website Count VDP Count (Asc)</option>
                                                    <option value="clicks_view_vehicle_count_desc" {{ request('order_by_clicks') == 'clicks_view_vehicle_count_desc' ? 'selected' : '' }}>VDP Count  Lead Count (Desc)</option>
                                                    <option value="clicks_view_vehicle_count_asc" {{ request('order_by_clicks') == 'clicks_view_vehicle_count_asc' ? 'selected' : '' }}>VDP Count   (Asc)</option>
                                                    <option value="clicks_vin_request_form_count_desc" {{ request('order_by_clicks') == 'clicks_vin_request_form_count_desc' ? 'selected' : '' }}>Lead Count (Desc)</option>
                                                    <option value="clicks_vin_request_form_count_asc" {{ request('order_by_clicks') == 'clicks_vin_request_form_count_asc' ? 'selected' : '' }}>Lead Count (Asc)</option>
                                                    <option value="clicks_explore_more_count_desc" {{ request('order_by_clicks') == 'clicks_explore_more_count_desc' ? 'selected' : '' }}>Explore More Count (Desc)</option>
                                                    <option value="clicks_explore_more_count_asc" {{ request('order_by_clicks') == 'clicks_explore_more_count_asc' ? 'selected' : '' }}>Explore More Count (Asc)</option>
                                                    <option value="vin_copy_count_desc" {{ request('order_by_clicks') == 'vin_copy_count_desc' ? 'selected' : '' }}>Vin Copied Count (Desc)</option>
                                                    <option value="vin_copy_count_asc" {{ request('order_by_clicks') == 'vin_copy_count_asc' ? 'selected' : '' }}>Vin Copied Count (Asc)</option>
                                                </select>
                                            </div>
                                        </div>

                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="content-page">
                        

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

                        <!-- Dashboard Center Content -->
                        <div class="rbt-dashboard-content">
                            <div class="content-page">

                                <div class="chat-box-list pt--10" id="chatContainer">
                                    <div class="row g-0">
                                        
                                        <div class="col-lg-12 col-md-12 col-12">
                                            <div class="rainbow-accordion-style accordion conversation_accordion">
                                                <div class="accordion" id="accordionExamplea">
                                                <?php $idCounter = 1; ?>
                                                    @foreach ($conversations as $conversation)
                                                    <div class="accordion-item card bg-flashlight">
                                                        <h2 class="accordion-header card-header p-4" id="heading{{ $conversation['conversation_id'] }}-<?php echo $idCounter; ?>">
                                                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#id{{ $conversation['conversation_id'] }}-<?php echo $idCounter; ?>" aria-expanded="false" aria-controls="id{{ $conversation['conversation_id'] }}-<?php echo $idCounter; ?>">
                                                                <div class="row w-100 pe-3 gx-0 gy-md-0 gy-2">
                                                                    <div class="col-md-6 col-12">
                                                                        <h6 class="title color-text-off mb--0">
                                                                            @if($conversation['user'])
                                                                                <div class="user-info">
                                                                                    @if($conversation['user']['email'] ?? false)
                                                                                        <span class="info-item">
                                                                                            <i class="fas fa-envelope text_white"></i>
                                                                                            <span>{{ $conversation['user']['email'] }}</span>
                                                                                        </span>
                                                                                    @endif
                                                                                    
                                                                                    @if($conversation['user']['phone_number'] ?? false)
                                                                                        <span class="info-item">
                                                                                            <i class="fas fa-phone-alt text_white"></i>
                                                                                            <span>{{ $conversation['user']['phone_number'] }}</span>
                                                                                        </span>
                                                                                    @endif
                                                                                    
                                                                                    @if($conversation['user']['name'] ?? false)
                                                                                        <span class="info-item">
                                                                                            <i class="fas fa-user text_white"></i>
                                                                                            <span>{{ $conversation['user']['name'] }}</span>
                                                                                        </span>
                                                                                    @endif
                                                                                </div>
                                                                            @else
                                                                                <span class="info-item">
                                                                                    <i class="fas fa-id-card text_white"></i>
                                                                                    <span>ID: {{ $conversation['conversation_id'] }}</span>
                                                                                </span>
                                                                            @endif
                                                                    
                                                                    </h6>
                                                                    </div>
                                                                    <div class="col-md-6 col-12">
                                                                        <h6 class="title color-text-off mb--0 text-md-end"><span class="text_white">Timestamp:</span>&nbsp;{{ $conversation['request_timestamp'] }}</h6>
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        </h2>
                                                        <div id="id{{ $conversation['conversation_id'] }}-<?php echo $idCounter; ?>" class="accordion-collapse collapse" aria-labelledby="heading{{ $conversation['conversation_id'] }}-<?php echo $idCounter; ?>" data-bs-parent="#accordionExamplea">
                                                            <div class="accordion-body card-body p-4">
                                                                <div class="chat-section d-block">
                                                                    <div class="chat-content">
                                                                        <div class="row gx-2">
                                                                            <div class="col-lg-12 col-md-6 col-12">
                                                                                <p class="mb-2 mb-lg-0"><span class="text_white">Dealer Name:</span>&nbsp;{{ $conversation['dealership_name'] }}</p>
                                                                            </div>
                                                                            <div class="col-lg-4 col-md-6 col-12">
                                                                                <p class="mb-2 mb-lg-0"><span class="text_white">VDP Count:</span>&nbsp;{{ $conversation['clicks_view_vehicle_count'] }}</p>
                                                                            </div>
                                                                            <div class="col-lg-4 col-md-6 col-12">
                                                                                <p class="mb-2 mb-md-0"><span class="text_white">Explore More Count:</span>&nbsp;{{ $conversation['clicks_explore_more_count'] }}</p>
                                                                            </div>
                                                                            <div class="col-lg-4 col-md-6 col-12">
                                                                                <p class="mb-2 mb-md-0"><span class="text_white">Visit Dealer Count:</span>&nbsp;{{ $conversation['clicks_visit_dealer_website_count'] }}</p>
                                                                            </div>
                                                                            <div class="col-lg-4 col-md-6 col-12">
                                                                                <p class="mb-2 mb-md-0"><span class="text_white">VIN Copied Count:</span>&nbsp;{{ $conversation['clicks_vin_copy_count'] }}</p>
                                                                            </div>
                                                                            <div class="col-lg-4 col-md-6 col-12">
                                                                                <p class="mb-2 mb-md-0"><span class="text_white">Req. Form Submitted Count:</span>&nbsp;{{ $conversation['clicks_vin_request_form_count'] }}</p>
                                                                            </div>
                                                                            <div class="col-lg-4 col-md-6 col-12">
                                                                                <p class="mb-2 mb-md-0"><span class="text_white">Session Time:</span>&nbsp;{{ \Carbon\CarbonInterval::seconds($conversation['session_timing'])->cascade()->forHumans() }}</p>
                                                                            </div>
                                                                        </div>
                                                                        @if(!empty($conversation['conversion_booking']))
                                                                            @foreach( $conversation['conversion_booking'] as $row)
                                                                            <div class="row gx-2">
                                                                                <div class="col-lg-4 col-md-6 col-12">
                                                                                    <p class="mb-2 mb-lg-1"><b class="text_white">User Name:</b>&nbsp;{{ $row['name'] }}</p>
                                                                                </div>
                                                                                <div class="col-lg-4 col-md-6 col-12">
                                                                                    <p class="mb-2 mb-lg-1"><b class="text_white">User Email:</b>&nbsp;{{ $row['email'] }}</p>
                                                                                </div>
                                                                                <div class="col-lg-4 col-md-6 col-12">
                                                                                    <p class="mb-2 mb-lg-1"><b class="text_white">User Phone:</b>&nbsp;{{ $row['phone'] }}</p>
                                                                                </div>
                                                                                <div class="col-lg-4 col-md-6 col-12">
                                                                                    <p class="mb-2 mb-md-1"><b class="text_white">Booking Date:</b>&nbsp;{{ $row['booking_date'] }}</p>
                                                                                </div>
                                                                                <div class="col-lg-4 col-md-6 col-12">
                                                                                    <p class="mb-2 mb-md-1"><b class="text_white">Booking Time:</b>&nbsp;{{ date('h:i A', strtotime($row['booking_time'])) }}</p>
                                                                                </div>
                                                                            
                                                                            </div>
                                                                            @endforeach
                                                                        @endif
                                                                        <!-- Conversation loop start here -->
                                                                        <div class="position-relative chat_history">
                                                                            <hr class="mt--15 mb--15">
                                                                            <h6 class="title"><span class="text_white">Question Asked:</span>&nbsp;{{ $conversation['query'] }}</h6>
                                                                            
                                                                            <!-- Additional Info Display -->
                                                                            @if($conversation['additional_info']['heading'])
                                                                                <h5 class="mb--5">{{ $conversation['additional_info']['heading'] }}</h5>
                                                                            @endif

                                                                             <!-- Loop through follow-up paragraphs -->
                                                                            @if($conversation['additional_info']['subheading'])
                                                                                <h6 class="mb--15">{{ $conversation['additional_info']['subheading'] }}</h6>
                                                                            @endif

                                                                            <!-- Loop through follow-up paragraphs -->
                                                                            @if($conversation['additional_info']['paragraphs'])
                                                                                @foreach ($conversation['additional_info']['paragraphs'] as $paragraph)
                                                                                  
                                                                                    <p class="mb--5"> {!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $paragraph) !!}</p>
                                                                                @endforeach
                                                                             @endif

                                                                            <!-- Loop through follow-up paragraphs -->
                                                                            @if($conversation['additional_info']['listItems'])
                                                                                <ul>
                                                                                    @foreach ($conversation['additional_info']['listItems'] as $listItem)
                                                                                        <li>{!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $listItem) !!}</li>
                                                                                        
                                                                                    @endforeach
                                                                                </ul>
                                                                            @endif

                                                                            
                                                                            <!-- Child Conversations (Follow-ups) Start -->
                                                                            @if($conversation['follow_ups']->isNotEmpty())
                                                                                @foreach ($conversation['follow_ups'] as $follow_up)
                                                                                <hr class="mt--10 mb--10">                                                                                
                                                                                <div class="mt--20">
                                                                                    <h6 class="title mb-1"><span class="text_white">Follow-up Question:</span>&nbsp;{{ $follow_up['query'] }}</h6>
                                                                                    <p class="text-end mb--5"><small>{{ $follow_up['request_timestamp'] }}</small></p>

                                                                                    <!-- Follow-up Additional Info -->
                                                                                    @if($follow_up['additional_info']['heading'])
                                                                                    <h5 class="mb--5">{!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $follow_up['additional_info']['heading']) !!}</h5>
                                                                                    @endif

                                                                                    @if($follow_up['additional_info']['subheading'])
                                                                                    <h6 class="mb--15"> {!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $follow_up['additional_info']['subheading']) !!}</h6>
                                                                                    @endif

                                                                                    <!-- Loop through follow-up paragraphs -->
                                                                                    @if($follow_up['additional_info']['paragraphs'])
                                                                                        @foreach ($follow_up['additional_info']['paragraphs'] as $follow_up_paragraph)
                                                                                        <p class="mb--5"> {!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $follow_up_paragraph) !!}</p>
                                                                                        @endforeach
                                                                                    @endif

                                                                                    <!-- Loop through follow-up list -->
                                                                                    @if($follow_up['additional_info']['listItems'])
                                                                                    <ul>
                                                                                        @foreach ($follow_up['additional_info']['listItems'] as $follow_up_listItem)
                                                                                            <li>{!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $follow_up_listItem) !!}</li>
                                                                                        @endforeach
                                                                                    </ul>
                                                                                    @endif
                                                                                </div>
                                                                                @endforeach
                                                                            @endif
                                                                            <!-- Child Conversations (Follow-ups) End -->
                                                                        </div>
                                                                        <!-- Conversation loop end here -->
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <?php $idCounter++; ?>
                                                    @endforeach
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                </div>
                                <div class="convpage">
                                {{ $pagination->onEachSide(1)->links('pagination::bootstrap-5') }}
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
    document.addEventListener('DOMContentLoaded', function () {
        const exportLink = document.getElementById('exportLink');
        const fromDateInput = document.getElementById('dealer-from');
        const toDateInput = document.getElementById('dealer-to');

        // Function to update the export link URL with query parameters
        function updateExportLink() {
            let exportUrl = "{{ route('dealer.conversionexport') }}";
            const fromDate = fromDateInput.value;
            const toDate = toDateInput.value;

            // Check if from and to dates are filled, then append them to the URL
            if (fromDate || toDate) {
                exportUrl += '?';
                if (fromDate) {
                    exportUrl += `from=${fromDate}`;
                }
                if (toDate) {
                    exportUrl += fromDate ? `&to=${toDate}` : `to=${toDate}`;
                }
            }

            // Set the updated URL in the export link
            exportLink.href = exportUrl;
        }

        // Listen for changes on both date inputs and update the export link
        fromDateInput.addEventListener('change', updateExportLink);
        toDateInput.addEventListener('change', updateExportLink);

        // Update the export link on page load (in case there are already values in the inputs)
        updateExportLink();
    });
</script>
@endpush
