@extends('layouts.app')
@section('title', 'Find New & Used Cars Online | Autopulse AI-Powered Car Marketplace  | Advanced AI-Search Technology')

@section('meta_description', 'Explore a wide range of quality new & pre-owned vehicles at autopulse.ai. Find your next car with confidence, powered by our intelligent Search AI-technology Autopulse with over 30,000 dealers inventory online. Start your journey with us today!')



@section('content')

<!-- Home Page Banner -->
<section class="home_banner position-relative" id="home_banner">
    <div class="home_banner_bg">
        <div class="container">
            <div class="row justify-content-center">
                <div class="col col-xl-8 col-lg-7 col-md-12 col-12 d-flex align-items-center">
                    <div class="banner_hero_text">
                        <h1>Find Your <span class="br"></span><span>Next</span> Car on <span class="br"></span>Car<span>Next</span>.Autos by <span class="br"></span>Using <span>Next</span>Gen AI</h1>
                    </div>
                </div>
                <div class="col col-xl-4 col-lg-5 col-md-8 col-12 d-flex align-items-center">
                    <div class="position-relative">
                        <div class="banner_search_car">
                            <form action="{{ route('vechile') }}" id="topsearchform">
                                <!-- Tabs -->
                                <div class="banner_search_tabs">
                                    <div class="search_tab">
                                        <input type="radio" class="btn-check" value="" name="car_type" id="all"  >
                                        <label class="" for="all">All</label>
                                    </div>
                                    <div class="search_tab">
                                        <input type="radio"  name="car_type" value="new" class="btn-check"  id="new" >
                                        <label class="" for="new">New</label>
                                    </div>
                                    <div class="search_tab">
                                        <input type="radio" name="car_type" value="used" class="btn-check" id="used" >
                                        <label class="" for="used">Used</label>
                                        
                                        <input type="hidden" id="longitude" name="longitude" value="{{ $mylocation['longitude'] }}" class="btn-check"  >
                                        <input type="hidden" id="latitude" name="latitude" value="{{ $mylocation['latitude'] }}" class="btn-check"  >
                                        <input type="hidden" name="radius" value="{{ $mylocation['radius'] }}" class="btn-check"  >
                                    </div>
                                </div>

                                <!-- Form -->
                                <div class="banner_search_form">
                                    <div class="row gx-2">
                                        <div class="col col-12">                                    
                                            <select id="single" class="form-control" name="make[]">
                                                <option selected disabled>Select Make</option>
                                                @foreach($allbrand['facets']['make'] as $key =>$value)
                                                    <option value="{{ $value['item']}}">{{ $value['item']}}</option>
                                                @endforeach
                                            </select>
                                        </div>
                                        <div class="col col-12">                                    
                                            <select id="single2" class="form-control" name="model[]">
                                                <option selected disabled>Select Model</option>
                                                @foreach($allbrand['facets']['model'] as $key =>$value)
                                                    <option value="{{ $value['item']}}">{{ $value['item']}}</option>
                                                @endforeach
                                            </select>
                                        </div>
                                        <div class="col col-6">
                                            <select class="form-select" name="min"aria-label="Default select example">
                                                <option selected disabled>Min Price</option>
                                                @for ($i = 10000; $i < 180000; $i += 10000)
                                                    <option value="{{ $i }}">{{ number_format($i) }}</option>
                                                @endfor
                                            </select>
                                        </div>
                                        <div class="col col-6">
                                            <select class="form-select" name="max" aria-label="Default select example">
                                                <option selected disabled>Max Price</option>
                                                @for ($i = 20000; $i < 180000; $i += 10000)
                                                    <option value="{{ $i }}">{{ number_format($i) }}</option>
                                                @endfor
                                            </select>
                                        </div>
                                        <div class="col col-6">
                                            <input type="text" placeholder="Zip Code" id="zip" name="zip" value="{{ $mylocation['zip'] }}" class="form-control "  >
                                        </div>
                                        <div class="col col-6">
                                            <input type="number" placeholder="Radius (miles)" id="radius" name="radius" value="{{ $mylocation['radius'] }}" max='500' class="form-control "  >
                                        </div>
                                        
                                        <div class="col col-6">
                                            <div class="position-relative adv_search_link">
                                                <a href="{{ route('vechile') }}">Advanced Search</a>
                                            </div>
                                        </div>
                                        <div class="col col-6">
                                            <div class="position-relative">
                                                <button type="button" onclick="getlatlong()" class="btn btn_theme">Search</button>
                                            </div>
                                        </div>
                                    </div>

                                
                                </div>
                            </form>
                        </div>
                        <div class="banner_chatbox_o">
                            <a class="chatboxO_a">
                                <span class="banner_chatbox_icon">
                                    <img src="./assets/images/chatbxSearch.png" alt="chat" class="img-fluid">
                                    <!-- <i class="fa-regular fa-magnifying-glass"></i> -->
                                </span><span class="banner_chatbox_text">Start your vehicle search today with Autopulse, our AI assistant!</span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="home_banner_car">
            <img src="{{asset('assets/images/car-silver.png') }}" alt="car">
        </div>
    </div>
