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
                            <div class="col col-md-4 col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    <div class="acc_page_heading">
                                        <h3>My Vehicles</h3>
                                    </div>
                                </div>
                            </div>
                            <div class="col col-md-8 col-12">
                                <form class="row gx-1">
                                    <div class="col col-md-4 col-12">
                                        <div class="acc_page_search">
                                            <input type="text" value="{{ $input['search'] ??'' }}" name="search" id="searchInput" class="form-control mb-md-0 mb-1" placeholder="Search">
                                        </div>
                                    </div>
                                    <div class="col col-md-2 col-6">
                                        <select class="form-select mb-0" id="keywordSelect" name="keywordterm" >
                                            <option selected value="make" @if(isset($input['keywordterm']) && $input['keywordterm'] =='make') 'selected' @endif >Brand</option>
                                            <option value="model " @if(isset($input['keywordterm']) && $input['keywordterm'] =='model') 'selected' @endif>Model</option>
                                            <option value="trim"  @if(isset($input['keywordterm']) && $input['keywordterm'] =='trim') 'selected' @endif>Trim</option>
                                            <option value="year"  @if(isset($input['keywordterm']) && $input['keywordterm'] =='year') 'selected' @endif>Year</option>
                                        </select>
                                    </div>
                                    <div class="col col-md-3 col-6">
                                       <input type="date"  name="date"  class="form-control mb-md-0 mb-1">
                                    </div>
                                    <div class="col col-md-2 col-6">
                                        <button type="submit" class="btn btn_theme w-100" >Search</button>
                                    </div>
                                    <div class="col col-md-2 col-6">
                                        <a href="{{ route('dealer.myvehicle') }}" class="btn btn_theme w-100" >Reset</a>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                    
                    <div class="acc_page_content acc_page_box">                        
                        <div class="position-relative">
                                @if ($paginator->isEmpty())
                                    <div class="no_cars_available py-5">
                                        <p class="mb-0"><span>No Cars Available</span></p>
                                    </div>
                                @else
                                    @foreach ($paginator->items() as $key => $item)

                                    
                                    <div class="recommended_list_card dealer_vehicles">
                                        <div class="car_card dealer_details_card">
                                            <a data-bs-toggle="modal" data-bs-target="#carDetailsModal"  onclick='viewCar("{{ $item['vin'] }}")' class="car_card_main">
                                            <!--a href="{{ route('vehicle_detail',['make_model_year' => $item['build']['make'].'-'.$item['build']['model'].'-'.$item['build']['year'], 'vin' => $item['vin']]) }}" class="car_card_main"-->
                                                <div class="car_card_img">          
                                                    <img src="{{ $item['media']['photo_links'][0] ?? ''}}" alt="Car Image">
                                                </div>
                                                <div class="car_card_info">
                                                    <div class="car_title_price">
                                                    <h4> {{ $item['build']['make'] ??'' }} {{ $item['build']['model']??'' }} </h4>
                                                        <div class="car_spec">
                                                            <div class="car_spec_info">
                                                                <span>VIN: {{ $item['vin']}}  </span>
                                                                <span>{{ $item['build']['year']}}  </span>&nbsp;|&nbsp;<span>{{ $item['build']['fuel_type']}} </span>&nbsp;|&nbsp;<span>{{ $item['build']['transmission']}}</span>
                                                            </div>
                                                        </div> 
                                                        <div class="price_leads">
                                                            @if(isset($item['price']))
                                                                <h5>${{ number_format($item['price']) }}</h5>
                                                            @else
                                                                <h5>N/A</h5>
                                                            @endif
                                                            <p><a href="{{ route('dealer.mylead',['vin'=>$item['vin']])}}" ><i class="fa-regular fa-eye me-2"></i><span>Total Leads : </span><strong>{{$vin_array[$item['vin']] ?? 0}}</strong></a></p>
                                                        </div>                
                                                    </div>
                                                </div>
                                            </a>
                                            
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
