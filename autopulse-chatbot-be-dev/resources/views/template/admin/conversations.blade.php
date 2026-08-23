@extends('layouts.admin')
@section('content')
@php  $today = date('Y-m-d'); @endphp
<style>
    .dataTable thead tr th {
        background-color: #f8f9fa !important;
        font-weight: 500;
    }
    .logs_tble .sm\:hidden{
        display: none !important;
    }
    .logs_tble svg{
        width: 22px;
    }
    .logs_tble nav.flex.items-center.justify-between .sm\:flex-1.sm\:flex.sm\:items-center.sm\:justify-between{
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    .logs_tble nav p{
        margin-bottom: 0;
    }
    .logs_tble nav div span a{
        display: inline-block;
        text-decoration: unset;
        color: #666;
    }
    .logs_tble nav div span a:hover, .logs_tble nav div span a:focus, .logs_tble nav div span span.cursor-default{
        color: var(--primary);
    }
    .logs_tble nav div span a.px-4, .logs_tble nav div span span.cursor-default{
        padding-left: 14px !important;
        padding-right: 14px !important;
    }

    @media (max-width: 991px){
        .logs_tble nav.flex.items-center.justify-between .sm\:flex-1.sm\:flex.sm\:items-center.sm\:justify-between{
            display: block;
            margin-top: 12px;
        }
        .logs_tble nav div span a {
    margin-bottom: 4px;
}
        .logs_tble nav p{
            margin-bottom: 12px;
        }
    }
</style>


<input type="hidden" id="seturl" value="">

<div class="position-relative">
    <div class="row">
        <div class="col col-xl-12 col-lg-12 col-md-12 col-12">
            <div class="page_title mb-3">
                <h2>Conversations</h2>
            </div>
        </div>
        <div class="col col-xl-12 col-lg-12 col-md-12 col-12">
            <div class="position-relative mb-3">
                <div class="row gx-1 justify-content-end">
                    <div class="col col-lg-12 col-md-12 col-12">
                        <form id="userFilter" method="GET" class="row gx-1">
                            <label class="col col-xxl-3 col-lg-2 col-md-4 col-12 d-flex align-items-center">
                                <select class="form-select w-100" name="dealersource" id="dealersource">
                                    <option value="">Select Dealer Group</option>
                                    @foreach($dealers as $key => $value)
                                        @if($value->dealership_url)
                                            <option value="{{ $value->dealership_url }}" 
                                                @if(Request::get('dealersource') == $value->dealership_url) 
                                                    selected 
                                                @endif
                                            >
                                                {{ $value->dealership_name }}
                                            </option>
                                        @endif
                                    @endforeach
                                </select>
                            </label>
                            <label class="col col-xxl-2 col-lg-3 col-md-4 col-12 d-flex align-items-center">
                                From:&nbsp;<input type="date" id="dealer-from" name="from" class="form-control form-control-sm me-md-1" max="{{ $today }}"  value="{{Request::get('from')}}">
                            </label>
                            <label class="col col-xxl-2 col-lg-2 col-md-4 col-12 d-flex align-items-center">
                                To:&nbsp;<input type="date" id="dealer-to" name="to" class="form-control form-control-sm"  max="{{ $today }}" value="{{ Request::get('to') ?? $today }}"> 
                            </label>
                            <div class="col col-lg-1 col-md-2 col-6">
                                <button type="submit" class="btn btn_theme w-100" value="Filter">Submit</button>
                            </div>
                            <div class="col col-lg-1 col-md-2 col-6">
                                <a href="{{ route('admin.log') }}" class="btn btn_theme w-100">Reset</a>
                            </div>
                            <div class="col col-lg-1 col-md-2 col-6">
                                <a id="exportLink" href="{{ route('dealer.conversionexport') }}" class="btn btn_dark w-100"><i class="fas fa-download me-2"></i>CSV</a>
                            </div>
                            <div class="col-lg-2 col-md-4 col-6 ms-auto">
                                <div class="form-group d-flex align-items-center">
                                    <select name="order_by_clicks" class="form-select"  onchange="document.getElementById('userFilter').submit();">
                                        <option value="" disabled selected>Sort By</option>
                                        <option value="followup_lead_desc" {{ request('order_by_clicks') == 'followup_lead_desc' ? 'selected' : '' }}>Conversation Count (Desc)</option>
                                        <option value="followup_lead_asc" {{ request('order_by_clicks') == 'followup_lead_asc' ? 'selected' : '' }}>Conversation Count (Asc)</option>
                                        <option value="clicks_visit_dealer_website_count_desc" {{ request('order_by_clicks') == 'clicks_visit_dealer_website_count_desc' ? 'selected' : '' }}>VDP Count (Desc)</option>
                                        <option value="clicks_visit_dealer_website_count_asc" {{ request('order_by_clicks') == 'clicks_visit_dealer_website_count_asc' ? 'selected' : '' }}>VDP Count (Asc)</option>
                                        <option value="clicks_view_vehicle_count_desc" {{ request('order_by_clicks') == 'clicks_view_vehicle_count_desc' ? 'selected' : '' }}>Lead Count (Desc)</option>
                                        <option value="clicks_view_vehicle_count_asc" {{ request('order_by_clicks') == 'clicks_view_vehicle_count_asc' ? 'selected' : '' }}>Lead Count (Asc)</option>
                                        <option value="clicks_vin_request_form_count_desc" {{ request('order_by_clicks') == 'clicks_vin_request_form_count_desc' ? 'selected' : '' }}>Vin Copied Count (Desc)</option>
                                        <option value="clicks_vin_request_form_count_asc" {{ request('order_by_clicks') == 'clicks_vin_request_form_count_asc' ? 'selected' : '' }}>Vin Copied Count (Asc)</option>
                                        <option value="clicks_explore_more_count_desc" {{ request('order_by_clicks') == 'clicks_explore_more_count_desc' ? 'selected' : '' }}>Explore More Count (Desc)</option>
                                        <option value="clicks_explore_more_count_asc" {{ request('order_by_clicks') == 'clicks_explore_more_count_asc' ? 'selected' : '' }}>Explore More Count (Asc)</option>
                                        <option value="vin_copy_count_desc" {{ request('order_by_clicks') == 'vin_copy_count_desc' ? 'selected' : '' }}>Visit Dealer Website Count (Desc)</option>
                                        <option value="vin_copy_count_asc" {{ request('order_by_clicks') == 'vin_copy_count_asc' ? 'selected' : '' }}>Visit Dealer Website Count (Asc)</option>
                                    </select>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
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

    <div class="conv_tab_box overflow-hidden">
        <div class="row">
            <div class="col col-12">
                <div class="position-relative table-responsive auto_datatable">
                    <div class="chat-box-list pt--10" id="chatContainer">
                        <div class="row g-0">
                            
                            <div class="col-lg-12 col-md-12 col-12">
                                <div class="rainbow-accordion-style accordion">
                                    <div class="accordion" id="accordionExamplea">
                                    <?php $idCounter = 1; ?>
                                        @foreach ($conversations as $conversation)
                                        <div class="accordion-item bg-flashlight mb-2">
                                            <h2 class="accordion-header card-header p-0" id="heading{{ $conversation['conversation_id'] }}-<?php echo $idCounter; ?>">
                                                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#id{{ $conversation['conversation_id'] }}-<?php echo $idCounter; ?>" aria-expanded="false" aria-controls="id{{ $conversation['conversation_id'] }}-<?php echo $idCounter; ?>">
                                                    <div class="row w-100 pe-3 gx-0 gy-md-0 gy-2">
                                                        <div class="col-md-6 col-12">
                                                            <h6 class="title mb-0">
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
                                                            <h6 class="title mb-0 text-md-end"><span class="text_white">Timestamp:</span>&nbsp;{{ $conversation['request_timestamp'] }}</h6>
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
                                                                    <p class="mb-2 mb-lg-1"><b class="text_white">Dealer Name:</b>&nbsp;{{ $conversation['dealership_name'] }}</p>
                                                                </div>
                                                                <div class="col-lg-4 col-md-6 col-12">
                                                                    <p class="mb-2 mb-lg-1"><b class="text_white">VDP Count:</b>&nbsp;{{ $conversation['clicks_view_vehicle_count'] }}</p>
                                                                </div>
                                                                <div class="col-lg-4 col-md-6 col-12">
                                                                    <p class="mb-2 mb-md-1"><b class="text_white">Explore More Count:</b>&nbsp;{{ $conversation['clicks_explore_more_count'] }}</p>
                                                                </div>
                                                                <div class="col-lg-4 col-md-6 col-12">
                                                                    <p class="mb-2 mb-md-1"><b class="text_white">Visit Dealer count:</b>&nbsp;{{ $conversation['clicks_visit_dealer_website_count'] }}</p>
                                                                </div>
                                                                <div class="col-lg-4 col-md-6 col-12">
                                                                    <p class="mb-2 mb-md-1"><b class="text_white">VIN Copied Count:</b>&nbsp;{{ $conversation['clicks_vin_copy_count'] }}</p>
                                                                </div>
                                                                <div class="col-lg-4 col-md-6 col-12">
                                                                    <p class="mb-2 mb-md-1"><b class="text_white">Req. Form Submitted Count:</b>&nbsp;{{ $conversation['clicks_vin_request_form_count'] }}</p>
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
                                                                <h6 class="conv_que"><span class="text_white">Question Asked:</span>&nbsp;{{ $conversation['query'] }}</h6>
                                                                
                                                                <!-- Additional Info Display -->
                                                                @if($conversation['additional_info']['heading'])
                                                                    <h5 class="mb-1">{{ $conversation['additional_info']['heading'] }}</h5>
                                                                @endif

                                                                    <!-- Loop through follow-up paragraphs -->
                                                                @if($conversation['additional_info']['subheading'])
                                                                    <h6 class="mb-3">{{ $conversation['additional_info']['subheading'] }}</h6>
                                                                @endif

                                                                <!-- Loop through follow-up paragraphs -->
                                                                @if($conversation['additional_info']['paragraphs'])
                                                                    @foreach ($conversation['additional_info']['paragraphs'] as $paragraph)
                                                                        
                                                                        <p class="mb-1"> {!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $paragraph) !!}</p>
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
                                                                        <h6 class="conv_que mb-1"><span class="text_white">Follow-up Question:</span>&nbsp;{{ $follow_up['query'] }}</h6>
                                                                        <p class="text-end mb-1"><small>{{ $follow_up['request_timestamp'] }}</small></p>

                                                                        <!-- Follow-up Additional Info -->
                                                                        @if($follow_up['additional_info']['heading'])
                                                                        <h5 class="mb-1">{!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $follow_up['additional_info']['heading']) !!}</h5>
                                                                        @endif

                                                                        @if($follow_up['additional_info']['subheading'])
                                                                        <h6 class="mb-3"> {!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $follow_up['additional_info']['subheading']) !!}</h6>
                                                                        @endif

                                                                        <!-- Loop through follow-up paragraphs -->
                                                                        @if($follow_up['additional_info']['paragraphs'])
                                                                            @foreach ($follow_up['additional_info']['paragraphs'] as $follow_up_paragraph)
                                                                            <p class="mb-1"> {!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $follow_up_paragraph) !!}</p>
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
@endsection