</section>

<!-- Featured Cars -->
<section class="featured_cars position-relative section_padding">
    <div class="container">
        <div class="row">
            <div class="col col-md-8 col-7">
                <div class="section_heading">
                    <h2>Featured Cars</h2>
                </div>
            </div>
            <div class="col col-md-4 col-5">
                <div class="featured_tabs">
                    <ul class="nav nav-pills" id="pills-tab" role="tablist">
                        <li class="nav-item me-2" role="presentation">
                            <button class="btn nav-link active" id="pills-new-tab" data-bs-toggle="pill" data-bs-target="#pills-new" type="button" role="tab" aria-controls="pills-new" aria-selected="true">New</button>
                        </li>
                        <li class="nav-item" role="presentation">
                            <button class="btn nav-link" id="pills-used-tab" data-bs-toggle="pill" data-bs-target="#pills-used" type="button" role="tab" aria-controls="pills-used" aria-selected="false">Used</button>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
        <div class="tab-content" id="pills-tabContent">
            <!-- New Cars -->
            <div class="tab-pane fade show active" id="pills-new" role="tabpanel" aria-labelledby="pills-new-tab" tabindex="0">
                <div class="row g-lg-3 g-2">
                    <div class="col col-xl-6 col-lg-4 col-md-6 col-6">
                        <?php 
                            $item = null;

                            if (isset($newpopular[0]) && isset($newpopular[0]['data']) && isset($newpopular[0]['data']['listings']) && isset($newpopular[0]['data']['listings'][0])) {
                                $item = $newpopular[0]['data']['listings'][0];
                            }
                           
                        ?>
                        @if($item)
                            @include('template.users.include.vehicle_item',['class'=>'featured_car_singleCard','item'=>$item])
                        @endif
                       
                    </div>

                    <div class="col col-xl-6 col-lg-8 col-md-6 col-6">
                        <div class="row g-3">
                        <?php  
                            for ($x = 1; $x <= 4; $x++) {
                                //$item = $newpopular[$x]['data']['listings'][0];
                             
                                $item = isset( $newpopular[$x]['data']['listings'][0]) ? $newpopular[$x]['data']['listings'][0] : null;
    
                            ?>
                            <div class="col col-xl-6 col-lg-6 col-12">
                                @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
                               
                            </div>

                        <?php  
                            }
                        ?>
                        </div>
                    </div>

                </div>

                <div class="row">
                    <div class="col col-12">
                        <div class="position-relative text-end mt-xl-5 mt-lg-4 mt-3">
                        
                            <a href="{{ route('vechile',array_merge($mylocation,['Popular'=>'Popular' ,'car_type'=>'new'])) }}" class="btn btn_theme ">View All </a>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Used Cars -->
            <div class="tab-pane fade" id="pills-used" role="tabpanel" aria-labelledby="pills-used-tab" tabindex="0">
                <div class="row g-3">
                    <div class="col col-xl-6 col-lg-4 col-md-6 col-6">
                        <?php 
                            $item = null;

                            if (isset($usedpopular[0]) && isset($usedpopular[0]['data']) && isset($usedpopular[0]['data']['listings']) && isset($newpopular[0]['data']['listings'][0])) {
                                $item = $usedpopular[0]['data']['listings'][0];
                            }
                           
                        ?>
                            <div class="col col-xl-6 col-lg-6 col-12">
                                @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
                            </div>
                       
                    </div>

                    <div class="col col-xl-6 col-lg-8 col-md-6 col-6">
                        <div class="row g-3">
                            <?php  
                                for ($x = 1; $x <= 4; $x++) {
                                    $item = null;

                                    if (isset($usedpopular[$x]) && isset($usedpopular[$x]['data']) && isset($usedpopular[$x]['data']['listings']) && isset($usedpopular[$x]['data']['listings'][0])) {
                                        $item = $usedpopular[$x]['data']['listings'][0];
                                    }
                            ?>

                                <div class="col col-xl-6 col-lg-6 col-12">
                                    @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
                                </div>
                            
                            <?php  
                                }
                            ?>  
                        </div>
                    </div>
                </div>

                <div class="row">
                    <div class="col col-12">
                        <div class="position-relative text-end mt-xl-5 mt-lg-4 mt-3">
                            <a href="{{ route('vechile',array_merge($mylocation,['Popular'=>'Popular' ,'car_type'=>'used'])) }}" class="btn btn_theme ">View All </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>


