@extends('layouts.app')
@section('title', 'New Vehicles | Discover Your Perfect New Car on autopulse.ai')

@section('meta_description', ' Discover a wide selection of new vehicles at Autopulse. Find the perfect 
new car that fits your lifestyle and budget. Enjoy great deals and exceptional service. 
Start your search today!
')

@section('content')
<style>
    .filter_count{
        display:none;
    }
</style>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.5.0/nouislider.min.css">
<section class="car_listing_main section_padding" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-3 col-md-12 col-12">               

                <div class="offcanvas-collapse" id="mobMenu">
                    <div class="filter_head_reset">
                        <div class="filter_head">
                            <i class="fa-solid fa-filter me-2"></i><span>Filter</span>
                        </div>
                        <!-- Reset Filters -->
                        <div class="reset_filter">
                            <a href="{{ route('source.vechile',['name'=>$input['name'] ??'' ,'source'=>$input['source'] ??''] ) }}"><small><i class="fa-sharp fa-solid fa-rotate-left me-2"></i>Reset</small></a>
                        </div>
                    </div>
                    <form action="" id="searchinput" class=" ">
                        <!-- Filter by All, New, Used -->
                        
                        <div class="listing_filter_btns">
                            <div class="position-relative">
                                <input type="radio" class="btn-check" name="car_type" id="all" value="" @if(isset($input['car_type']) && ($input['car_type']=='')) checked @endif >
                                <label class="btn" for="all">All</label>
                            </div>
                            <div class="position-relative">
                                <input type="radio" class="btn-check" name="car_type" id="new" value="new" @if(isset($input['car_type']) && ($input['car_type']=='new')) checked @endif>
                                <label class="btn" for="new">New</label>
                            </div>
                            <div class="position-relative">
                                <input type="radio" class="btn-check"name="car_type" value="used" id="used" @if(isset($input['car_type']) && ($input['car_type']=='used')) checked @endif>
                                <label class="btn" for="used">Used</label>
                            </div>
                            <input type="hidden" value="@if(isset($input['name'])){{ $input['name']}}@endif" name="name" >
                            <input type="hidden" value="@if(isset($input['source'])){{ $input['source']}}@endif" name="source" >
                        </div>

                        

                        <!-- Filter by Year -->
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterYear" role="button" aria-expanded="false" aria-controls="filterYear">
                                    <span>Year</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterYear">
                                <div class="range_slider mb-3">
                                    @php
                                        // Extract values from $input['miles_range']
                                        $year_range = isset($input['year_range']) ? explode('-', $input['year_range']) : [0, date('Y')];
                                        $min_year = isset($year_range[0]) ? (int)$year_range[0] : 0;
                                        $max_year = isset($year_range[1]) ? (int)$year_range[1] : date('Y');
                                        #dd( $miles_start );
                                    @endphp
                                    <div class="price-inputs">
                                        <input type="text" value ="{{ $min_year }}"id="minYear" placeholder="1982">
                                        <span>to</span>
                                        <input type="text" value ="{{ $max_year }}" id="maxYear" placeholder="{{ $max_year }}">
                                    </div>
                                    <div id="yearRange"></div>
                                </div>
                               
                                <div class="position-relative text-center">
                                     <button type="button" onclick="makeyearrange()" class="btn btn_theme">Apply</button>
                                </div>
                            </div>
                        </div>

                         <!-- Filter by Price ($) -->
                         <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterPrice" role="button" aria-expanded="false" aria-controls="filterPrice">
                                    <span>Price ($)</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterPrice">
                                <div class="range_slider mb-3">
                                    @php
                                        // Extract values from $input['price_range']
                                        $priceRange = isset($input['price_range']) ? explode('-', $input['price_range']) : [0, 100000000];
                                        $slider1Value = isset($priceRange[0]) ? (int)$priceRange[0] : 0;
                                        $slider2Value = isset($priceRange[1]) ? (int)$priceRange[1] : 1200000;
                                    @endphp
                                    <div class="price-inputs">
                                        <input type="text" id="minPrice" value="{{$slider1Value }}" placeholder="$1,500">
                                        <span class="spanto">to</span>
                                        <input type="text" id="maxPrice"  value="{{$slider2Value }}" placeholder="$150,000">
                                    </div>
                                    <div id="priceRange"></div>
                                   
                                </div>
                               
                                <div class="position-relative text-center">
                                     <button type="button" onclick="makepricerange()" class="btn btn_theme">Apply</button>
                                </div>

                            </div>
                            
                        </div>

                        <!-- Filter by Mileage -->
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterMileage" role="button" aria-expanded="false" aria-controls="filterMileage">
                                    <span>Miles</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            @php
                                // Extract values from $input['miles_range']
                                $milesRange = isset($input['miles_range']) ? explode('-', $input['miles_range']) : [0, 1000000];
                                $miles_start = isset($milesRange[0]) ? (int)$milesRange[0] : 0;
                                $miles_end = isset($milesRange[1]) ? (int)$milesRange[1] : 1000000;
                                #dd( $miles_start );
                            @endphp
                            <div class="collapse" id="filterMileage">
                                <div class="range_slider mb-3">
                                    <div class="price-inputs">
                                        <input type="text" value="{{$miles_start }}" id="minMileage" placeholder="1">
                                        <span>to</span>
                                        <input type="text" value="{{$miles_end }}" id="maxMileage" placeholder="1000000">
                                    </div>
                                    <div id="mileageRange"></div>
                                </div>
                               
                                <div class="position-relative text-center">
                                     <button type="button" onclick="makemileagerange()" class="btn btn_theme">Apply</button>
                                </div>
                            </div>
                        </div>

                        <!-- Filter by Make -->
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterMake" role="button" aria-expanded="false" aria-controls="filterMake">
                                    <span>Make</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterMake">
                                <div class="position-relative listing_searchbx mt-3">
                                    <input type="text" class="form-control" placeholder="Search" id="makesearch">
                                </div>
                                <ul class="checkbox_list" id="makeListsearch">
                                    @foreach($finalvalue['facets']['make'] as $key =>$item)
                                        
                                        <li class="form-check">
                                            <input class="form-check-input" type="checkbox" id="{{ str_replace(' ','_',$item['item'])}}" value="{{$item['item']}}" 
                                            @if(isset($input['make']) && in_array($item['item'],$input['make'])) checked @endif
                                            name="make[]">
                                            <label class="form-check-label" for="{{ str_replace(' ','_',$item['item'])}}">
                                            <span>{{$item['item']}}</span><span class="filter_count">{{$item['count']}}</span>
                                            </label>
                                        </li>
                                    
                                    @endforeach
                                </ul>
                            </div>
                        </div>

                        <!-- Filter by Model -->
                        @if(isset($input['make']) || isset($input['popular']))
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterModel" role="button" aria-expanded="false" aria-controls="filterModel">
                                    <span>Model</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterModel">
                                <div class="position-relative listing_searchbx mt-3">
                                    <input type="text" class="form-control" placeholder="Search" id="modelsearch">
                                </div>
                                <ul class="checkbox_list" id="modelListsearch">
                                    @foreach($finalvalue['facets']['model'] as $key =>$item)
                                        <li class="form-check">
                                            <input class="form-check-input" type="checkbox" id="{{ str_replace(' ','_',$item['item'])}}" value="{{$item['item']}}" 
                                            @if(isset($input['model']) && in_array($item['item'],$input['model'])) checked @endif
                                            name="model[]">
                                            <label class="form-check-label" for="{{ str_replace(' ','_',$item['item'])}}">
                                            <span>{{$item['item']}}</span><span class="filter_count">{{$item['count']}}</span>
                                            </label>
                                        </li>
                                    
                                    @endforeach
                                
                                </ul>
                            </div>
                        </div>
                        @endif

                        <!-- Filter by Trim -->
                        @if(isset($input['model']) || isset($input['popular']))
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filtertrim" role="button" aria-expanded="false" aria-controls="filtertrim">
                                    <span>Trim</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filtertrim">
                                <div class="position-relative listing_searchbx mt-3">
                                    <input type="text" class="form-control" placeholder="Search" id="trimsearch">
                                </div>
                                <ul class="checkbox_list" id="trimlistsearch">
                                    @foreach($finalvalue['facets']['trim'] as $key =>$item)
                                        <li class="form-check">
                                            <input class="form-check-input" type="checkbox" id="{{ str_replace(' ','_',$item['item'])}}" value="{{$item['item']}}" 
                                            @if(isset($input['trim']) && in_array($item['item'],$input['trim'])) checked @endif
                                            name="trim[]">
                                            <label class="form-check-label" for="{{ str_replace(' ','_',$item['item'])}}">
                                            <span>{{$item['item']}}</span><span class="filter_count">{{$item['count']}}</span>
                                            </label>
                                        </li>
                                    
                                    @endforeach
                                
                                </ul>
                            </div>
                        </div>
                        @endif

                        <!-- Filter by Transmission -->
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterTrans" role="button" aria-expanded="false" aria-controls="filterTrans">
                                    <span>Transmission</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterTrans">
                                <ul class="checkbox_list">
                                    @foreach($finalvalue['facets']['transmission'] as $key =>$item)
                                        <li class="form-check">
                                            <input class="form-check-input" type="checkbox" id="{{ str_replace(' ','_',$item['item'])}}" value="{{$item['item']}}" 
                                            @if(isset($input['transmission']) && in_array($item['item'],$input['transmission'])) checked @endif
                                            name="transmission[]">
                                            <label class="form-check-label" for="{{ str_replace(' ','_',$item['item'])}}">
                                            <span>{{$item['item']}}</span><span class="filter_count">{{$item['count']}}</span>
                                            </label>
                                        </li>
                                    
                                    @endforeach
                                
                                </ul>
                            </div>
                        </div>

                        <!-- Filter by Engine -->
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterengine" role="button" aria-expanded="false" aria-controls="filterengine">
                                    <span>Engine</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterengine">
                                <div class="position-relative listing_searchbx mt-3">
                                    <input type="text" class="form-control" placeholder="Search" id="enginesearch">
                                </div>
                                <ul class="checkbox_list" id="enginesearchlist">
                                    @foreach($finalvalue['facets']['engine'] as $key =>$item)
                                        <li class="form-check">
                                            <input class="form-check-input" type="checkbox" id="{{ str_replace(' ','_',$item['item'])}}" value="{{$item['item']}}" 
                                            @if(isset($input['engine']) && in_array($item['item'],$input['engine'])) checked @endif
                                            name="engine[]">
                                            <label class="form-check-label" for="{{ str_replace(' ','_',$item['item'])}}">
                                            <span>{{$item['item']}}</span><span class="filter_count">{{$item['count']}}</span>
                                            </label>
                                        </li>
                                    
                                    @endforeach
                                
                                </ul>
                            </div>
                        </div>

                        <!-- Filter by Engine -->
                        
                    
                       

                        

                        

                        <!-- Filter by Fuel Type -->
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterFuel" role="button" aria-expanded="false" aria-controls="filterFuel">
                                    <span>Fuel Type</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterFuel">
                                <ul class="checkbox_list">

                                    @foreach($finalvalue['facets']['fuel_type'] as $key =>$item)
                                        <li class="form-check">
                                            <input class="form-check-input" type="checkbox" id="{{ str_replace(' ','_',$item['item'])}}" value="{{$item['item']}}" 
                                            @if(isset($input['fuel_type']) && in_array($item['item'],$input['fuel_type'])) checked @endif
                                            name="fuel_type[]">
                                            <label class="form-check-label" for="{{ str_replace(' ','_',$item['item'])}}">
                                            <span>{{$item['item']}}</span><span class="filter_count">{{$item['count']}}</span>
                                            </label>
                                        </li>
                                    
                                    @endforeach
                                
                                </ul>
                            </div>
                        </div>
                          <!-- Filter by Drive Train -->
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterdrivetrain" role="button" aria-expanded="false" aria-controls="filterdrivetrain">
                                    <span>Drive Train</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterdrivetrain">
                                <ul class="checkbox_list">

                                    @foreach($finalvalue['facets']['drivetrain'] as $key =>$item)
                                        <li class="form-check">
                                            <input class="form-check-input" type="checkbox" id="{{ str_replace(' ','_',$item['item'])}}" value="{{$item['item']}}" 
                                            @if(isset($input['drivetrain']) && in_array($item['item'],$input['drivetrain'])) checked @endif
                                            name="drivetrain[]">
                                            <label class="form-check-label" for="{{ str_replace(' ','_',$item['item'])}}">
                                            <span>{{$item['item']}}</span><span class="filter_count">{{$item['count']}}</span>
                                            </label>
                                        </li>
                                    
                                    @endforeach
                                
                                </ul>
                            </div>
                        </div>

                        

                        <!-- Filter by Body Type -->
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterBody" role="button" aria-expanded="false" aria-controls="filterBody">
                                    <span>Body Type</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterBody">
                                <ul class="checkbox_list">
                                        @foreach($finalvalue['facets']['body_type'] as $key => $facetItem)
                                            @php
                                                // Extract the item name safely
                                                $itemName = $facetItem['item'];
                                                
                                                // Construct the body type key for configuration lookup
                                                $bodyTypeKey = 'constants.BODY_TYPE.' . $itemName;
                                                $bodyType = config($bodyTypeKey);

                                                // Set default and body type-specific image paths
                                                $defaultImagePath = asset('assets/images/suv.png');
                                                $bodyTypeImagePath = $bodyType ? asset('assets/images/bodytype/' . $bodyType . '.png') : $defaultImagePath;
                                            @endphp
                                        <li class="form-check">
                                            <!-- Checkbox with conditional check for the body type -->
                                            <input
                                                class="form-check-input"
                                                @if(isset($input['body_type']) && in_array($itemName, $input['body_type'])) checked @endif
                                                type="checkbox"
                                                id="{{ str_replace(' ', '_', $itemName) }}"
                                                value="{{ $itemName }}"
                                                name="body_type[]"
                                            >
                                            <label class="form-check-label" for="{{ str_replace(' ', '_', $itemName) }}">
                                                <span class="d-flex align-items-center">
                                                    <span class="filter_bodyimg">
                                                        <!-- Use the correct image path -->
                                                        <img src="{{ $bodyTypeImagePath }}" alt="{{ $itemName }}">
                                                    </span>
                                                    {{ $itemName }}
                                                </span>
                                                <!-- Display the count -->
                                                <span class="filter_count">{{ $facetItem['count'] }}</span>
                                            </label>

                                            </li>
                                        @endforeach

                                    
                                </ul>
                            </div>
                        </div>

                        

                        <!-- Filter by Seat -->
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterSeats" role="button" aria-expanded="false" aria-controls="filterSeats">
                                    <span>Seats</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterSeats">
                                <ul class="checkbox_list row g-0">
                                    @foreach($finalvalue['facets']['seating_capacity'] as $key =>$item)
                                    <li class="form-check col col-4">
                                        <input class="form-check-input" value="{{$item['item']}}" type="checkbox" @if(isset($input['seating_capacity']) && in_array($item['item'],$input['seating_capacity'])) checked @endif type="checkbox" id="{{ str_replace(' ','_',$item['item'])}}" name="seating_capacity[]">
                                        <label class="form-check-label"  for="{{ str_replace(' ','_',$item['item'])}}">
                                            <span>{{$item['item']}}</span>
                                        </label>
                                    </li>
                                    @endforeach
                                
                                </ul>
                            </div>
                        </div>
                        <!-- Filter by Exterior color -->
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterExterior" role="button" aria-expanded="false" aria-controls="filterExterior">
                                    <span>Exterior color</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterExterior">
                                <div class="position-relative listing_searchbx mt-3">
                                    <input type="text" class="form-control" placeholder="Search" id="exteriorsearch">
                                </div>
                                <ul class="checkbox_list" id="exteriorListsearch">
                                    @foreach($colorData as $key =>$item)
                                    <li class="form-check">
                                        <input class="form-check-input" type="checkbox" value="{{ $key }}"   @if(isset($input['exterior_color']) && in_array($key,$input['exterior_color'])) checked @endif type="checkbox" id="{{ str_replace(' ','_',$item)}}" name="exterior_color[]">
                                        <label class="form-check-label" for="blackchk1">
                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:{{$item }}"></span>{{$key}}</span><!--span class="filter_count">4</span-->
                                        </label>
                                    </li>
                                    @endforeach
                                </ul>
                            </div>
                        </div>

                        <!-- Filter by Interior color -->
                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterInterior" role="button" aria-expanded="false" aria-controls="filterInterior">
                                    <span>Interior color</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterInterior">
                                <div class="position-relative listing_searchbx mt-3">
                                    <input type="text" class="form-control" placeholder="Search" id="interiorsearch">
                                </div>
                                <ul class="checkbox_list" id="interiorListsearch">
                                    @foreach($colorData as $key =>$item)
                                    <li class="form-check">
                                        <input class="form-check-input" type="checkbox" @if(isset($input['interior_color']) && in_array($key,$input['interior_color'])) checked @endif type="checkbox" id="{{ str_replace(' ','_',$key)}}" value="{{ $key }}" name="interior_color[]">
                                        <label class="form-check-label" for="blackchk1">
                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:{{$item }}"></span>{{$key}}</span><!--span class="filter_count">4</span-->
                                        </label>
                                    </li>
                                    @endforeach
                                    
                                </ul>
                            </div>
                        </div>

                        <div class="listing_filter_check filterbox_bg">
                            <div class="position-relative">
                                <a class="collapse_head collapsed" data-bs-toggle="collapse" href="#filterhighvaluefeature" role="button" aria-expanded="false" aria-controls="filterInterior">
                                    <span>High Value</span>
                                    <span class="collapse_icon">
                                        <i class="fa-solid fa-plus"></i>
                                        <i class="fa-solid fa-minus"></i>
                                    </span>
                                </a>
                            </div>
                            <div class="collapse" id="filterhighvaluefeature">
                                <div class="position-relative listing_searchbx mt-3">
                                    <input type="text" class="form-control" placeholder="Search" id="highvaluefeaturesearch">
                                </div>
                                <ul class="checkbox_list" id="highvaluefeaturelist">
                            

                                        @foreach($finalvalue['facets']['high_value_features'] as $key =>$item)
                                            <li class="form-check">
                                                <input class="form-check-input" type="checkbox" id="{{ str_replace(' ','_',$item['item'])}}" value="{{$item['item']}}" 
                                                @if(isset($input['high_value_features']) && in_array($item['item'],$input['high_value_features'])) checked @endif
                                                name="high_value_features[]">
                                                <label class="form-check-label" for="{{ str_replace(' ','_',$item['item'])}}">
                                                <span>{{$item['item']}}</span><span class="filter_count">{{$item['count']}}</span>
                                                </label>
                                            </li>

                                        @endforeach

                                    
                                </ul>
                            </div>
                        </div>
                        <input type="hidden" name="life_style" id="lifesytle" value="{{ $input['life_style'] ?? ''}}" >
                        <input type="hidden" name="popular" id="popular" value="{{ $input['popular'] ?? ''}}" >
                        <input type="hidden" name="Latest" id="Latest" value="{{ $input['Latest'] ?? ''}}" >

                        <input type="hidden" name="sort_by" id="sort_by" value="{{ $input['sort_by'] ?? ''}}" >
                        <input type="hidden" name="sort_order" id="sort_order" value="{{ $input['sort_order'] ?? ''}}">
                        <input type="hidden" name="price_range" id="price_range" value="{{ $input['price_range'] ?? ''}}">
                        <input type="hidden" name="miles_range" id="miles_range" value="{{ $input['miles_range'] ?? ''}}">
                        <input type="hidden" name="year_range" id="year_range" value="{{ $input['year_range'] ?? ''}}">
                    </form>
                    <button type="button" class="btn-close text-reset offcanvas_close" id="mobMenuBtn" data-bs-dismiss="offcanvas" aria-label="Close"></button>
                </div>

            </div>
            <div class="col col-lg-9 col-md-12 col-12">
                <div class="position-relative">
                    <div class="section_heading mb-lg-4 mb-3">
                        <h2>{{ request('name') }}</h2>
                    </div>
                </div>
                <div class="position-relative listing_filter_sort">
                    <div class="row">
                        <div class="col col-lg-0 col-6 d-flex align-items-center">
                            <!-- Filter Tab for Mobile -->
                            <div class="position-relative listing_filter_icon">
                                <a class="navbar-toggler navbarSideCollapse">
                                <i class="fa-solid fa-filter me-2"></i>Filter
                                </a>
                            </div>
                        </div>
                        <div class="col col-lg-2 col-6 order-lg-2">
                            <!-- Sort By -->
                            <div class="position-relative listing_sort ms-auto">
                                <select class="form-select mb-0" id="sorting" onchange="updateSortFields()" >
                                    <option selected>Relevance</option>
                                    <option value="price-asc" {{ isset($input['sort_by']) && $input['sort_by'] == 'price' && isset($input['sort_order']) && $input['sort_order'] == 'asc' ? 'selected' : '' }}>Price - Low to High</option>
                                    <option value="price-desc" {{ isset($input['sort_by']) && $input['sort_by'] == 'price' && isset($input['sort_order']) && $input['sort_order'] == 'desc' ? 'selected' : '' }}>Price - High to Low</option>
                                    <option value="miles-asc" {{ isset($input['sort_by']) && $input['sort_by'] == 'miles' && isset($input['sort_order']) && $input['sort_order'] == 'asc' ? 'selected' : '' }}>Miles - Low to High</option>
                                    <option value="miles-desc" {{ isset($input['sort_by']) && $input['sort_by'] == 'miles' && isset($input['sort_order']) && $input['sort_order'] == 'desc' ? 'selected' : '' }}>Miles - High to Low</option>
                                    <option value="year-asc" {{ isset($input['sort_by']) && $input['sort_by'] == 'year' && isset($input['sort_order']) && $input['sort_order'] == 'asc' ? 'selected' : '' }}>Year - Low to High</option>
                                    <option value="year-desc" {{ isset($input['sort_by']) && $input['sort_by'] == 'year' && isset($input['sort_order']) && $input['sort_order'] == 'desc' ? 'selected' : '' }}>Year - High to Low</option>
                                    <option value="dom-asc" {{ isset($input['sort_by']) && $input['sort_by'] == 'dom' && isset($input['sort_order']) && $input['sort_order'] == 'asc' ? 'selected' : '' }}>Latest Cars</option>
                                    <option value="dom-desc" {{ isset($input['sort_by']) && $input['sort_by'] == 'dom' && isset($input['sort_order']) && $input['sort_order'] == 'desc' ? 'selected' : '' }}>Oldest Cars</option>
                                </select>
                            </div>
                        </div>
                        <div class="col col-lg-10 col-12 order-lg-1">
                            <!-- Filter Tags -->
                            <div class="tags-container">
                                <form id="filter-form" action="{{ route('source.vechile',['name'=>$input['name'] ??'' ,'source'=>$input['source'] ??'']) }}" method="GET">
                                    @foreach ($input as $key => $value)
                                        @if (is_array($value))
                                            @foreach ($value as $item)
                                                @if(in_array($key,['latitude','country','longitude','zip','radius','page','min','max','sort_by','sort_order','dom_range','years','year']))
                                                   

                                                @else
                                                <span class="tag">
                                                {{ ucwords(str_replace('_',' ',$key)) }} {{ $item }}
                                                    <a href="javascript:void(0);" class="tag-remove" data-key="{{ $key }}" data-value="{{ $item }}">
                                                        &times;
                                                    </a>
                                                </span>
                                                @endif
                                            @endforeach
                                        @elseif (!empty($value))
                                            @php $show =1; 
                                                $showvalue = $value;
                                                if(in_array($key,['latitude','country','name','source','longitude','zip','radius','page','min','max','sort_by','sort_order','dom_range','years','year'])){
                                                    $show =0; 

                                                }
                                                if($key=='price_range')
                                                {
                                                    $array = explode('-',$value);
                                                    $showvalue = '$'.$array[0]. ' to '.$array[1];
                                                }
                                            #dd($key,$show,$showvalue)
                                            
                                            @endphp
                                            <span class="tag" @if($show == 0) style= "display:none;"  @endif >
                                            @if(!in_array($key,['Latest','Popular','zip','radius','page','sort_by','sort_order','dom_range']))
                                            {{ ucwords(str_replace('_',' ',$key)) }}
                                            @endif
                                            @if($showvalue  =='Popular')
                                                {{ 'Featured' }}
                                            @else
                                            {{ $showvalue }}
                                            @endif
                                                <a href="javascript:void(0);" class="tag-remove" data-key="{{ $key }}" data-value="{{ $value }}">
                                                    &times;
                                                </a>
                                            </span>
                                        @endif
                                    @endforeach
                                </form>
                            </div>
                        </div>
                    </div>
                    
                    

                    
                </div>
                <div class="position-relative">
                    <!-- Car Lists -->
                    @if ($paginator->isEmpty())
                        <div class="no_cars_available py-5">
                            <p class="mb-0"><span>No Cars Available</span></p>
                        </div>
                    @else
                    <div class="row g-xl-3 g-2 g-lg-2">
                   
                            @foreach ($paginator->items() as $key => $item)
                                <div class="col col-lg-4 col-md-6 col-6">
                                    @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
                                </div>
                                
                        @endforeach
                        
                    </div>
                    @endif

                    <!-- Cars by Price & Ads -->
                    <div class="row my-3 justify-content-center">
                        <!-- <div class="col col-lg-8 col-md-6 col-12">
                            <div class="filterbox_bg listing_byprice bg_light p-3">
                                <div class="tab_content_head">
                                    <h3>Cars by Price</h3>
                                </div>
                                <div class="position-relative">

                                    <div class="row g-xl-3 g-2">
                                        @foreach($price_range as $key =>$value)
                                        @php 
                                        if($value=='0-10000'){
                                            $start =$rangevaue ="Under $10000";
                                           
                                        }elseif($value=='70000-1000000000')
                                            $rangevaue ="Above $70000";
                                        else
                                            $rangevaue ='$'.$value;
                                        @endphp
                                        <div class="col col-lg-4 col-6" >
                                            <div class="price_tab">
                                                <input type="radio" class="btn-check price_range_tab" name="price" value="{{ $value }}" id="price{{ $value }}" autocomplete="off" @if(isset($input['price_range']) && ($input['price_range'] ==$value)) checked @endif >
                                                <label class="btn btn-sm" for="price{{ $value }}"> {{ $rangevaue }} </label>
                                            </div>
                                        </div>
                                        @endforeach
                                        

                                    </div>
                                </div>
                            </div>
                        </div>-->

                        
                        <!-- Ad (728px x 90px) Card 2-->
                        <div class="col col-lg-4 col-md-6 col-12 ads">
                            <div class="position-relative text-center">
                                @if(isset($slot2['code'])) 
                                    {!! $slot2['code'] !!}
                                @endif
                            </div>
                        </div>

                    </div>

                </div>
                <div class="position-relative pagination_main">
                    {{ $paginator->onEachSide(1)->links('pagination::bootstrap-4') }}
                    
                </div>

            </div>
        </div>
    </div>
    
</section>

<!-- Loader -->
<div id="loader-overlay" class="loader-overlay" style="dispaly:none;">
    <div class="loader_inn">
        <i class="fa-duotone fa-tire"></i>
    </div>
</div>
@endsection 

@push ('after-scripts')
<script>
     const loaderOverlay = document.getElementById("loader-overlay");
// Range Slider
window.onload = function () {
   // slideOne();
   // slideTwo();
};
document.addEventListener("DOMContentLoaded", function() {
    var form = document.getElementById("searchinput");

    // Add click event listeners to all checkboxes
    var checkboxes = form.querySelectorAll("input[type='checkbox']");
    checkboxes.forEach(function(checkbox) {
        checkbox.addEventListener("click", function() {
            $(loaderOverlay).show()
            form.submit();
        });
    });

    // Add change event listeners to all select boxes
    var selects = form.querySelectorAll("select");
    selects.forEach(function(select) {
        select.addEventListener("change", function() {
            $(loaderOverlay).show()
            form.submit();
        });
    });
});
$('#sorting').change(function(){
   sortvalue =  $('#sorting').value();
})
function updateSortFields() {
    // Get the selected value from the dropdown
    const sortingDropdown = document.getElementById('sorting');
    const selectedValue = sortingDropdown.value;

    // Split the value into two parts (e.g., "price-asc" becomes ["price", "asc"])
    let [sort_by, sort_order] = selectedValue.split('-');

    // Handle special cases (e.g., "Newest" option with value "1")
    if (selectedValue === '1') {
        sort_by = 'date';
        sort_order = 'desc';
    }

    // Set the values in the corresponding input fields
    document.getElementById('sort_by').value = sort_by || '';
    document.getElementById('sort_order').value = sort_order || '';

    var form = document.getElementById("searchinput");
    $(loaderOverlay).show()
    form.submit();
}

function makepricerange(){
        let sliderOneValue = document.getElementById('minPrice').value.replace(/\$/g, '').replace(/,/g, '');
        let sliderTwoValue = document.getElementById('maxPrice').value.replace(/\$/g, '').replace(/,/g, '');

        // Create a string that represents the price range
        let priceRange = `${sliderOneValue} - ${sliderTwoValue}`;
        $('#price_range').val(priceRange);
        var form = document.getElementById("searchinput");
        $(loaderOverlay).show()
        form.submit();
}
function makeyearrange(){
        let minyear = document.getElementById('minYear').value.replace(/\$/g, '').replace(/,/g, '');
        let maxyear = document.getElementById('maxYear').value.replace(/\$/g, '').replace(/,/g, '');

        // Create a string that represents the price range
        let year_range = `${minyear} - ${maxyear}`;
        $('#year_range').val(year_range);
        var form = document.getElementById("searchinput");
        $(loaderOverlay).show()
        form.submit();
}

function makemileagerange(){
        let miles_start = document.getElementById('minMileage').value.replace(/\$/g, '').replace(/,/g, '');
        let miles_end = document.getElementById('maxMileage').value.replace(/\$/g, '').replace(/,/g, '');

        // Create a string that represents the price range
        let miles_range = `${miles_start} - ${miles_end}`;
        $('#miles_range').val(miles_range);
        var form = document.getElementById("searchinput");
        $(loaderOverlay).show()
        form.submit();
}
$('.price_range_tab').click(function(){
    let priceRange =$(this).val();
    $('#price_range').val(priceRange);
    var form = document.getElementById("searchinput");
    $(loaderOverlay).show()
    form.submit();
})

function getlatlong()
{
    if($('#zip').valid() && $('#radius').valid() ){
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

                        $('#latitude').val(lat);
                        $('#longitude').val(lng);
                       
                        $('#country').val('US');
                       
                    }
                    var form = document.getElementById("searchinput");
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
    }


}


