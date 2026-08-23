
<div class="position-relative cardetailspop">
    <div class="container">
        <div class="row">
            <div class="col col-lg-4 col-md-5 col-12 order-md-2 resab_box">
                <div class="car_details_right sticky" style="top: 0;">
                    <div class="car_details_right_top mb-2">
                        <div class="car_details_right_inn">
                            <div class="car_details_spec">
                                <span class="car_year">{{ $vehicle['inventory_type'] ?? 'NA' }}</span>
                                <div class="car_loc">
                                    <i class="fa-solid fa-location-dot me-2"></i><span>{{$vehicle['dealer']['city']}}, {{$vehicle['dealer']['state']}}</span>
                                    
                                </div>
                            </div>
                            <div class="car_title_price_specs">
                                <h4>{{ $vehicle['build']['year'] ?? '' }} {{ $vehicle['build']['make'] ?? 'NA' }} {{ $vehicle['build']['model'] ?? 'NA' }}</h4>
                                <div class="car_spec_short">
                                    <span> {{ $vehicle['build']['fuel_type'] ?? 'NA' }} </span>&nbsp;|&nbsp;<span> {{ $vehicle['build']['transmission'] ?? 'NA' }}</span>
                                </div>
                                @if(isset($vehicle['price']))
                                    <h5>${{ number_format($vehicle['price']) }}</h5>
                                @else
                                    <h5>N/A</h5>
                                @endif
                            
                            </div>
                        
                        </div>    
                        <div class="btm_gray">
                            <!-- <p><small>Lorem Ipsum is simply dummy text of the printing</small></p>                 -->
                        </div>
                    </div>
                </div>
            </div>
            <div class="col col-lg-8 col-md-7 col-12 order-md-1">
                <!-- Image Slider -->
                <div class="position-relative car_details_slider" id="car_details_slider">
                    <div class="main_slider">
                        <!-- Favorite and share -->
                        <div class="like_share_icon">
                            <!-- Toggle Favorite Button -->
                            <!--div class="form-check fevCheck">
                                <input type="checkbox" class="form-check-input" id="btn-check" autocomplete="off">
                                <label class="form-check-label" for="btn-check"><i class="far fa-heart" id="heart-icon"></i></label>
                            </div-->

                            <!-- Share Icon -->
                            <div class="share_icon">
                                <i class="fa-regular fa-share-from-square"  onclick="showSharePopup(`{{ $vehicle['id'] }}`, '{{ route('vehicle_detail',['make_model_year' => $vehicle['build']['year'].'-'.$vehicle['build']['make'].'-'.$vehicle['build']['model'], 'vin' => $vehicle['vin']]) }}', '{{ $vehicle['build']['year'] ?? '' }} {{ $vehicle['build']['make'] ?? '' }} {{ $vehicle['build']['model'] ?? '' }}')"></i>
           
                            </div>
                        </div>
                        
                        <!-- All photos -->
                        <div class="view_all_photos">
                            <a class="all_photos">All Photos</a>
                        </div>
                        <div id="dealerbig" class="owl-carousel owl-theme">                              
                            @foreach($vehicle['media']['photo_links'] as $key =>$item)                           
                                <div class="item">
                                    <a href="{{$item}}" data-lightbox="gallery" data-title="{{ $vehicle['build']['year'] ?? '' }} {{ $vehicle['build']['make'] ?? 'NA' }} {{ $vehicle['build']['model'] ?? 'NA' }}">
                                        <img src="{{$item}}" alt="">
                                    </a>
                                </div>
                            @endforeach
                        </div>
                    </div>
                    <!-- Thumbnails -->
                    <div id="dealerthumbs" class="owl-carousel owl-theme thumbnail_imgs">                                
                        @foreach($vehicle['media']['photo_links'] as $key =>$item)                           
                            <div class="item">
                                <img src="{{$item}}" alt="">
                            </div>
                        @endforeach
                    </div>
                </div>

                <!-- Tabs -->
                <div class="details_info_tabs" id="dealerdetails_info_tabs" style="top: -18px;">
                    <a class="dealeroverviewtab">Overview</a>
                    <a class="dealerspecificationstab">Specifications</a>
                    <a class="dealerfeaturestab">Features</a>
                </div>

                <!-- Overview -->
                <div class="details_tab_content details_overview" id="dealeroverview">
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

                   
                </div>

                <!-- Specifications -->
                <div class="details_tab_content details_specs" id="dealerspecifications">
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
                <div class="details_tab_content details_features" id="dealerfeatures">
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

            </div>
        </div>
    </div>
</div>
            
<script>
$(document).ready(function() {
    $('.dealeroverviewtab').click(function() {
        $('#carDetailsModal .modal-body').animate({scrollTop: ($('#dealeroverview').position().top - 57)}, 'slow');
    });
    $('.dealerspecificationstab').click(function() {
        $('#carDetailsModal .modal-body').animate({scrollTop: ($('#dealerspecifications').position().top - 57)}, 'slow');
    });
    $('.dealerfeaturestab').click(function() {
        $('#carDetailsModal .modal-body').animate({scrollTop: ($('#dealerfeatures').position().top - 57)}, 'slow');
    });
});
</script>