@if(isset($slot1['code'])) 
<!-- Ad (728px x 90px) Home Banner 1-->
<section class="position-relative section_padding pt-0 home-banner-1">
    <div class="position-relative text-center">
       
            {!! $slot1['code'] !!}
       
    </div>
</section>
@endif
<!-- Latest Car Added -->
<section class="latest_cars position-relative section_padding">
    <div class="container">
        <div class="row">
            <div class="col col-md-8 col-8">
                <div class="section_heading">
                    <h2>Latest Car Added</h2>
                </div>
            </div>
            <div class="col col-md-4 col-4">
                <div class="position-relative text-end">
                  
                    <a href="{{ route('vechile',array_merge($mylocation,['Latest' => 'Latest Car' ])) }}" class="btn btn_theme ">View All</a>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col col-12">
                <div class="position-relative">
                    <div class="owl-carousel owl-theme cars_slider nav_center circular_nav circular_nav">
                        <?php  
                            for ($x = 0; $x < 10; $x++) {
                                if(!isset($latest_car['listings'][$x]['media']['photo_links'][0])){
                                    continue;
                                }
                                $item =$latest_car['listings'][$x];
                        ?>

                        <div class="item">
                              @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
                        </div>

                        <?php  
                            }
                        ?>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>

@if(isset($nearbyDealers['data']) && $nearbyDealers['data'])
<section class="latest_cars position-relative section_padding">
    <div class="container">
        <div class="row">
            <div class="col col-md-8 col-8">
                <div class="section_heading">
                    <p class="text_primary mb-2"><i class="fa-sharp fa-regular fa-crown me-2"></i>Premier Dealer</p>
                    <h2>{{ $nearbyDealers['dealership_name']}}</h2>
                </div>
            </div>
            <div class="col col-md-4 col-4">
                <div class="position-relative text-end">
                  
                    <a href="{{ route('source.vechile',array_merge(['name'=>$nearbyDealers['dealership_name'],'source'=>$nearbyDealers['source']])) }}" class="btn btn_theme ">View All</a>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col col-12">
                <div class="position-relative">
                    <div class="owl-carousel owl-theme cars_slider nav_center circular_nav circular_nav">
                        <?php  
                            for ($x = 0; $x < 10; $x++) {
                                if(!isset($nearbyDealers['data']['listings'][$x]['media']['photo_links'][0])){
                                    continue;
                                }
                                $item =$nearbyDealers['data']['listings'][$x];
                        ?>

                        <div class="item">
                              @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
                        </div>

                        <?php  
                            }
                        ?>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>
@endif

<!-- Recommended Cars -->
@include('template.users.lifestyle')
@if(isset($slot2['code'])) 
<!-- Ad (728px x 90px) Home Banner 2-->
<section class="position-relative section_padding pt-0 home-banner-1">
    <div class="position-relative text-center">
     
            {!! $slot2['code'] !!}
       
    </div>