@section('script')
<script>
    document.addEventListener('DOMContentLoaded', function () {
       
        const exportLink = document.getElementById('exportLink');
        const dealersource = document.getElementById('dealersource');
        const fromDateInput = document.getElementById('dealer-from');
        const toDateInput = document.getElementById('dealer-to');

        // Function to update the export link URL with query parameters
        function updateExportLink() {
            let exportUrl = "{{ route('dealer.conversionexport') }}";
            const fromDate = fromDateInput.value;
            const toDate = toDateInput.value;
            const source = dealersource.value;

            // Check if from and to dates are filled, then append them to the URL
            if (fromDate || toDate || source) {
                exportUrl += '?exportadmin&';
                if (fromDate) {
                    exportUrl += `from=${fromDate}&`;
                }
                if (toDate) {
                    exportUrl +=  `to=${toDate}&`;
                }
                if (source) {
                    exportUrl +=  `dealersource=${source}&`;
                }
            }

            // Set the updated URL in the export link
            exportLink.href = exportUrl;
        }

        // Listen for changes on both date inputs and update the export link
        fromDateInput.addEventListener('change', updateExportLink);
        dealersource.addEventListener('change', updateExportLink);
        toDateInput.addEventListener('change', updateExportLink);

        // Update the export link on page load (in case there are already values in the inputs)
        updateExportLink();
    });
</script>
@endsection

