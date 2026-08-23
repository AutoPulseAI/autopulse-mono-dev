@extends('layouts.admin')
 
@section('content')
<div class="position-relative min-h-100 main_bg min_h_100">
    
    <div class="container-xxl container-fluid">
        <div class="broadcasts_section mx-md-3">
            <div class="row">
                <div class="col col-12">
                    <!-- Page Heading -->
                    <div class="broadcasts_head mb-3">
                        <div class="page_title">
                            <h2>Dashboard</h2>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row g-xl-3 g-2 mb-4">
                <!-- Total Dealer Registered -->
                <div class="col col-lg-3 col-md-6 col-12">
                    <div class="position-relative">
                        <a href="{{ route('dealerlist.index') }}" class="dash_card_bg">
                            <div class="dash_card gradient_bg">
                                <div class="dash_content">
                                    <p>Registered Stores</p>
                                    <h2 class="mb-0">{{ $dealer }}</h2>
                                </div>
                            </div>                          
                        </a>
                    </div>
                </div>
                <!--div class="col col-lg-3 col-md-6 col-12 mb-3">
                    <div class="position-relative dash_card">
                        <a href="{{ route('dealerlist.index') }}" class="dash_card_bg">
                            <div class="position-relative dash_content shadow-sm rounded p-3 p-lg-2 p-xl-2 py-xl-3">
                                <p><i class="fa-solid fa-sack-xmark me-2"></i>Free Trial Stores</p>
                                <h2 class="mb-0">{{ $dealer }}</h2>
                            </div>                          
                        </a>
                    </div>
                </div-->
                <div class="col col-lg-3 col-md-6 col-12">
                    <div class="position-relative">
                        <a href="{{ route('dealerlist.index') }}" class="dash_card_bg">
                            <div class="dash_card gradient_bg">
                                <div class="dash_content">
                                    <p>Subscribed Stores</p>
                                    <h2 class="mb-0">{{ $dealer }}</h2> 
                                </div>                          
                            </div>                          
                        </a>
                    </div>
                </div>
                <div class="col col-lg-3 col-md-6 col-12">
                    <div class="position-relative">
                        <a href="{{ route('lead.index') }}" class="dash_card_bg">
                            <div class="dash_card gradient_bg">
                                <div class="dash_content">
                                    <p>Lead Count</p>
                                    <h2 class="mb-0">{{ $lead }}</h2> 
                                </div>                          
                            </div>                          
                        </a>
                    </div>
                </div>
                <div class="col col-lg-3 col-md-6 col-12">
                    <div class="position-relative">
                        <a href="{{ route('admin.log') }}" class="dash_card_bg">
                            <div class="dash_card gradient_bg">
                                <div class="dash_content">
                                    <p>Conversation Count</p>
                                    <h2 class="mb-0">{{ $conversation_count }}</h2> 
                                </div>                          
                            </div>                          
                        </a>
                    </div>
                </div>
                <div class="col col-lg-3 col-md-6 col-12">
                    <div class="position-relative">
                        <a href="{{ route('admin.log') }}" class="dash_card_bg">
                            <div class="dash_card gradient_bg">
                                <div class="dash_content">
                                    <p>VDP Count</p>
                                    <h2 class="mb-0">{{ $view_vehicle_count }}</h2> 
                                </div>                          
                            </div>                          
                        </a>
                    </div>
                </div>
                <div class="col col-lg-3 col-md-6 col-12">
                    <div class="position-relative">
                        <a href="{{ route('admin.log') }}" class="dash_card_bg">
                            <div class="dash_card gradient_bg">
                                <div class="dash_content">
                                    <p>Vin Copied Count</p>
                                    <h2 class="mb-0">{{ $vin_copy_count }}</h2> 
                                </div>                          
                            </div>                          
                        </a>
                    </div>
                </div>
                <div class="col col-lg-3 col-md-6 col-12">
                    <div class="position-relative">
                        <a href="{{ route('admin.log') }}" class="dash_card_bg">
                            <div class="dash_card gradient_bg">
                                <div class="dash_content">
                                    <p>Explore More Count</p>
                                    <h2 class="mb-0">{{ $explore_more_count }}</h2> 
                                </div>                          
                            </div>                          
                        </a>
                    </div>
                </div>
                <div class="col col-lg-3 col-md-6 col-12">
                    <div class="position-relative">
                        <a href="{{ route('admin.log') }}" class="dash_card_bg">
                            <div class="dash_card gradient_bg">
                                <div class="dash_content">
                                    <p>Visit Dealer Website Count</p>
                                    <h2 class="mb-0">{{ $visit_dealer_website_count }}</h2> 
                                </div>                          
                            </div>                          
                        </a>
                    </div>
                </div>

                <div class="col col-lg-12 col-md-12 col-12">
                    <div class="position-relative">
                        <a href="{{ route('admin.log') }}" class="dash_card_bg">
                            <div class="dash_card gradient_bg">
                                <div class="dash_content">
                                    <p>Total Session time</p>
                                    <h2 class="mb-0">{{ \Carbon\CarbonInterval::seconds($totalSessionTime)->cascade()->forHumans() }} </h2> 
                                </div>                          
                            </div>                          
                        </a>
                    </div>
                </div>
                <!-- <div class="col col-lg-3 col-md-6 col-12 mb-3">
                    <div class="position-relative dash_card">
                        <a href="{{ route('lead.index') }}" class="dash_card_bg">
                            <div class="position-relative dash_content bg-white shadow-sm rounded p-3 p-lg-2 p-xl-2 py-xl-3">
                                <p><i class="fa-solid fa-chart-line me-2"></i>Total Lead<span class="cursor-pointer ms-auto" tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="lorem ipsum"><i class="fa-solid fa-circle-info"></i></span></p>
                                <h2 class="mb-0">{{ $lead }}</h2>
                            </div>                          
                        </a>
                    </div>
                </div> -->
                
            </div>

            <!-- Total Patient Record -->
            
        </div>
    </div>
    
</div>
@endsection

@push ('after-scripts')

@endpush
