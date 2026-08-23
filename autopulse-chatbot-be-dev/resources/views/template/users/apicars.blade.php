<div class="row gx-2">
    <div class="col col-12 explore_filters_col">               
        <div class="position-relative explore_filters">
            <div class="offcanvas-collapse">
                <div class="position-relative listing_filter_close">
                    <button type="button" class="btn-close listing_filter_collapse"></button>
                </div>
                <div class="filter_head_reset">
                    <div class="filter_head">
                        <i class="fa-solid fa-filter me-2"></i><span>Filter</span>
                    </div>
                  
                    <div class="reset_filter">
                        <a href="{{ route('vechile') }} "><small><i class="fa-sharp fa-solid fa-rotate-left me-2"></i>Reset</small></a>
                    </div>
                </div>
                <form action="" id="searchinput" class=" ">
                  
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
                        <input type="hidden" name="source" value="{{ $input['source']??NULL }}" >
                    </div>

                    <!-- Certified Checkbox -->
                    <div class="position-relative">
                        <ul class="checkbox_list p-0 mb-2">
                            <li class="form-check">
                                <input class="form-check-input" type="checkbox" id="certified_chk" value="1" name="is_certified" @if(isset($input['is_certified']) && ($input['is_certified']==1)) checked @endif>
                                <label class="form-check-label" for="certified_chk"><span>Certified<svg class="ms-1 certified_yellow" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffd43b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-award"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg></span></label>
                            </li>                        
                        </ul>
                    </div>

                 
                    {{--<!--div class="listing_filter_form filterbox_bg">
                        <div class="position-relative zip_rad_filter">
                            <div class=" row g-xl-3 g-2">
                                <div class="col col-md-6 col-6">
                                    <label for="">ZIP</label>
                                  
                                    <input type="text" id="zip" name="zip" value="{{ $input['zip']??NULL }}" class="form-control required" placeholder="">
                                    <input type="hidden" id="latitude" name="latitude"  value="{{ $input['latitude']??NULL }}" class="form-control" placeholder="">
                                    <input type="hidden" id="longitude" name="longitude"  value="{{ $input['longitude']??NULL }}"  class="form-control" placeholder="">
                                    <input type="hidden" id="country" name="country"  value="{{ $input['country']??NULL }}"  class="form-control" placeholder="">
                                </div>
                                <div class="col col-md-6 col-6">
                                    <label for="">Radius (miles)</label>
                                    <input type="text" id="radius" name="radius"   value="{{ $input['radius']??NULL }}" class="form-control required" placeholder="">
                                </div>
                                <div class="col col-md-12 col-12 mt-0">
                                    <div class="position-relative text-center">
                                        <button type="button" onclick="getlatlong()" class="btn btn_theme">Search</button>
                                    </div>
                                </div> 
                            </div> 
                        </div>
                    </div--> --}}
                    

               
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
                                    <button type="button" data-action="makeyearrange" class="btn_chatbx_fill">Apply</button>
                            </div>
                        </div>
                    </div>

                     
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
                                    <button type="button" data-action="makepricerange" class="btn_chatbx_fill">Apply</button>
                            </div>

                        </div>
                        
                    </div>

                 
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
                                    <button type="button" data-action="makemileagerange" class="btn_chatbx_fill">Apply</button>
                            </div>
                        </div>
                    </div>

                   
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
                                    @php 
                                        if (empty($item['item'])) continue;
                                    @endphp
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
                                    @php 
                                        if (empty($item['item'])) continue;
                                    @endphp
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
                                    @php 
                                        if (empty($item['item'])) continue;
                                    @endphp
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
                                    @php 
                                        if (empty($item['item'])) continue;
                                    @endphp
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
                                    @php 
                                        if (empty($item['item'])) continue;
                                    @endphp
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
                                    @php 
                                        if (empty($item['item'])) continue;
                                    @endphp
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
                                    @php 
                                        if (empty($item['item'])) continue;
                                    @endphp
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
                                                   
                                                    <img src="{{ $bodyTypeImagePath }}" alt="{{ $itemName }}">
                                                </span>
                                                {{ $itemName }}
                                            </span>
                                          
                                            <span class="filter_count">{{ $facetItem['count'] }}</span>
                                        </label>

                                        </li>
                                    @endforeach

                                
                            </ul>
                        </div>
                    </div>

                    

                    
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
                   
                  
                    <input type="hidden" name="sort_by" id="sort_by" value="{{ $input['sort_by'] ?? ''}}" >
                    <input type="hidden" name="sort_order" id="sort_order" value="{{ $input['sort_order'] ?? ''}}">
                    <input type="hidden" name="price_range" id="price_range" value="{{ $input['price_range'] ?? ''}}">
                    <input type="hidden" name="miles_range" id="miles_range" value="{{ $input['miles_range'] ?? ''}}">
                    <input type="hidden" name="year_range" id="year_range" value="{{ $input['year_range'] ?? ''}}">
                </form>
            </div>

        </div>
    </div>
    <div class="col col-12 explore_list_col">
        <div class="position-relative p-2">
            <a class="listing_cars_back"><span class="head_icon me-1"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-arrow-left"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg></span>Back</a>
        </div>
        <div class="position-relative explore_list pt-0">
            <div class="position-relative listing_filter_sort">
                           
            </div>
            <div class="position-relative">
                <!-- Car Lists -->
                @if ($paginator->isEmpty())
                    <div class="no_cars_available py-5">
                        <p class="mb-0"><span>No Cars Available</span></p>
                    </div>
                @else
                <div class="row g-2 m-0">            
                        @foreach ($paginator->items() as $key => $item)
                            <div class="col col-12 chatbx_card_col">
                                @include('template.users.include.chat_vehicle_item',['class'=>'','item'=>$item])
                            </div>                            
                        @endforeach                    
                </div>
                @endif

                <!-- Cars by Price & Ads -->
                <div class="row my-3 justify-content-center">
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

<!-- Loader -->
