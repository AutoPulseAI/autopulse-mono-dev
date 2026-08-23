@extends('layouts.dealer')
 
@section('content')
<section class="account_main" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-3 col-12">
                @include('template.dealers.include.sidebar')
            </div>
            <div class="col col-lg-9 col-12">
                <!-- My Leads -->
                <div class="acc_right_main dealer_account">
                    <div class="acc_page_head sticky" id="acc_page_head">
                        <div class="row align-items-center">
                            <div class="col col-lg-2 col-md-3 col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    <div class="acc_page_heading">
                                        <h3>My Leads</h3>
                                    </div>
                                </div>
                            </div>
                            <div class="col col-lg-10 col-md-9 col-12">
                                <form class="row gx-1 mt-2 mt-md-0">
                                        <!--<div class="col col-md-3 col-12">
                                            <div class="acc_page_search">
                                                <input type="text" value="{{ $input['search'] ??'' }}" name="search" id="searchInput" class="form-control mb-md-0 mb-1" placeholder="Search">
                                            </div>
                                        </div>-->
                                        <div class="col col-md-2 col-12">
                                            <select class="form-select mb-md-0 mb-1" id="source" name="source" >
                                                <option>All Stores</option>

                                                @foreach($storeList as $key =>$value)
                                                <option value="{{ $value->source }}" {{ request('source') == $value->source ? 'selected' : '' }}>{{ $value->dealership_name }}</option>
                                                @endforeach

                                            
                                            </select>
                                        </div>
                                        <div class="col col-md-3 col-6">
                                            <input type="text" id="start_date" name="start_date" class="form-control mb-md-0 mb-1" placeholder="Start Date" onfocus="(this.type='date')" onblur="(this.type='text')" value="{{ request('start_date') }}">
                                        </div>
                                        <div class="col col-md-3 col-6">
                                            <input type="text" id="end_date" name="end_date" class="form-control mb-md-0 mb-1" placeholder="End Date" onfocus="(this.type='date')" onblur="(this.type='text')" value="{{ request('end_date') }}">
                                        </div>
                                        <div class="col col-md-2 col-6">
                                            <button type="submit" class="btn btn_theme w-100">Search</button>
                                        </div>
                                        <div class="col col-md-2 col-6">
                                            <a href="{{ route('dealer.mylead') }}" class="btn btn_theme w-100">Reset</a>
                                        </div>
                                </form>

                            </div>
                        </div>
                    </div>
                    
                    <div class="acc_page_content acc_page_box">                        
                        <div class="position-relative">
                                {{-- 
                                @if ($subscription )
                                    @if($subscription->canceled())
                                        <div class="no_cars_available py-5">
                                            <p class="mb-0"><span>Although you have canceled your subscription, you will continue to have access to leads until  {{ $subscription->ends_at->format('F j, Y') }} please resume the plan <a href="{{ route('dealer.subscription') }}">Click Here</a></span></p>
                                        </div>
                                    @endif
                                @else
                                    <div class="no_cars_available py-5">
                                        <p class="mb-0"><span>With your free plan, you can only view your first 5 leads. Please subscribe now to access unlimited leads. <a href="{{ route('dealer.subscription') }}">Click Here</a></span></p>
                                    </div>
                                @endif
                                --}}
                                @if ($paginator->isEmpty())
                                    <div class="no_cars_available py-5">
                                        <p class="mb-0"><span>No Cars Available</span></p>
                                    </div>
                                @else
                              
                                @foreach ($paginator->items() as $key => $row)
                                    @php
                                      
                                        $item = $row->additional_data ?? [];
                                    @endphp
                                        <div class="dealer_lead_card">
                                            <div class="row gx-1">
                                                <div class="col col-md-5 col-12">
                                                    <div class="car_card dealer_details_card">
                                                        <a href="javascript:;"onclick='viewCar("{{ $row['vin'] }}")' class="car_card_main">
                                                            <div class="car_card_img">          
                                                                <img src="{{ $item['media']['photo_links'][0]??'' }}" alt="Car Image">
                                                            </div>
                                                            <div class="car_card_info">
                                                                <div class="car_title_price">
                                                                <h4>{{ $item['build']['make'] ??'' }} {{ $item['build']['model']??'' }} </h4>
                                                                    <div class="car_spec mb-0">
                                                                        <div class="car_spec_info">
                                                                            <span>VIN: {{ $item['vin'] ?? ''}}</span>
                                                                        </div>
                                                                    </div>                
                                                                </div>
                                                            </div>
                                                        </a>
                                                    </div>
                                                </div>
                                                <div class="col col-md-4 col-6">
                                                    <div class="leads_by">
                                                        <p class="mb-0"><i class="fa-solid fa-user me-2"></i><span>{{ $row->user['name']}} {{ $row->user['last_name']}}</span><small class="text_secondary ms-1">{{ $row->created_at->diffForHumans() }}</small></p>
                                                    </div>
                                                </div>
                                                <div class="col col-md-3 col-6">
                                                    <div class="d-flex align-items-center">
                                                        <a href="javascript:;" onclick="viewCustomer('{{$row['id']}}')"  class="text_primary ms-auto"><small>View Customer Details<i class="fa-solid fa-angle-right ms-2"></i></small></a>
                                                    </div>
                                                </div>
                                            </div>                            
                                        </div>
                                    @endforeach
                                @endif

                                
                                      
                        </div>
                    </div>
                    <div class="position-relative pagination_main">
                        {{ $paginator->links('pagination::bootstrap-4') }}
                    
                    </div>
                </div>

            </div>
        </div>
    </div>
</section>


@endsection
@push ('after-scripts')
<script>
    function validateDates() {
        const startDate = document.getElementById('start_date').value;
        const endDate = document.getElementById('end_date').value;

        if (startDate && endDate) {
            if (new Date(startDate) > new Date(endDate)) {
                alert('End Date must be greater than Start Date');
                return false;
            }
        }
        return true;
    }

    document.getElementById('start_date').addEventListener('change', function () {
        const startDate = this.value;
        const endDateInput = document.getElementById('end_date');
        endDateInput.min = startDate;
    });

    document.getElementById('end_date').addEventListener('change', function () {
        const endDate = this.value;
        const startDateInput = document.getElementById('start_date');
        startDateInput.max = endDate;
    });
</script>
@endpush