document.querySelectorAll('input[name="car_type"]').forEach((elem) => {
    elem.addEventListener("change", function() {
        var form = document.getElementById("searchinput");
        form.submit();
    });
});

    // script.js
document.addEventListener("DOMContentLoaded", function() {
    // Hide the loader overlay and show the content once the page has fully loaded
   
    //const content = document.getElementById("content");
    $(loaderOverlay).show()
    // Simulate loading delay
    setTimeout(() => {
        loaderOverlay.style.display = "none";
       // content.style.display = "block";
    }, 500); // Adjust the delay as needed
});
</script>
<script>
    document.addEventListener('DOMContentLoaded', function() {
        const tagRemoveLinks = document.querySelectorAll('.tag-remove');
        
        tagRemoveLinks.forEach(function(link) {
            link.addEventListener('click', function() {
                const key = this.getAttribute('data-key');
                const value = this.getAttribute('data-value');

                // Create a form element to submit with the updated parameters
                const form = document.createElement('form');
                form.method = 'GET';
                form.action = '{{ route('source.vechile') }}';
                
                // Add existing parameters except the one to be removed
                const urlParams = new URLSearchParams(window.location.search);
                urlParams.delete(key); // Remove the key first to handle multiple values correctly
                
                urlParams.forEach((v, k) => {
                    if (k === key && Array.isArray(urlParams.getAll(k))) {
                        urlParams.getAll(k).forEach(val => {
                            if (val !== value) {
                                const input = document.createElement('input');
                                input.type = 'hidden';
                                input.name = k + '[]';
                                input.value = val;
                                form.appendChild(input);
                            }
                        });
                    } else if (v !== value) {
                        const input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = k;
                        input.value = v;
                        form.appendChild(input);
                    }
                });

                document.body.appendChild(form);
                $(loaderOverlay).show()
                form.submit();
            });
        });
    });