</section>
@endif

<!-- Trusted Used Cars by Price -->
<section class="trusted_used_cars position-relative section_padding">
    <div class="container" id="container">
        <div class="trusted_bg section_padding">
            <div class="row">
                <div class="col col-12">
                    <div class="section_heading">
                        <h2>Trusted Used Cars by Price</h2>
                    </div>
                </div>
            </div>

            <div id="cusContainer" class="ms-auto">
                <div class="row">
                    <div class="col col-xl-3 col-lg-12 col-12">
                        <div class="position-relative trusted_cars_tabs">
                            <!-- Tab Buttons -->
                            <ul>
                                @php $i =0; @endphp
                                @foreach($range as $key => $value)
                                    @php
                                        $i++;

                                        if ($value == '0-10000') {
                                            $start = $rangevaue = "Under " . number_format(10000);
                                            $startvalue = '0-10000';
                                        } elseif ($value == '40000-1000000000') {
                                            $rangevaue = "Above $" . number_format(40000);
                                        } else {
                                            $myval = explode('-', $value);
                                            $rangevaue = '$' . number_format($myval[0]) . '-' . number_format($myval[1]);
                                        }
                                    @endphp
                                    <li>
                                        <div class="price_tab">
                                            <input type="radio" class="btn-check getitemlist" name="price_range" value="{{ $value }}" id="price{{$value}}" autocomplete="off" @if($i == 1) checked @endif >
                                            <label class="btn" for="price{{$value}}">{{ $rangevaue }}</label>
                                        </div>
                                    </li>
                                @endforeach
                                
                            </ul>

                            <!-- View More -->
                            <div class="trusted_view_more price_range_number">
                                <a href="{{ route('vechile',array_merge($mylocation,['price_range'=> $startvalue ]))}}" class="btn btn_theme">View All</a>
                            </div>
                        </div>                            
                    </div>
                    <div class="col col-xl-9 col-lg-12 col-12">
                        <div class="position-relative">
                            <div class="owl-carousel owl-theme trusetd_cars_slider nav_right circular_nav price_range">
                            @foreach($startrange['listings'] as $key =>$item)

                            <div class="item">
                                @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
                            </div>
                            @endforeach
                              
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>

<!-- Body Type -->
<section class="body_type2 position-relative section_padding bg_light">
    <div class="container">
        <div class="row">
            <div class="col col-lg-5 col-12 d-flex align-items-center">
                <div class="section_heading">
                    <h2>Body Type</h2>
                </div>
            </div>
            <div class="col col-lg-7 col-12">
                <!-- Body Type Slider Tabs -->
                <div class="position-relative">
                    <div class="owl-carousel slider_thumb body_type_thumb">
                        @php $i=0 @endphp
                        @foreach($bodytypelist['facets']['body_type'] as $key =>$row) 
                        @php $i++ @endphp

                            @php
                                // Extract the item name safely
                                $itemName = strtolower($row['item']);
                                
                                // Construct the body type key for configuration lookup
                                $bodyTypeKey = 'constants.BODY_TYPE.' . $itemName;
                                $bodyType = config($bodyTypeKey);

                                // Set default and body type-specific image paths
                                $defaultImagePath = asset('assets/images/suv.png');
                                $bodyTypeImagePath = $bodyType ? asset('assets/images/bodytype/' . $bodyType ) : $defaultImagePath;
                            @endphp
                            <div class="item">
                                <div class="sliding_tab">
                                    <input type="radio" class="btn-check getitemlist" name="body_type" value="{{ $row['item'] }}" id="body_type{{$row['item']}}" @if($i==1) checked @endif  >
                                    <label class="btn" for="body_type{{$row['item']}}">
                                        <img src="{{ $bodyTypeImagePath}}" alt="body type">
                                        <p>{{ $row['item'] }}</p>
                                        <p><small>{{ $row['count'] }} Listings</small></p>
                                    </label>
                                </div>
                            </div>
                        @endforeach
                      
                    </div>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col col-12">
                <!-- List -->
                <div class="position-relative">
                    <div class="owl-carousel owl-theme body_cars_slider nav_left circular_nav body_type">
                    @foreach($body_types_data['listings'] as $key =>$item)
                        
                        <div class="item">
                            @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
                        </div>
                    @endforeach
                    </div>
                </div>

                <div class="row">
                    <div class="col col-12">
                        <div class="position-relative text-end mt-xl-5 mt-lg-4 mt-3 body_type_number">
                            <a href="{{ route('vechile',array_merge($mylocation,['body_type[]'=>$bodytypelist['facets']['body_type'][0]['item']])) }}" class="btn btn_theme ">View All</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>
