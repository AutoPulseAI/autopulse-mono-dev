@extends('layouts.dealer')
@php
    // Retrieve the source parameter from the query string
    $selectedSource = request()->query('source');
@endphp
@section('content')
<section class="account_main" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-3 col-12">
                @include('template.dealers.include.sidebar')
            </div>
            <div class="col col-lg-9 col-12">
                <!-- My Leads -->
                <div class="acc_right_main">
                    <div class="acc_page_head sticky" id="acc_page_head">
                        <div class="row align-items-center">
                            <div class="col col-md-3 col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    <div class="acc_page_heading">
                                        <h3>My Vehicle</h3>
                                    </div>
                                </div>
                            </div>
                            <div class="col col-md-9 col-12">
                                <form class="row gx-1 mt-2 mt-md-0">
                                    <div class="col col-md-3 col-12">
                                        <select class="form-select mb-md-0 mb-1" id="source" name="source" >
                                            <option>All Stores</option>
                                            @foreach($storeList as $key =>$value)
                                            <option value="{{ $value->source }}" {{ request('source') == $value->source ? 'selected' : '' }}>{{ $value->dealership_name }}</option>
                                            @endforeach
                                        </select>
                                    </div>
                                    <div class="col col-md-3 col-12">
                                        <div class="acc_page_search mt-0">
                                        <input type="text" value="{{ $input['search'] ??'' }}" name="search" id="searchInput" class="form-control mb-md-0 mb-1" placeholder="Search">
                                        </div>
                                    </div>
                                    <div class="col col-md-2 col-6">
                                        <select class="form-select mb-0" id="keywordSelect" name="keywordterm" >
                                        <option  value="make" @if(isset($input['keywordterm']) && $input['keywordterm'] =='make') selected @endif >Brand</option>
                                            <option value="model " @if(isset($input['keywordterm']) && $input['keywordterm'] =='model') selected @endif>Model</option>
                                            <option value="trim"  @if(isset($input['keywordterm']) && $input['keywordterm'] =='trim') selected @endif>Trim</option>
                                            <option value="year"  @if(isset($input['keywordterm']) && $input['keywordterm'] =='year') selected @endif>Year</option>
                                        </select>
                                    </div>
                                    <!--div class="col col-md-3 col-6">
                                       <input type="date"  name="date"  class="form-control mb-md-0 mb-1">
                                    </div-->
                                    <div class="col col-md-2 col-3">
                                        <button type="submit" class="btn btn_theme w-100" >Search</button>
                                    </div>
                                    <div class="col col-md-2 col-3">
                                        <a href="{{ route('dealer.myvehicle') }}" class="btn btn_theme w-100" >Reset</a>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                    
                    <div class="acc_page_content acc_page_box bg_yellow">                        
                        <div class="position-relative">
                                @if ($paginator->isEmpty())
                                    <div class="no_cars_available py-5 bg-white">
                                        <p class="mb-0"><span>No Cars Available</span></p>
                                    </div>
                                @else
                                    @foreach ($paginator->items() as $key => $item)
                                    <div class="recommended_list_card dealer_vehicles bg-white">
                                        <div class="car_card dealer_details_card">
                                            <div class="car_card_main">
                                                <div class="car_card_img">          
                                                    <a data-bs-toggle="modal" onclick='viewCar("{{ $item['vin'] }}")' data-bs-target="#carDetailsModal">
                                                        <img src="{{ $item['media']['photo_links'][0] ??''}}" alt="Car Image">
                                                    </a>
                                                </div>
                                                <div class="car_card_info">
                                                    <div class="car_title_price">
                                                        <a data-bs-toggle="modal" onclick='viewCar("{{ $item['vin'] }}")' data-bs-target="#carDetailsModal" class="d-block">
                                                            <h4>{{ $item['build']['make'] ??'' }} {{ $item['build']['model']??'' }}</h4>
                                                            <div class="car_spec">
                                                                <div class="car_spec_info">
                                                                    <span>{{ $item['build']['year'] ?? ''}}</span>&nbsp;|&nbsp;<span>{{ $item['build']['fuel_type'] ??''}}</span>&nbsp;|&nbsp;<span>{{ $item['build']['transmission'] ??''}}</span>
                                                                </div>
                                                            </div>   
                                                        </a>
                                                        <div class="price_leads">
                                                            @if(isset($item['price']))
                                                                <h5>${{ number_format($item['price']) }}</h5>
                                                            @else
                                                                <h5>N/A</h5>
                                                            @endif
                                                            <p><i class="fa-regular fa-phone me-1"></i><span>Total Call : </span><strong>{{$storedcallvehiclecount[$item['vin']] ?? 0}}</strong></p>
                                                            <p><i class="fa-regular fa-eye me-1"></i><span>Total Leads : </span><strong>{{$storedvehiclecount[$item['vin']] ?? 0}}</strong></p>
                                                            <p><i class="fa-regular fa-hand-pointer me-1"></i><span>Total Visit : </span><strong>{{$visitvehicleCount[$item['vin']] ?? 0}}</strong></p> 
                                                            <p><i class="fa-regular fa-envelope me-1"></i><span>Total Sms : </span><strong>{{$storedsmsvehiclecount[$item['vin']] ?? 0}}</strong></p> 
                                                        </div>                                             
                                                    </div>
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