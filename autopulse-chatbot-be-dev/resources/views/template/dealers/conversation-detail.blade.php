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
                <div class="rbt-dashboard-content px-0">
                    <div class="banner-area pb-0">
                        <!-- ChatenAI small Slider -->
                        <div class="settings-area mb-0">
                            <div class="d-flex justify-content-between align-items-center">
                                <h3 class="title">Conversation Detail</h3>
                                <div>
                                    <a href="{{ route('dealer.conversation') }}" class="btn btn-primary">
                                        <i class="fas fa-arrow-left"></i> Back to Conversations
                                    </a>
                                </div>
                            </div>
                        </div>

                        <!-- Success/Error Messages -->
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
                                <div class="chat-box-list pt--10">
                                    <div class="row g-0">
                                        <div class="col-lg-12 col-md-12 col-12">
                                            <div class="rainbow-accordion-style accordion conversation_accordion">
                                                <div class="accordion" id="conversationDetail">
                                                    <div class="accordion-item card bg-flashlight">
                                                        <h2 class="accordion-header card-header p-4" id="heading{{ $conversation['conversation_id'] }}">
                                                            <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#conversation{{ $conversation['conversation_id'] }}" aria-expanded="true" aria-controls="conversation{{ $conversation['conversation_id'] }}">
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
                                                                        <h6 class="title color-text-off mb--0 text-md-end">
                                                                            <span class="text_white">Timestamp:</span>&nbsp;{{ $conversation['request_timestamp'] }}
                                                                        </h6>
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        </h2>
                                                        <div id="conversation{{ $conversation['conversation_id'] }}" class="accordion-collapse collapse show" aria-labelledby="heading{{ $conversation['conversation_id'] }}" data-bs-parent="#conversationDetail">
                                                            <div class="accordion-body card-body p-4">
                                                                <div class="chat-section d-block">
                                                                    <div class="chat-content">
                                                                        <!-- Conversation Statistics -->
                                                                        <div class="row gx-2 mb-4">
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

                                                                        <!-- Booking Information -->
                                                                        @if(!empty($conversation['conversion_booking']))
                                                                            <div class="booking-section mb-4">
                                                                                <h5 class="text_white mb-3">Booking Information</h5>
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
                                                                            </div>
                                                                        @endif

                                                                        <!-- Main Conversation -->
                                                                        <div class="position-relative chat_history">
                                                                            <hr class="mt--15 mb--15">
                                                                            <h6 class="title"><span class="text_white">Question Asked:</span>&nbsp;{{ $conversation['query'] }}</h6>
                                                                            
                                                                            <!-- Additional Info Display -->
                                                                            @if($conversation['additional_info']['heading'])
                                                                                <h5 class="mb--5">{{ $conversation['additional_info']['heading'] }}</h5>
                                                                            @endif

                                                                            @if($conversation['additional_info']['subheading'])
                                                                                <h6 class="mb--15">{{ $conversation['additional_info']['subheading'] }}</h6>
                                                                            @endif

                                                                            @if($conversation['additional_info']['paragraphs'])
                                                                                @foreach ($conversation['additional_info']['paragraphs'] as $paragraph)
                                                                                    <p class="mb--5">{!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $paragraph) !!}</p>
                                                                                @endforeach
                                                                            @endif

                                                                            @if($conversation['additional_info']['listItems'])
                                                                                <ul>
                                                                                    @foreach ($conversation['additional_info']['listItems'] as $listItem)
                                                                                        <li>{!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $listItem) !!}</li>
                                                                                    @endforeach
                                                                                </ul>
                                                                            @endif

                                                                            <!-- Follow-up Conversations -->
                                                                            @if($conversation['follow_ups']->isNotEmpty())
                                                                                <div class="follow-ups-section mt-4">
                                                                                    <h5 class="text_white mb-3">Follow-up Conversations</h5>
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
                                                                                        <h6 class="mb--15">{!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $follow_up['additional_info']['subheading']) !!}</h6>
                                                                                        @endif

                                                                                        @if($follow_up['additional_info']['paragraphs'])
                                                                                            @foreach ($follow_up['additional_info']['paragraphs'] as $follow_up_paragraph)
                                                                                            <p class="mb--5">{!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $follow_up_paragraph) !!}</p>
                                                                                            @endforeach
                                                                                        @endif

                                                                                        @if($follow_up['additional_info']['listItems'])
                                                                                        <ul>
                                                                                            @foreach ($follow_up['additional_info']['listItems'] as $follow_up_listItem)
                                                                                                <li>{!! preg_replace('/\*\*(.*?)\*\*/', '<strong>$1</strong>', $follow_up_listItem) !!}</li>
                                                                                            @endforeach
                                                                                        </ul>
                                                                                        @endif
                                                                                    </div>
                                                                                    @endforeach
                                                                                </div>
                                                                            @endif
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
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</main>

<style>
.user-info {
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.info-item {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 3px;
}

.info-item i {
    width: 16px;
    text-align: center;
}

.booking-section {
    background-color: rgba(255, 255, 255, 0.05);
    padding: 20px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.follow-ups-section {
    background-color: rgba(255, 255, 255, 0.02);
    padding: 20px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.05);
}

.text_white {
    color: #ffffff !important;
}

@media (max-width: 768px) {
    .user-info {
        gap: 3px;
    }
    
    .info-item {
        font-size: 14px;
    }
}
</style>
@endsection