@if(isset($slot3['code'])) 
<!-- Ad (728px x 90px) Home Banner 1-->
<section class="position-relative section_padding pt-0 home-banner-1">
    <div class="position-relative text-center">
  
        {!! $slot3['code'] !!}
   
    </div>
</section>
@endif
<!-- Popular Makes -->
<section class="popular_makes position-relative section_padding">
    <div class="container">
        <div class="row">
            <div class="col col-lg-5 col-12 d-flex align-items-center">
                <div class="section_heading">
                    <h2>Popular Makes</h2>
                </div>
            </div>
            <div class="col col-lg-7 col-12">
                <!-- Popular Makes Slider Tabs -->
                <div class="position-relative">
                    <div class="owl-carousel slider_thumb popular_makes_thumb">
                    @php $i =0; @endphp
                    @foreach($brandlist['facets']['make'] as $key =>$row) 
                    @php $i++; @endphp 
                        <div class="item">
                            <div class="sliding_tab">
                                <input type="radio" class="btn-check  getpopitemlist" name="make" value="{{ $row['item'] }}" id="make{{$row['item']}}" @if($i==1) checked @endif >
                                    <label class="btn" for="make{{$row['item']}}">
                                    <p>{{ $row['item'] }}</p>
                                    <p><small>{{ $row['count'] }} Listings</small></p>
                                </label>
                            </div>
                        </div>
                    @endforeach
                       
                    </div>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col col-12">
                <!-- List -->
                <div class="position-relative">
                    <div class="owl-carousel owl-theme popular_cars_slider nav_left circular_nav make">
                       
                        @foreach($firstbrand['listings'] as $key =>$item)
                        
                            <div class="item">
                                @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
                            </div>
                        @endforeach
                      
                    </div>
                </div>

                <div class="row">
                    <div class="col col-12">
                        <div class="position-relative text-end mt-xl-5 mt-lg-4 mt-3 make_number">
                            <a href="{{ route('vechile',array_merge($mylocation,['make[]'=>$brandlist['facets']['make'][0]['item'] ])) }}" class="btn btn_theme ">View All</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>

<!-- Not Sure, Which car to buy? -->
<section class="not_sure position-relative section_padding" style="display:none;">
    <div class="container">
        <div class="not_sure_box">
            <div class="row justify-content-center">
                <div class="col col-lg-3 col-12">
                    <div class="position-relative text-center">
                        <img src="./assets/images/thinkingwomen.png" alt="Thinking">
                    </div>
                </div>
                <div class="col col-lg-6 col-md-12 col-12 d-flex align-items-center">
                    <div class="section_heading mb-lg-0">
                        <h2>Not Sure, <span class="br"></span>Which car to buy?</h2>
                        <p class="text_primary">Let us help you find the dream car</p>
                    </div>
                </div>
                <div class="col col-lg-3 col-md-12 col-12 d-flex align-items-center">
                    <div class="position-relative text-center w-100">
                        <a href="" class="btn btn_theme">Let’s Find</a>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>

@endsection

@push ('after-scripts')