</script>

<script src="https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.5.0/nouislider.min.js"></script>
    <script>
    var  firsttime =0;
    min = parseInt('{{ $slider1Value }}');
    max =parseInt('{{ $slider2Value }}');

    miles_start = parseInt('{{ $miles_start }}');
    miles_end =parseInt('{{ $miles_end }}');

    min_year = parseInt('{{ $min_year }}');
    max_year =parseInt('{{ $max_year }}');
    document.addEventListener('DOMContentLoaded', function() {
    var priceSlider = document.getElementById('priceRange');
    mileageSlider = document.getElementById('mileageRange');
    yearSlider = document.getElementById('yearRange');

    noUiSlider.create(priceSlider, {
        start: [min, max],
        connect: true,
        range: {
            'min': 0,
            'max': 10000000
        },
        format: {
            to: function(value) {
                return '$' + Math.round(value).toLocaleString();
            },
            from: function(value) {
                return Number(value.replace('$', '').replace(',', ''));
            }
        }
    });

    var minPriceInput = document.getElementById('minPrice');
    var maxPriceInput = document.getElementById('maxPrice');

    priceSlider.noUiSlider.on('update', function(values, handle) {
        if (handle === 0) {
            minPriceInput.value = values[handle];
        } else {
            maxPriceInput.value = values[handle];
        }
        if(firsttime>1){
             
           // makepricerange();
        }
        firsttime++;
        //
       
    });

    minPriceInput.addEventListener('change', function() {
        priceSlider.noUiSlider.set([this.value.replace('$', '').replace(',', ''), null]);
    });

    maxPriceInput.addEventListener('change', function() {
        priceSlider.noUiSlider.set([null, this.value.replace('$', '').replace(',', '')]);
    });
});

