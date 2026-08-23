@extends('layouts.app')
@section('title', ($vehicle['build']['year'] ?? '') . ' ' . ($vehicle['build']['make'] ?? 'NA') . ' ' . ($vehicle['build']['model'] ?? 'NA'))

@section('meta_description', ($vehicle['build']['year'] ?? '') . ' ' . ($vehicle['build']['make'] ?? 'NA') . ' ' . ($vehicle['build']['model'] ?? 'NA'))

@section('meta_image', $vehicle['media']['photo_links'][0] ?? '')

@section('content')

<style>
    .btn_blue{
        color: #fff !important;
        background-color: #43a9e7;
        border-color: #43a9e7;
    }
    .btn_blue:hover,
    .btn_blue:focus{
        color: #fff;
        background-color: #43a9e7;
        border-color: #43a9e7;
    }
    .car_loc a.btn.btn_blue{
        padding: 3px 10px;
        font-weight: 700;
    }
</style>
<section class="car_details_main section_padding" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-4 col-md-5 col-12 order-md-2 resab_box">
                <div class="car_details_right sticky" id="car_details_right">
                    <div class="car_details_right_top mb-2">
                        <div class="car_details_right_inn">
                            <div class="car_details_spec">
                                <span class="car_year">{{ $vehicle['inventory_type'] ?? 'NA' }}</span>
                                <div class="position-relative">
                                    <div class="car_loc ms-0 w-100">
                                        <i class="fa-solid fa-location-dot me-2"></i><span>{{$vehicle['dealer']['city'] ??''}} , {{$vehicle['dealer']['state'] ??''}}</span>
                                    </div>
                                    @if(isset($vehicle['dealer']['call_track_number']))
                                    <div class="car_loc ms-0 w-100 mt-1">
                                        <a href="tel:{{$vehicle['dealer']['call_track_number'] ??''}}" class="btn btn_blue ms-auto click_call_btn">
                                            <i class="fa-solid fa-phone me-2"></i><span>{{$vehicle['dealer']['call_track_number'] ??''}}</span>
                                        </a>
                                    </div>    
                                    @endif                          
                                </div>                              
                            </div>
                            <div class="car_title_price_specs">
                                <h4>{{ $vehicle['build']['year'] ?? '' }} {{ $vehicle['build']['make'] ?? 'NA' }} {{ $vehicle['build']['model'] ?? 'NA' }}</h4>
                                <div class="car_spec_short">
                                <span>
                                    @if(isset($vehicle['miles']))
                                        {{ number_format($vehicle['miles']) }}
                    
                                    @else
                                        N/A
                                    @endif Miles
                               </span>&nbsp;|&nbsp;
                                
                                <span> {{ $vehicle['build']['fuel_type'] ?? 'NA' }} </span>&nbsp;|&nbsp;<span> {{ $vehicle['build']['transmission'] ?? 'NA' }}</span>
                                </div>
                                <div class="price_sms d-flex align-items-center mb-3">
                                    @if(isset($vehicle['price']))
                                        <h5 class="mb-0">${{ number_format($vehicle['price']) }}</h5>
                                    @else
                                        <h5 class="mb-0">N/A</h5>
                                    @endif

                                    @if(isset($vehicle['dealer']['call_track_sms']))
                                    <a href="sms:+{{ $vehicle['dealer']['call_track_sms'] }}&&body={{ urlencode(url()->full()) }}" id="share-sms" class="d-md-none btn btn_blue ms-auto share-sms">
                                        <i class="fa-solid fa-comment me-1"></i><span>Text Message</span>
                                    </a>
                                    @else
                                    <a href="sms:+12182748696&&body={{ urlencode(url()->full()) }}" id="share-sms" class="d-md-none btn btn_blue ms-auto">
                                        <i class="fa-solid fa-comment me-1"></i><span>Text Message</span>
                                    </a>
                                    @endif
                                   
                                </div>
                                
                            
                            </div>
                            <a href="javascript:;" class="btn btn_theme w-100" onclick="triggerViewdetail(this,'{{ $vehicle['vin'] }}')">Request Contact from Dealer</a>
                        </div>    
                        <div class="btm_gray">
                            <!-- <p><small>Lorem Ipsum is simply dummy text of the printing</small></p> -->
                        </div>
                    </div>

                    <!-- Overview -->
                    <div class="details_tab_content details_overview" id="overview">
                        <div class="tab_content_head">
                            <h3>Request Information</h3>
                        </div>
                        <div class="details_req_info">
                            <form action="" id="validaterequest">
                                <p><span>Hello, my name is</span>
                                    <input type="hidden" name="vin" id="vin"  value="{{ $vehicle['vin'] }}" >
                                    <input type="text" name="name" id="name" value="{{ auth()->user()->name ??'' }}" placeholder="First Name" class="req_in_border required req_in_wsm">
                                    <input type="text"  name="last_name" id="last_name" value="{{ auth()->user()->last_name ??'' }}" placeholder="Last Name" class="req_in_border required req_in_wsm">
                                    <span>and I'm interested in this</span> 
                                    <span><b>{{ $vehicle['build']['year'] ?? '' }} {{ $vehicle['build']['make'] ?? 'NA' }} {{ $vehicle['build']['model'] ?? 'NA' }}s</b>. I'm in the</span>&nbsp;
                                    <input type="text"  placeholder="Zip code" name="zip_code" id="zip_code" class="req_in_border required req_in_wsm">
                                    <span>area. You can reach me by email at</span>&nbsp;
                                    <input type="text" name="email"  placeholder="Email"  value="{{ auth()->user()->email ??'' }}" class="req_in_border required email w-100">
                                    <span>or by phone at</span>&nbsp;
                                    <input type="text" name ="phone_number" placeholder="Phone" value="{{ auth()->user()->phone_number??'' }}" class="req_in_border required">
                                    <span>Thank you!</span></p>

                                <a class="btn btn_theme w-100 mt-2" onclick="savetodb()">Send</a>
                            </form>
                        </div>
                    </div>
                </div>


                <!-- Ad (728px x 90px) -->
                @php 
                  $content='';
                 if(isset($ads->content)) $content = json_decode($ads->content);
                 @endphp
                <section class="position-relative section_padding pt-0">
                    <div class="position-relative text-center">
                        @if($content)  
                            {!! $content[0]->ad !!}
                        @endif
                    </div>
                </section>


            </div>
            @php
                if(in_array($vehicle['vin'], $fav)) {
                    $favclass ='fas';
                }else{
                    $favclass ='far';
                }
            @endphp
            <div class="col col-lg-8 col-md-7 col-12 order-md-1">
                <!-- Image Slider -->
                @if($three60_image_url)
                    <div class="position-relative iframe360_out">
                    <iframe src="{{$three60_image_url }}!disableautospin##teststatic=pilot" width="100%" height=""></iframe>
                    </div>
                    <!--iframe src="{{$three60_image_url }}!disableautospin#teststatic=pilot" width="100%" height="900px"></iframe-->
                @else
                    <div class="position-relative car_details_slider">
                        <div class="main_slider">
                            <!-- Favorite and share -->
                            <div class="like_share_icon details_like_share">
                                <!-- Toggle Favorite Button -->
                                <div class="form-check fevCheck">
                                    <input type="checkbox" class="form-check-input" id="btn-check_{{ $vehicle['vin'] }}"  onclick="makeFavourite(this,'{{ $vehicle['id'] }}','{{ $vehicle['vin'] }}','{{ route('makeFavouite') }}')">
                                    <label class="form-check-label" for="btn-check_{{ $vehicle['vin'] }}"><i class="{{$favclass}} fa-heart" id="heart-icon_{{ $vehicle['vin'] }}"></i></label>
                                    
                                </div>

                                <!-- Share Icon -->
                                <div class="share_icon">
                                    <i class="fa-regular fa-share-from-square"  onclick="showSharePopup(`{{ $vehicle['id'] }}`, '{{ route('vehicle_detail',['make_model_year' => $vehicle['build']['year'].'-'.$vehicle['build']['make'].'-'.$vehicle['build']['model'], 'vin' => $vehicle['vin']]) }}', '{{ $vehicle['build']['year'] ?? '' }} {{ $vehicle['build']['make'] ?? '' }} {{ $vehicle['build']['model'] ?? '' }}')"></i>
           
                                </div>
                            </div>
                            
                            <!-- All photos -->
                            <div class="view_all_photos">
                                <a class="all_photos">All Photos</a>
                            </div>
                            <div id="big" class="owl-carousel owl-theme">  
                            @if(isset($vehicle['media']))
                                @foreach($vehicle['media']['photo_links'] as $key =>$item)                           
                                <div class="item">
                                    <a href="{{$item}}" data-lightbox="gallery" data-title="{{ $vehicle['build']['year'] ?? '' }} {{ $vehicle['build']['make'] ?? 'NA' }} {{ $vehicle['build']['model'] ?? 'NA' }}">
                                        <img src="{{$item}}" alt="">
                                    </a>
                                </div>
                                @endforeach
                            @endif
                            </div>
                        </div>
                        <!-- Thumbnails -->
                        <div id="thumbs" class="owl-carousel owl-theme thumbnail_imgs"> 
                            @if(isset($vehicle['media']))                               
                                @foreach($vehicle['media']['photo_links'] as $key =>$item)                           
                                    <div class="item">
                                        <img src="{{$item}}" alt="">
                                    </div>
                                @endforeach
                            @endif
                        
                        </div>
                    </div>
                @endif
               

                <!-- Tabs -->
                <div class="details_info_tabs" id="details_info_tabs">
                    <a class="overviewtab">Overview</a>
                    <a class="specificationstab">Specifications</a>
                    <a class="featurestab">Features</a>
                    <a class="recommendedtab">Recommended Cars</a>
                    <a href="{{ $vehicle['vdp_url']??'' }}" target="_blank" class="view_dealerWeb">View Dealer Website</a>
                </div>
               
                <!-- Overview -->
                <div class="details_tab_content details_overview" id="overview">
                    <div class="tab_content_head">
                        <h3>Overview</h3>
                    </div>
                    <div class="specs_list">
                        <ul class="row">
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>VIN</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                        <p>{{ $vehicle['vin'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Year</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                        <p> {{ $vehicle['build']['year'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Make</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                        <p> {{ $vehicle['build']['make'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Model</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                        <p> {{ $vehicle['build']['model'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Trim</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                        <p> {{ $vehicle['build']['trim'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Engine</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                        <p> {{ $vehicle['build']['engine'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Transmission</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                        <p> {{ $vehicle['build']['transmission'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Body type</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                        <p> {{ $vehicle['build']['body_type'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                        </ul>
                    </div>

                    <!-- <hr> -->

                    <!--div class="features_list">
                        <ul class="row">
                            <li class="col col-lg-6 col-12">
                                <div class="feature_inn">
                                    <p><i class="fa-regular fa-circle-check me-2"></i>3rd Row Seat</p>
                                </div>
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="feature_inn">
                                    <p><i class="fa-regular fa-circle-check me-2"></i>Bluetooth</p>
                                </div>
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="feature_inn">
                                    <p><i class="fa-regular fa-circle-check me-2"></i>3rd Row Seat</p>
                                </div>
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="feature_inn">
                                    <p><i class="fa-regular fa-circle-check me-2"></i>Bluetooth</p>
                                </div>
                            </li>
                        </ul>
                    </div>-->
                </div>

                <!-- Specifications -->
                <div class="details_tab_content details_specs" id="specifications">
                    <div class="tab_content_head">
                        <h3>Specifications</h3>
                    </div>
                    <div class="specs_list">
                        <ul class="row">
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Exterior Color</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                        <p>{{ $vehicle['exterior_color'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Interior Color</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                        <p>{{ $vehicle['interior_color'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Vehicle Type</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                        <p>{{ $vehicle['build']['vehile_type'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Drive Train</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                    <p>{{ $vehicle['build']['drivetrain'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>

                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Fuel Type</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                    <p>{{ $vehicle['build']['fuel_type'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>

                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Engine Size</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                    <p>{{ $vehicle['build']['engine_size'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Doors</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                    <p>{{ $vehicle['build']['doors'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Cylinders</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                    <p>{{ $vehicle['build']['cylinders'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Heigth</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                    <p>{{ $vehicle['build']['overall_height'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Length</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                    <p>{{ $vehicle['build']['overall_length'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                            <li class="col col-lg-6 col-12">
                                <div class="row g-0">
                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                        <p>Width</p>
                                    </div>
                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                    <p>{{ $vehicle['build']['overall_width'] ?? 'NA' }}</p>
                                    </div>
                                </div>                                
                            </li>
                        </ul>
                    </div>
                </div>

                <!-- Features -->
                <div class="details_tab_content details_features" id="features">
                    <div class="tab_content_head">
                        <h3>Features</h3>
                    </div>

                    <div class="accordion accordion-flush" id="detailedFeatures">
                        @php $i =0 @endphp
                        @foreach($organized_features as $key =>$value)
                        <div class="accordion-item">
                            <!-- Heading -->
                            <h2 class="accordion-header" id="exterior-heading">
                                <button class="accordion-button @if($i!=0) collapsed @endif" type="button" data-bs-toggle="collapse" data-bs-target="#{{ str_replace('&' ,'_' ,str_replace(' ','_',$key)) }}" aria-expanded="true" aria-controls="{{ str_replace('&' ,'_' ,str_replace(' ','_',$key)) }}">{{$key}}</button>
                            </h2>
                            <!-- body -->
                            <div id="{{ str_replace('&' ,'_' ,str_replace(' ','_',$key)) }}" class="accordion-collapse collapse @if($i==0) show @endif" aria-labelledby="exterior-heading" data-bs-parent="#detailedFeatures">
                                <div class="accordion-body">
                                    <div class="features_list">
                                        <ul class="row">
                                            @foreach($value as $item)
                                            <li class="col col-lg-6 col-12">
                                                <div class="feature_inn">
                                                    <p><i class="fa-regular fa-circle-check me-2"></i>{{$item}}</p>
                                                </div>
                                            </li>
                                            @endforeach
                                            
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                        @php $i++; @endphp
                        @endforeach
                       
                    </div>

                </div>

                <!-- Recommended Cars -->
                <div class="details_tab_content details_recommended bg_light" id="recommended">
                    <div class="tab_content_head">
                        <h3>Recommended Cars</h3>
                    </div>

                    <div class="position-relative">
                       
                        <div class="owl-carousel owl-theme cars_recommended_slider nav_center circular_nav circular_nav">
                            <?php foreach($similiarcar['listings'] as $key =>$item) {
                                   
                                   if(!isset($item['media']['photo_links'][0] ) || ($item['vin']==$vehicle['vin'])){
                                          continue;
                                      } ?>
                           
                                <div class="item">
                                    @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
                                
                                </div>

                           <?php } ?>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>
    
</section>

 <!-- Dealer Details Modal -->
 <div class="modal fade" id="dealerDetailsModal" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
            <div class="modal-body">
                <div class="position-relative dealer_details_modal">
                    <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                    <div class="row">
                        <div class="col col-12">
                            <div class="position-relative">
                                <div class="modal_heading">
                                    <h3>Dealer Detail</h3>
                                </div>

                                <div class="car_card dealer_details_card">
                                    <div class="car_card_main">
                                        <div class="car_card_img">          
                                             @if(isset( $vehicle['media']['photo_links']))              
                                            <img src="{{ $vehicle['media']['photo_links'][0] }}" alt="Car Image">
                                            @endif
                                        </div>
                                        <div class="car_card_info">
                                            <div class="car_title_price">
                                                <h4> {{ $vehicle['build']['make'] ?? 'NA' }} {{ $vehicle['build']['model'] ?? 'NA' }}</h4>
                                                <div class="car_spec">
                                                    <div class="car_spec_info">
                                                        <span>{{ $vehicle['build']['year'] ?? 'NA' }}</span>&nbsp;|&nbsp;<span>{{ $vehicle['build']['engine'] ?? 'NA' }}</span>&nbsp;|&nbsp;<span>{{ $vehicle['build']['fuel_type'] ?? 'NA' }}</span>
                                                    </div>
                                                </div>  
                                                <div class="price_sms d-flex align-items-center">
                                                    @if(isset($vehicle['price']))
                                                        <h5 class="ms-0">${{ number_format($vehicle['price']) }}</h5>
                                                    @else
                                                        <h5 class="ms-0">N/A</h5>
                                                    @endif           
                                                    @if(isset($vehicle['dealer']['call_track_sms']))
                                                    <a href="sms:+{{ $vehicle['dealer']['call_track_sms'] }}&&body={{ urlencode(url()->full()) }}" id="share-sms" class="d-md-none btn btn_blue ms-auto share-sms">
                                                        <i class="fa-solid fa-comment me-1"></i><span>Text Message</span>
                                                    </a>
                                                   
                                                    @else
                                                    <a href="sms:+12182748696&&body={{ urlencode(url()->full()) }}" id="share-sms" class="d-md-none btn btn_blue ms-auto">
                                                        <i class="fa-solid fa-comment me-1"></i><span>Text Message</span>
                                                    </a>

                                                    @endif
                                                </div>
                                               
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="short_note mt-3">
                                    <p><small><i class="fa-solid fa-circle-check me-2"></i>Your contact has been shared-You will be contacted shortly</small></p>
                                </div>

                                <hr>
                                <div class="position-relative">
                                    <div class="dealer_contact_loc">
                                        <div class="dealer_contact">                                  
                                            <div class="position-relative text-uppercase">
                                                <p><b>{{$vehicle['dealer']['name']}}</b></p>                                       
                                            </div>
                                        </div>
                                        <div class="dealer_contact">
                                            <i class="fa-solid fa-location-dot me-2"></i>
                                            <div class="position-relative">
                                                <p>{{$vehicle['dealer']['street'] ?? ''}} </p>
                                                <p><small>{{$vehicle['dealer']['city'] ??''}}, {{$vehicle['dealer']['state'] ??''}},{{$vehicle['dealer']['zip'] ??''}}</small></p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="dealer_contact_profPic"> 
                                        @if(isset($vehicle['dealer']['profile_pic']))
                                            <img class="profile-pic img-fluid" src="{{$vehicle['dealer']['profile_pic']}}">  
                                        @else
                                            <img class="profile-pic img-fluid" src="./assets/images/dealerthumbnail.jpg">  
                                        @endif
                                    </div>
                                </div>
                                <div class="dealer_contact">
                                    <i class="fa-solid fa-phone me-2"></i>
                                    <div class="position-relative">
                                    <p>
                                    @if(isset($vehicle['dealer']['call_track_number']))
                                    
                                        
                                    <a href="tel:{{$vehicle['dealer']['call_track_number'] ??''}}" class="btn btn_blue ms-auto click_call_btn">  {{$vehicle['dealer']['call_track_number'] ??''}}</a>
                                    @else
                                    <a href="tel:{{$vehicle['dealer']['phone'] ??''}}" class="btn btn_blue ms-auto click_call_btn"> 
                                            @if(isset($vehicle['dealer']['phone'])) {{ preg_match('/(\d{3})(\d{3})(\d{4})/', preg_replace('/\D/', '', $vehicle['dealer']['phone']), $matches)
                                                ? "($matches[1]) $matches[2]-$matches[3]"
                                                : $vehicle['dealer']['phone'] }} 
                                            @endif
                                    </a>
                                    @endif
                                        </p>
                                    </div>
                                </div>
                                <div class="position-relative agree_text">
                                    <p class="mb-0 text_secondary"><small>autopulse.ai is not responsible for seller actions. Always inspect the car in person before making any transactions.</small></p>
                                </div>

                                <hr>

                                <div class="modal_heading">
                                    <h3>Recommended Cars</h3>
                                </div>

                                <div class="recommended_list">
                                    <?php foreach($similiarcar['listings'] as $key =>$item) {
                                   
                                     if(!isset($item['media']['photo_links'][0])  || ($item['vin']==$vehicle['vin'])){
                                        continue;
                                    } 
                                      
                                        if(in_array($item['vin'], $fav)) {
                                            $favclass ='fas';
                                        }else{
                                            $favclass ='far';
                                        }
                                        ?>
                                        <div class="recommended_list_card">
                                          
                                            <div class="car_card dealer_details_card">
                                                <a href="{{ route('vehicle_detail',['make_model_year' => $item['build']['make'].'-'.$item['build']['model'].'-'.$item['build']['year'], 'vin' => $item['vin']]) }}" class="car_card_main">
                                                    <div class="car_card_img">          
                                                                       
                                                        <img src="{{ $item['media']['photo_links'][0] }}" alt="Car Image">
                                                    </div>
                                                    <div class="car_card_info">
                                                        <div class="car_title_price">
                                                            <h4>{{ $item['build']['year'] ??'' }} {{ $item['build']['make'] ??'' }} {{ $item['build']['model']??'' }} {{ $item['build']['trim'] ??'' }} {{ $item['build']['drivetrain'] ??'' }}</h4>
                                                            @if(isset($item['price']))
                                                                <h5>${{ number_format($item['price']) }}</h5>
                                                            @else
                                                                <h5>N/A</h5>
                                                            @endif
                                                        
                                                        </div>
                                                        <hr>
                                                        <div class="car_spec">
                                                            <span class="car_spec_year">
                                                                 @if(isset($item['miles']))
                                                                    {{ number_format($item['miles']) }}
                                                            
                                                                @else
                                                                    N/A
                                                                @endif Miles </span>
                                                            <div class="car_spec_info">
                                                                <span>{{ $item['build']['engine'] ?? 'N/A'  }} </span>&nbsp;|&nbsp;<span>{{ $item['build']['body_type'] ?? 'N/A'  }}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </a>
                                            </div>
                                            <hr>
                                            
                                            <div class="d-flex align-items-center ">
                                                <div class="like_share_icon">
                                                    <!-- Toggle Favorite Button -->
                                                    <div class="form-check fevCheck">
                                                        <input type="checkbox" class="form-check-input" id="btn-check_{{ $item['vin'] }}"  onclick="makeFavourite(this,'{{ $item['id'] }}','{{ $item['vin'] }}','{{ route('makeFavouite') }}')">
                                                        <label class="form-check-label" for="btn-check_{{ $item['vin'] }}"><i class="{{$favclass}} fa-heart" id="heart-icon_{{ $item['vin'] }}"></i></label>
                                                    </div>

                                                    <!-- Share Icon -->
                                                    <div class="share_icon">
                                                    <i class="fa-regular fa-share-from-square"  onclick="showSharePopup(`{{ $item['id'] }}`, '{{ route('vehicle_detail',['make_model_year' => $item['build']['year'].'-'.$item['build']['make'].'-'.$item['build']['model'], 'vin' => $item['vin']]) }}', '{{ $item['build']['year'] ?? '' }} {{ $item['build']['make'] ?? '' }} {{ $item['build']['model'] ?? '' }}')"></i>
           
                                                    </div>
                                                </div>
                                              
                                                <a href="{{ route('vehicle_detail',['make_model_year' => $item['build']['make'].'-'.$item['build']['model'].'-'.$item['build']['year'], 'vin' => $item['vin']]) }}" class="text_primary ms-auto"><small>View Details<i class="fa-solid fa-angle-right ms-2"></i></small></a>
                                            </div>
                                        
                                        </div>
                                    <?php } ?>

                                    <hr class="mt-0">

                                    <div class="position-relative">
                                        <a href="" class="text_primary"><small>View More Cars<i class="fa-solid fa-angle-right ms-2"></i></small></a>
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
<div class="modal fade" id="reqInfoConfirmationModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-body">
            <div class="position-relative logout_confirmation_modal">
                <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                <div class="row">
                    <div class="col col-12">
                        <div class="position-relative">
                            <div class="modal_heading">
                                <h3>Confirm</h3>
                            </div>

                            <div class="position-relative logout_icon_text">
                            <i class="fa-light fa-circle-check text-success"></i>
                                <h5>Your Request has been shared with respective dealer.</h5>
                            </div>        
                            
                            <div class="position-relative text-center mb-3">
                                <a data-bs-dismiss="modal" class="btn btn_secondary_light">Ok</a>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
        </div>
    </div>
</div>
@endsection
@push ('after-scripts')
<script>
    function savetodb()
    {

        url = '{{ route("visitStore") }}';
        formData = $('#validaterequest').serialize();
        if($('#validaterequest').valid()){
            runajax(url, formData, 'get', '', 'json', function(output) {
                if (output.success) 
                {
                    
                    $('#reqInfoConfirmationModal').modal('show');
                    gtag('event', 'conversion', {
                            'send_to': 'AW-931280000/WhSpCPfnpdcBEIDpiLwD',
                            'transaction_id': output.data.id // You can pass a transaction ID here if you have one
                        });
                    
                }else{
                    triggerobj = $(obj); 
                    $('#userLoginModal').modal('show');
                        
                }
            }); 
        }
    }
  
    function triggerViewdetail(obj,vin){
       
            url = '{{ route("visitStore") }}';
            formData ={vin:vin};
            runajax(url, formData, 'get', '', 'json', function(output) {
              
              
                if (output.success) 
                {
                  
                   $('#dealerDetailsModal').modal('show');
                        gtag('event', 'conversion', {
                            'send_to': 'AW-931280000/WhSpCPfnpdcBEIDpiLwD',
                            'transaction_id': output.data.id // You can pass a transaction ID here if you have one
                        });
                    
                }else{
                    triggerobj = $(obj); 
                   $('#userLoginModal').modal('show');
                        
                }
            }); 
    }
$(document).ready(function() {
    var vin = '{{ $vehicle['vin'] ?? '' }}'; // Ensure vid is defined from your Blade template

    function handleAction(actionType) {
        url = '{{ route("call_sms") }}';
        formData = { vin: vin, action: actionType };
        withoutloader(url, formData, 'get', '', 'json', function(output) {
            // Handle the response if needed
        });
    }

    // Handle SMS action
    $('.share-sms').click(function(event) {
        handleAction('sms');
        // Allow the default SMS action to proceed
    });

    // Handle Call action
    $('.click_call_btn').click(function(event) {
        handleAction('call');
        // Allow the default call action to proceed
    });
});


</script>
@endpush