<script>
$('.getitemlist').click(function(){
    url = '{{ route("vechile.facet") }}';
    formData = {
        [this.name]: this.value  
    }
    name = this.name;
    runajax(url, formData, 'get', '', 'json', function(output) {
       
       
            $('.'+name).html(output.html);
            $('.'+name+'_number').html(output.total_number);
             $('.trusetd_cars_slider').trigger('destroy.owl.carousel').removeClass('owl-carousel owl-loaded');
        
             $('.trusetd_cars_slider').owlCarousel({
                items: 4,
                loop: false,
                margin: 20,
                autoplay: false,
                autoplayTimeout: 3500,
                autoplayHoverPause: true,
                responsiveClass: true,
                dots: false,
                responsive: {
                    0: {
                        items: 2,
                        margin: 8,
                        nav: false
                    },
                    600: {
                        items: 2,
                    },
                    1000: {
                        items: 3
                    },
                    1200: {
                        items: 3
                    },
                    1500: {
                        items: 4
                    }
                },
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
            });
            $('.body_cars_slider').trigger('destroy.owl.carousel').removeClass('owl-carousel owl-loaded');
            $('.body_cars_slider').owlCarousel({
                items: 4,
                loop: false,
                margin: 20,
                autoplay: false,
                responsiveClass: true,
                dots: false,
                responsive: {
                    0: {
                        items: 2,
                        nav: false,
                        autoplay: false,
                        dots: true,
                        margin: 8,
                    },
                    600: {
                        items: 2,
                    },
                    1000: {
                        items: 3
                    },
                    1200: {
                        items: 4
                    }
                },
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
            });
            
    $('.trusetd_cars_slider').addClass('owl-carousel owl-loaded');
    $('.body_cars_slider').addClass('owl-carousel owl-loaded');
      
    }); 
});

$('.getpopitemlist').click(function(){
    url = '{{ route("vechile.facet") }}';
    formData = {
        [this.name]: this.value  
    }
    name = this.name;
    runajax(url, formData, 'get', '', 'json', function(output) {
       
       
        $('.'+name).html(output.html);
        $('.'+name+'_number').html(output.total_number);
            
        $('.popular_cars_slider').trigger('destroy.owl.carousel').removeClass('owl-carousel owl-loaded');
        $('.popular_cars_slider').owlCarousel({
            items: 4,
            loop: false,
            margin: 20,
            autoplay: false,
            responsiveClass: true,
            dots: false,
            responsive: {
                0: {
                    items: 2,
                    nav: false,
                    autoplay: false,
                    dots: true,
                    margin: 8,
                },
                600: {
                    items: 2,
                },
                1000: {
                    items: 3
                },
                1200: {
                    items: 4
                }
            },
            nav: true,
            navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
        });
        $('.popular_cars_slider').addClass('owl-carousel owl-loaded');
      
    }); 
});

$('.getlifeitemlist').click(function(){
    url = '{{ route("vechile.facet") }}';
    formData = {
        [this.name]: this.value  
    }
    name = this.name;
    runajax(url, formData, 'get', '', 'json', function(output) {
       
       
        $('.'+name).html(output.html);
        $('.'+name+'_number').html(output.total_number);
            
        $('.lifestyle_cars_slider').trigger('destroy.owl.carousel').removeClass('owl-carousel owl-loaded');
        $('.lifestyle_cars_slider').owlCarousel({
            items: 4,
            loop: false,
            margin: 20,
            autoplay: false,
            responsiveClass: true,
            dots: false,
            responsive: {
                0: {
                    items: 2,
                    nav: false,
                    autoplay: false,
                    dots: true,
                    margin: 8,
                },
                600: {
                    items: 2,
                },
                1000: {
                    items: 3
                },
                1200: {
                    items: 4
                }
            },
            nav: true,
            navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
        });
        $('.lifestyle_cars_slider').addClass('owl-carousel owl-loaded');
      
    }); 
});

$('.getmontros').click(function(){
    url = '{{ route("vechile.facet") }}';
    source =  $(this).attr('data_name');
    formData = {
        [this.name]: this.value  ,
        ['source_name']:  source
    }
    name = this.name;
    runajax(url, formData, 'get', '', 'json', function(output) {
       
       
        $('.'+name).html(output.html);
        $('.'+name+'_number').html(output.total_number);
            
        $('.montros_cars_slider').trigger('destroy.owl.carousel').removeClass('owl-carousel owl-loaded');
        $('.montros_cars_slider').owlCarousel({
            items: 4,
            loop: false,
            margin: 20,
            autoplay: false,
            responsiveClass: true,
            dots: false,
            responsive: {
                0: {
                    items: 2,
                    nav: false,
                    autoplay: false,
                    dots: true,
                    margin: 8,
                },
                600: {
                    items: 2,
                },
                1000: {
                    items: 3
                },
                1200: {
                    items: 4
                }
            },
            nav: true,
            navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
        });
        $('.montros_cars_slider').addClass('owl-carousel owl-loaded');
      
    }); 
});