// Year
document.addEventListener('DOMContentLoaded', function() {
       

        noUiSlider.create(yearSlider, {
            start: [min_year, max_year],
            connect: true,
            range: {
                'min': 1982,
                'max': 2024
            },
            format: {
                to: function(value) {
                    return '' + Math.round(value);
                },
                from: function(value) {
                    return '' + Math.round(value);
                }
            }
        });

        var minYearInput = document.getElementById('minYear');
        var maxYearInput = document.getElementById('maxYear');

        yearSlider.noUiSlider.on('update', function(values, handle) {
            if (handle === 0) {
                minYearInput.value = values[handle];
            } else {
                maxYearInput.value = values[handle];
            }
        });

        minYearInput.addEventListener('change', function() {
            yearSlider.noUiSlider.set([this.value.replace('', '').replace(',', ''), null]);
        });

        maxYearInput.addEventListener('change', function() {
            yearSlider.noUiSlider.set([null, this.value.replace('', '').replace(',', '')]);
        });
    });

    // Mileage
    document.addEventListener('DOMContentLoaded', function() {
       
        noUiSlider.create(mileageSlider, {
            start: [miles_start, miles_end],
            connect: true,
            range: {
                'min': 0,
                'max': 1000000
            },
            format: {
                to: function(value) {
                    return '' + Math.round(value).toLocaleString();
                },
                from: function(value) {
                    return Number(value.replace('', '').replace(',', ''));
                }
            }
        });

        var minMileageInput = document.getElementById('minMileage');
        var maxMileageInput = document.getElementById('maxMileage');

        mileageSlider.noUiSlider.on('update', function(values, handle) {
            if (handle === 0) {
                minMileageInput.value = values[handle];
            } else {
                maxMileageInput.value = values[handle];
            }
        });

        minMileageInput.addEventListener('change', function() {
            mileageSlider.noUiSlider.set([this.value.replace('', '').replace(',', ''), null]);
        });

        maxMileageInput.addEventListener('change', function() {
            mileageSlider.noUiSlider.set([null, this.value.replace('', '').replace(',', '')]);
        });
    });

    </script>

@endpush