</script>
<script>
    $(document).ready(function() {

        $('#single').change(function(){
            var url = '{{ route("dependentKeyword") }}';
            var make = $(this).val();
            var formData = {'make': make};
            $('#single2').val(null).trigger('change');
            $('#single2').empty(); // Clear the dropdown
            runajax(url, formData, 'get', '', 'json', function(output) {
                // Clear existing options in the Select2 dropdown
                $('#single2').empty().trigger('change');

                var options = []; // Initialize an array to hold new options
                console.log(output.facets)
                // Assuming you want to iterate over the "model" facet
                if (output.facets && output.facets.model) {
                    output.facets.model.forEach(function(row) {
                        options.push(new Option(row.item , row.item, false, false));
                    });
                }

                // Append new options and trigger the Select2 update
                $('#single2').append(options).trigger('change');
            }); 
        });

        $('a').on('click', function(event) {
            var href = $(this).attr('href');
            var target = $(this).attr('target');

            // Check if href is not javascript, #, or javascript:void
            if (href && href !== '#' && !href.startsWith('javascript')) {
                // Check if the link should open in a new tab
                if (target === '_blank') {
                    return; // Allow the link to open in a new tab without showing the loader
                }

                event.preventDefault(); // Prevent the default link behavior

                // Show the loader overlay
                $('.loader-overlay').show();
                
                // Navigate to the URL after a short delay to ensure the loader is shown
                setTimeout(function() {
                    window.location.href = href;
                }, 10); // Adjust the delay as needed
            } else {
                $('.loader-overlay').hide();
            }
        });
    });

    window.addEventListener('pageshow', function(event) {
        if (event.persisted) {
            $('.loader-overlay').hide();// Hide loader if page is loaded from cache (back button)
        }
    });
  

        // Optionally hide loader on normal page load
    window.addEventListener('load',  $('.loader-overlay').hide());

    function getlatlong()
    {
        if($('#zip').val()){
            var zipCode = document.getElementById("zip").value;
            var apiKey = "{{ env('GOOGLE_PLACE_API') }}";
            var geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json?address=" + zipCode + "&key="+apiKey;

            $.ajax({
                url: geocodeUrl,
                type: 'GET',
                success: function (response) {
                    if (response.status === 'OK' && response.results.length > 0) {
                        var lat = response.results[0].geometry.location.lat;
                        var lng = response.results[0].geometry.location.lng;
                     
                        var addressComponents = response.results[0].address_components;
                        var countryCode = '';

                        for (var i = 0; i < addressComponents.length; i++) {
                            var component = addressComponents[i];
                            if (component.types.indexOf('country') !== -1) {
                                countryCode = component.short_name;
                                break;
                            }
                        }

                        $('#latitude').val(lat);
                        $('#longitude').val(lng);
                        $('#country').val(countryCode);
                       
                        var form = document.getElementById("topsearchform");
                        form.submit();
                        
                        
                    }else{
                        jQuery.validator.addMethod("zip_error", function(value, element) {
                            return this.optional(element) || value !== zipCode;
                        }, jQuery.validator.format('Enter Valid zip Code'));
                        $('#zip').addClass("zip_error");
                        jQuery('#zip').valid();
                    }
                },
                error: function (xhr, status, error) {
                
                    jQuery.validator.addMethod("zip_error", function(value, element) {
                        return this.optional(element) || value !== zipCode;
                    }, jQuery.validator.format('Enter Valid zip Code'));
                    $('#zip').addClass("zip_error");
                    jQuery('#zip').valid();
                }
            });
        }else{
            var form = document.getElementById("topsearchform");
            form.submit();
        }

    
    }
</script>

@endpush