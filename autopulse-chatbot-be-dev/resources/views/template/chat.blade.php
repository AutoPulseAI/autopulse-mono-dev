<!-- Range Slider Css -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.5.0/nouislider.min.css">

<div class="position-relative chatboxAi">
    <div class="chatboxO">
        <div class="banner_chatbox_o">
            <a class="chatboxO_a">
                <span class="banner_chatbox_text">Ask a question with Autopulse</span>
                <span class="banner_chatbox_icon">
                    <img src="./assets/images/chatbxSearch.png" alt="chat" class="img-fluid">
                    <!-- <i class="fa-regular fa-magnifying-glass"></i> -->
                </span>
            </a>
        </div>
    </div>

    <!-- <div class="chatbx_main chat_open collapsed"> -->
    <div class="chatbx_main">

        <!-- Left Card -->
        <div class="chatbx_secondary chatbx_car_details">            
            <!-- Full Details -->
             <!-- * chatbxdetails_show class used to view full details * -->
            <div class="chatbx_fulldetail_info chatbxdetails_show">
                <div class="position-relative chatbx_req_info_inn">
                    <div class="chatbx_subhead position-relative py-0 px-0">
                        <a class="chatbxfulldetail_show_btn ms-auto"><i class="fa-solid fa-chevron-down"></i></a>
                    </div>
                    <div class="row">
                        <div class="col col-12">
                            <div class="chatbx_detail_full">
                                <!--  -->
                                <div class="position-relative car_details_slider">
                                    <div class="main_slider">
                                        <!-- Favorite and share -->
                                        <div class="like_share_icon details_like_share">
                                            <div class="form-check fevCheck me-auto">
                                                <input type="checkbox" class="form-check-input" id="btn-check_1"  onclick="makeFavourite(this,'1','1','')">
                                                <label class="form-check-label" for="btn-check_1"><i class="fas fa-heart" id="heart-icon_1"></i></label>
                                            </div>

                                            <!-- Share Icon -->
                                            <div class="share_icon">
                                                <i class="fa-regular fa-share-from-square"  onclick="showSharePopup(`1`, '1,1', '2020 test modal123')"></i>
                                            </div>
                                        </div>
                                        
                                        <!-- All photos -->
                                        <div class="view_all_photos">
                                            <a class="all_photos">All Photos</a>
                                        </div>
                                        <div id="big" class="owl-carousel owl-theme">                           
                                            <div class="item">
                                                <a href="./assets/images/newjeep.jpg" data-lightbox="gallery" data-title="2024 Ford F-150">
                                                <img src="./assets/images/newjeep.jpg" alt="car">
                                                </a>
                                            </div>
                                            <div class="item">
                                                <a href="./assets/images/newjeep.jpg" data-lightbox="gallery" data-title="2024 Ford F-150">
                                                <img src="./assets/images/newjeep.jpg" alt="car">
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                    <!-- Thumbnails -->
                                    <div id="thumbs" class="owl-carousel owl-theme thumbnail_imgs">                         
                                        <div class="item">
                                            <img src="./assets/images/newjeep.jpg" alt="car">
                                        </div> 
                                        <div class="item">
                                            <img src="./assets/images/newjeep.jpg" alt="car">
                                        </div>                        
                                    </div>
                                </div>
                                <!--  -->

                                <div class="car_details_right_top mb-2">
                                    <div class="car_details_right_inn">
                                        <div class="car_details_spec">
                                            <span class="car_year">New</span>
                                            <div class="position-relative ms-auto">
                                                <div class="car_loc ms-0 w-100">
                                                    <i class="fa-solid fa-location-dot me-2"></i><span>Manteo , NC</span>
                                                </div>
                                                <!-- <div class="car_loc ms-0 w-100 mt-1">
                                                    <a href="tel:0000000000" class="btn btn_blue ms-auto">
                                                        <i class="fa-solid fa-phone me-2"></i><span>0000000000</span>
                                                    </a>
                                                </div>                            -->
                                            </div>                              
                                        </div>
                                        <div class="car_title_price_specs">
                                            <h4>2024 Ford F-150</h4>
                                            <div class="car_spec_short">
                                                <span>N/A Miles</span>&nbsp;|&nbsp;                                                    
                                                <span>Unleaded</span>&nbsp;|&nbsp;
                                                <span>Automatic</span>
                                            </div>
                                            <div class="price_sms d-flex align-items-center mb-3">
                                                <h5 class="mb-0">$000</h5>
                                                <!-- <h5 class="mb-0">N/A</h5> -->
                                                <a href="sms:+13307158162&&body={{ urlencode(url()->full()) }}" id="share-sms" class="d-md-none btn btn_blue ms-auto">
                                                    <i class="fa-solid fa-comment me-1"></i><span>Text Message</span>
                                                </a>                                                    
                                            </div>                                                  
                                        </div>
                                        <a href="javascript:;" class="btn btn_theme w-100" onclick="triggerViewdetail()">Request Contact from Dealer</a>
                                    </div>    
                                    <div class="btm_gray">
                                        <!-- <p><small>Lorem Ipsum is simply dummy text of the printing</small></p> -->
                                    </div>
                                </div>
                                <!--  -->
                                <div class="details_tab_content details_overview">
                                    <div class="tab_content_head">
                                        <h3>Request Information</h3>
                                    </div>
                                    <div class="details_req_info">
                                        <form action="" id="validaterequest">
                                            <p><span>Hello, my name is</span>
                                            <input type="hidden" name="vid" id="vid"  value="" >
                                            <input type="text" name="name" id="name" value="{{ auth()->user()->name ??'' }}" placeholder="First Name" class="req_in_border required req_in_wsm">
                                            
                                            <span>and I'm interested in this</span> 
                                            <span><b class="car_title"> s</b>. I'm in the</span>&nbsp;
                                            <input type="text"  placeholder="Zip code" name="zip_code" id="zip_code" class="req_in_border required req_in_wsm">
                                            <span>area. You can reach me by email at</span>&nbsp;
                                            <input type="text" name="email"  placeholder="Email"  value="{{ auth()->user()->email ??'' }}" class="req_in_border required email w-75">
                                            <span>or by phone at</span>&nbsp;
                                            <input type="text" name ="phone_number" placeholder="Phone" value="{{ auth()->user()->phone_number??'' }}" class="req_in_border required">
                                            <span>Thank you!</span></p>

                                            <a class="btn_chatbx_fill w-100 mt-2" onclick="saverequest()">Send</a>
                                        </form>
                                    </div>
                                </div>
                                <!--  -->
                                <!-- Tabs -->
                                <div class="details_info_tabs" id="details_info_tabs">
                                    <a class="overviewtab">Overview</a>
                                    <a class="specificationstab">Specifications</a>
                                    <a class="featurestab">Features</a>
                                </div>
                            
                                <!-- Overview -->
                                <div class="details_tab_content details_overview" id="overview">
                                    <div class="tab_content_head">
                                        <h3>Overview</h3>
                                    </div>
                                    <div class="specs_list">
                                        <ul class="row">
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>VIN</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                        <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Year</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Make</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Model</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Trim</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Engine</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Transmission</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Body type</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
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
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Exterior Color</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Interior Color</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Vehicle Type</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Drive Train</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>

                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Fuel Type</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>

                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Engine Size</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Doors</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Cylinders</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Heigth</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Length</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
                                                    </div>
                                                </div>                                
                                            </li>
                                            <li class="col col-12">
                                                <div class="row g-0">
                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                        <p>Width</p>
                                                    </div>
                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>test</p>
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
                                        
                                        <div class="accordion-item">
                                            <!-- Heading -->
                                            <h2 class="accordion-header" id="exterior-heading">
                                                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#features" aria-expanded="true" aria-controls="">key</button>
                                            </h2>
                                            <!-- body -->
                                            <div id="features" class="accordion-collapse collapse show" aria-labelledby="exterior-heading" data-bs-parent="#detailedFeatures">
                                                <div class="accordion-body">
                                                    <div class="features_list">
                                                        <ul class="row">
                                                            <li class="col col-12">
                                                                <div class="feature_inn">
                                                                    <p><i class="fa-regular fa-circle-check me-2"></i>Test</p>
                                                                </div>
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="feature_inn">
                                                                    <p><i class="fa-regular fa-circle-check me-2"></i>Test</p>
                                                                </div>
                                                            </li>
                                                            
                                                        </ul>
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

        <!-- Main Card -->
        <div class="chatbx_primary">
            <!-- Header -->
            <div class="chatbx_head">   
                <div class="hisbar"></div>         
                <img src="{{ asset('assets/images/auto/auto_ai.png') }}" alt="img" class="me-auto">
                <a class="full_screen ms-3"><i class="fa-solid fa-expand"></i></a>
                <a class="mini_a ms-3"><i class="fa-solid fa-minus"></i></a>
                <a class="ms-3 chatboxO_a"><i class="fa-solid fa-xmark"></i></a>
            </div>

            <!-- Chat Window -->
            <div class="chatbx_window">
                <!-- Scrollable Chat Box -->
                <div class="chatbx_response">
                    <div class="chatbx_msg_l"><small>Hello, my name is <b>Autopulse</b>, your AI auto concierge.How can I help you?</small></div>
                </div>

                <!-- Dealer Details -->
                <!-- <div class="userinfo_forms" style="display: none;">
                    <div class="chatbx_userinfo_form w-100">
                        <div class="position-relative text-center mb-3">
                            <h5><b>Dealer Details</b></h5>
                        </div>
                        <form action=""> 
                            <div class="row g-2">
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="" id="" type="text" class="form-control required" placeholder="Chatbot Name*">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative d-flex align-items-center">
                                        <label for="formFile" class="form-label mb-0 me-2">Logo*:</label>
                                        <input class="form-control" type="file" id="formFile">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative d-flex align-items-center">
                                        <label for="formFile" class="form-label mb-0 me-2">Icon*:</label>
                                        <input class="form-control" type="file" id="formFile">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="" id="" type="text" class="form-control required" placeholder="Welcome Message*">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="" id="" type="text" class="form-control required" placeholder="Dealership Url*">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="" id="" type="text" class="form-control required" placeholder="Dealership Name*">
                                    </div>
                                </div>

                                <div class="position-relative">
                                    <button type="button" id="dealerSubmit" class="btn btn_theme w-100" >Submit</button>
                                </div>                            
                            </div>                            
                        </form>
                    </div>                   
                </div> -->

                <!-- Explore more -->
                 <!-- * Use display: none for hide explore more * -->
                <div class="position-relative explore_main">
                    <div class="row gx-2">
                        <div class="col col-12 explore_filters_col">
                            <div class="position-relative explore_filters">
                                <!-- explore filter -->
                                <div class="offcanvas-collapse">
                                    <div class="position-relative listing_filter_close">
                                        <button type="button" class="btn-close listing_filter_collapse"></button>
                                    </div>
                                    <div class="filter_head_reset">
                                        <div class="filter_head">
                                            <i class="fa-solid fa-filter me-2"></i><span>Filter</span>
                                        </div>
                                        <!-- Reset Filters -->
                                        <div class="reset_filter">
                                            <a href="https://autopulse.ai/vehicle "><small><i class="fa-sharp fa-solid fa-rotate-left me-2"></i>Reset</small></a>
                                        </div>
                                    </div>
                                    <form action="" id="searchinput" class=" " cr-attached="true">
                                        <!-- Filter by All, New, Used -->
                                        
                                        <div class="listing_filter_btns">
                                            <div class="position-relative">
                                                <input type="radio" class="btn-check" name="car_type" id="all" value="">
                                                <label class="btn" for="all">All</label>
                                            </div>
                                            <div class="position-relative">
                                                <input type="radio" class="btn-check" name="car_type" id="new" value="new">
                                                <label class="btn" for="new">New</label>
                                            </div>
                                            <div class="position-relative">
                                                <input type="radio" class="btn-check" name="car_type" value="used" id="used">
                                                <label class="btn" for="used">Used</label>
                                            </div>
                                        </div>

                                        <!-- Filter by Zip and Radius -->
                                        <div class="listing_filter_form filterbox_bg">
                                            <div class="position-relative zip_rad_filter">
                                                <div class=" row g-xl-3 g-2">
                                                    <div class="col col-md-6 col-6">
                                                        <label for="">ZIP</label>
                                                        <input type="text" id="zip" name="zip" value="" class="form-control required" placeholder="">
                                                        <input type="hidden" id="latitude" name="latitude" value="" class="form-control" placeholder="">
                                                        <input type="hidden" id="longitude" name="longitude" value="" class="form-control" placeholder="">
                                                        <input type="hidden" id="country" name="country" value="" class="form-control" placeholder="">
                                                    </div>
                                                    <div class="col col-md-6 col-6">
                                                        <label for="">Radius (miles)</label>
                                                        <input type="text" id="radius" name="radius" value="50" class="form-control required" placeholder="">
                                                    </div>
                                                    <div class="col col-md-12 col-12 mt-0">
                                                        <div class="position-relative text-center">
                                                            <button type="button" onclick="getlatlong()" class="btn btn_theme">Search</button>
                                                        </div>
                                                    </div> 
                                                </div> 
                                            </div>
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
                                                                                        <div class="price-inputs">
                                                        <input type="text" value="0" id="minYear" placeholder="1982">
                                                        <span>to</span>
                                                        <input type="text" value="2024" id="maxYear" placeholder="2024">
                                                    </div>
                                                    <div id="yearRange" class="noUi-target noUi-ltr noUi-horizontal noUi-txt-dir-ltr"><div class="noUi-base"><div class="noUi-connects"><div class="noUi-connect" style="transform: translate(0%, 0px) scale(1, 1);"></div></div><div class="noUi-origin" style="transform: translate(-100%, 0px); z-index: 5;"><div class="noUi-handle noUi-handle-lower" data-handle="0" tabindex="0" role="slider" aria-orientation="horizontal" aria-valuemin="1982.0" aria-valuemax="2024.0" aria-valuenow="1982.0" aria-valuetext="1982"><div class="noUi-touch-area"></div></div></div><div class="noUi-origin" style="transform: translate(0%, 0px); z-index: 4;"><div class="noUi-handle noUi-handle-upper" data-handle="1" tabindex="0" role="slider" aria-orientation="horizontal" aria-valuemin="1982.0" aria-valuemax="2024.0" aria-valuenow="2024.0" aria-valuetext="2024"><div class="noUi-touch-area"></div></div></div></div></div>
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
                                                <div class="range_slider">
                                                    <div class="price-inputs">
                                                        <input type="text" id="minPrice" placeholder="$1,500">
                                                        <span>to</span>
                                                        <input type="text" id="maxPrice" placeholder="$150,000">
                                                    </div>
                                                    <div id="priceRange"></div>
                                                </div>

                                                <!-- <div class="range_slider mb-3">
                                                    <div class="price-inputs">
                                                        <input type="text" id="minPrice" value="0" placeholder="$1,500">
                                                        <span class="spanto">to</span>
                                                        <input type="text" id="maxPrice" value="100000000" placeholder="$150,000">
                                                    </div>
                                                    <div id="priceRange" class="noUi-target noUi-ltr noUi-horizontal noUi-txt-dir-ltr"><div class="noUi-base"><div class="noUi-connects"><div class="noUi-connect" style="transform: translate(0%, 0px) scale(1, 1);"></div></div><div class="noUi-origin" style="transform: translate(-100%, 0px); z-index: 5;"><div class="noUi-handle noUi-handle-lower" data-handle="0" tabindex="0" role="slider" aria-orientation="horizontal" aria-valuemin="0.0" aria-valuemax="10000000.0" aria-valuenow="0.0" aria-valuetext="$0"><div class="noUi-touch-area"></div></div></div><div class="noUi-origin" style="transform: translate(0%, 0px); z-index: 4;"><div class="noUi-handle noUi-handle-upper" data-handle="1" tabindex="0" role="slider" aria-orientation="horizontal" aria-valuemin="0.0" aria-valuemax="10000000.0" aria-valuenow="10000000.0" aria-valuetext="$10,000,000"><div class="noUi-touch-area"></div></div></div></div></div>
                                                
                                                </div> -->
                                            
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
                                                                        <div class="collapse" id="filterMileage">
                                                <div class="range_slider mb-3">
                                                    <div class="price-inputs">
                                                        <input type="text" value="0" id="minMileage" placeholder="1">
                                                        <span>to</span>
                                                        <input type="text" value="1000000" id="maxMileage" placeholder="1000000">
                                                    </div>
                                                    <div id="mileageRange" class="noUi-target noUi-ltr noUi-horizontal noUi-txt-dir-ltr"><div class="noUi-base"><div class="noUi-connects"><div class="noUi-connect" style="transform: translate(0%, 0px) scale(1, 1);"></div></div><div class="noUi-origin" style="transform: translate(-100%, 0px); z-index: 5;"><div class="noUi-handle noUi-handle-lower" data-handle="0" tabindex="0" role="slider" aria-orientation="horizontal" aria-valuemin="0.0" aria-valuemax="1000000.0" aria-valuenow="0.0" aria-valuetext="0"><div class="noUi-touch-area"></div></div></div><div class="noUi-origin" style="transform: translate(0%, 0px); z-index: 4;"><div class="noUi-handle noUi-handle-upper" data-handle="1" tabindex="0" role="slider" aria-orientation="horizontal" aria-valuemin="0.0" aria-valuemax="1000000.0" aria-valuenow="1000000.0" aria-valuetext="1,000,000"><div class="noUi-touch-area"></div></div></div></div></div>
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
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Ford" value="Ford" name="make[]">
                                                            <label class="form-check-label" for="Ford">
                                                            <span>Ford</span><span class="filter_count">847402</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Chevrolet" value="Chevrolet" name="make[]">
                                                            <label class="form-check-label" for="Chevrolet">
                                                            <span>Chevrolet</span><span class="filter_count">677023</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Toyota" value="Toyota" name="make[]">
                                                            <label class="form-check-label" for="Toyota">
                                                            <span>Toyota</span><span class="filter_count">453134</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Jeep" value="Jeep" name="make[]">
                                                            <label class="form-check-label" for="Jeep">
                                                            <span>Jeep</span><span class="filter_count">372452</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Nissan" value="Nissan" name="make[]">
                                                            <label class="form-check-label" for="Nissan">
                                                            <span>Nissan</span><span class="filter_count">338422</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Honda" value="Honda" name="make[]">
                                                            <label class="form-check-label" for="Honda">
                                                            <span>Honda</span><span class="filter_count">337388</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Hyundai" value="Hyundai" name="make[]">
                                                            <label class="form-check-label" for="Hyundai">
                                                            <span>Hyundai</span><span class="filter_count">301561</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="GMC" value="GMC" name="make[]">
                                                            <label class="form-check-label" for="GMC">
                                                            <span>GMC</span><span class="filter_count">245299</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="KIA" value="KIA" name="make[]">
                                                            <label class="form-check-label" for="KIA">
                                                            <span>KIA</span><span class="filter_count">232197</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="RAM" value="RAM" name="make[]">
                                                            <label class="form-check-label" for="RAM">
                                                            <span>RAM</span><span class="filter_count">231877</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Subaru" value="Subaru" name="make[]">
                                                            <label class="form-check-label" for="Subaru">
                                                            <span>Subaru</span><span class="filter_count">183468</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Mercedes-Benz" value="Mercedes-Benz" name="make[]">
                                                            <label class="form-check-label" for="Mercedes-Benz">
                                                            <span>Mercedes-Benz</span><span class="filter_count">170967</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Mazda" value="Mazda" name="make[]">
                                                            <label class="form-check-label" for="Mazda">
                                                            <span>Mazda</span><span class="filter_count">155573</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="BMW" value="BMW" name="make[]">
                                                            <label class="form-check-label" for="BMW">
                                                            <span>BMW</span><span class="filter_count">148701</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Volkswagen" value="Volkswagen" name="make[]">
                                                            <label class="form-check-label" for="Volkswagen">
                                                            <span>Volkswagen</span><span class="filter_count">142763</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Dodge" value="Dodge" name="make[]">
                                                            <label class="form-check-label" for="Dodge">
                                                            <span>Dodge</span><span class="filter_count">121514</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Audi" value="Audi" name="make[]">
                                                            <label class="form-check-label" for="Audi">
                                                            <span>Audi</span><span class="filter_count">92885</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Cadillac" value="Cadillac" name="make[]">
                                                            <label class="form-check-label" for="Cadillac">
                                                            <span>Cadillac</span><span class="filter_count">83862</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Lexus" value="Lexus" name="make[]">
                                                            <label class="form-check-label" for="Lexus">
                                                            <span>Lexus</span><span class="filter_count">82293</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Buick" value="Buick" name="make[]">
                                                            <label class="form-check-label" for="Buick">
                                                            <span>Buick</span><span class="filter_count">81542</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Lincoln" value="Lincoln" name="make[]">
                                                            <label class="form-check-label" for="Lincoln">
                                                            <span>Lincoln</span><span class="filter_count">66129</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Volvo" value="Volvo" name="make[]">
                                                            <label class="form-check-label" for="Volvo">
                                                            <span>Volvo</span><span class="filter_count">59329</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Acura" value="Acura" name="make[]">
                                                            <label class="form-check-label" for="Acura">
                                                            <span>Acura</span><span class="filter_count">52758</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Chrysler" value="Chrysler" name="make[]">
                                                            <label class="form-check-label" for="Chrysler">
                                                            <span>Chrysler</span><span class="filter_count">50371</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Land_Rover" value="Land Rover" name="make[]">
                                                            <label class="form-check-label" for="Land_Rover">
                                                            <span>Land Rover</span><span class="filter_count">42869</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="INFINITI" value="INFINITI" name="make[]">
                                                            <label class="form-check-label" for="INFINITI">
                                                            <span>INFINITI</span><span class="filter_count">36667</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Mitsubishi" value="Mitsubishi" name="make[]">
                                                            <label class="form-check-label" for="Mitsubishi">
                                                            <span>Mitsubishi</span><span class="filter_count">35278</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Porsche" value="Porsche" name="make[]">
                                                            <label class="form-check-label" for="Porsche">
                                                            <span>Porsche</span><span class="filter_count">35123</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Genesis" value="Genesis" name="make[]">
                                                            <label class="form-check-label" for="Genesis">
                                                            <span>Genesis</span><span class="filter_count">30519</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="MINI" value="MINI" name="make[]">
                                                            <label class="form-check-label" for="MINI">
                                                            <span>MINI</span><span class="filter_count">21247</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Tesla" value="Tesla" name="make[]">
                                                            <label class="form-check-label" for="Tesla">
                                                            <span>Tesla</span><span class="filter_count">14636</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Jaguar" value="Jaguar" name="make[]">
                                                            <label class="form-check-label" for="Jaguar">
                                                            <span>Jaguar</span><span class="filter_count">9799</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Alfa_Romeo" value="Alfa Romeo" name="make[]">
                                                            <label class="form-check-label" for="Alfa_Romeo">
                                                            <span>Alfa Romeo</span><span class="filter_count">7517</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Maserati" value="Maserati" name="make[]">
                                                            <label class="form-check-label" for="Maserati">
                                                            <span>Maserati</span><span class="filter_count">5876</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="FIAT" value="FIAT" name="make[]">
                                                            <label class="form-check-label" for="FIAT">
                                                            <span>FIAT</span><span class="filter_count">4064</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Isuzu" value="Isuzu" name="make[]">
                                                            <label class="form-check-label" for="Isuzu">
                                                            <span>Isuzu</span><span class="filter_count">3832</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Bentley" value="Bentley" name="make[]">
                                                            <label class="form-check-label" for="Bentley">
                                                            <span>Bentley</span><span class="filter_count">3595</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Pontiac" value="Pontiac" name="make[]">
                                                            <label class="form-check-label" for="Pontiac">
                                                            <span>Pontiac</span><span class="filter_count">3577</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Scion" value="Scion" name="make[]">
                                                            <label class="form-check-label" for="Scion">
                                                            <span>Scion</span><span class="filter_count">2990</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Ferrari" value="Ferrari" name="make[]">
                                                            <label class="form-check-label" for="Ferrari">
                                                            <span>Ferrari</span><span class="filter_count">2555</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Mercury" value="Mercury" name="make[]">
                                                            <label class="form-check-label" for="Mercury">
                                                            <span>Mercury</span><span class="filter_count">2048</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="HUMMER" value="HUMMER" name="make[]">
                                                            <label class="form-check-label" for="HUMMER">
                                                            <span>HUMMER</span><span class="filter_count">1907</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Lamborghini" value="Lamborghini" name="make[]">
                                                            <label class="form-check-label" for="Lamborghini">
                                                            <span>Lamborghini</span><span class="filter_count">1732</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Saturn" value="Saturn" name="make[]">
                                                            <label class="form-check-label" for="Saturn">
                                                            <span>Saturn</span><span class="filter_count">1672</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Rolls-Royce" value="Rolls-Royce" name="make[]">
                                                            <label class="form-check-label" for="Rolls-Royce">
                                                            <span>Rolls-Royce</span><span class="filter_count">1634</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Aston_Martin" value="Aston Martin" name="make[]">
                                                            <label class="form-check-label" for="Aston_Martin">
                                                            <span>Aston Martin</span><span class="filter_count">1412</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="McLaren" value="McLaren" name="make[]">
                                                            <label class="form-check-label" for="McLaren">
                                                            <span>McLaren</span><span class="filter_count">877</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Ineos" value="Ineos" name="make[]">
                                                            <label class="form-check-label" for="Ineos">
                                                            <span>Ineos</span><span class="filter_count">810</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Suzuki" value="Suzuki" name="make[]">
                                                            <label class="form-check-label" for="Suzuki">
                                                            <span>Suzuki</span><span class="filter_count">689</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Saab" value="Saab" name="make[]">
                                                            <label class="form-check-label" for="Saab">
                                                            <span>Saab</span><span class="filter_count">518</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Polestar" value="Polestar" name="make[]">
                                                            <label class="form-check-label" for="Polestar">
                                                            <span>Polestar</span><span class="filter_count">496</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Smart" value="Smart" name="make[]">
                                                            <label class="form-check-label" for="Smart">
                                                            <span>Smart</span><span class="filter_count">476</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Oldsmobile" value="Oldsmobile" name="make[]">
                                                            <label class="form-check-label" for="Oldsmobile">
                                                            <span>Oldsmobile</span><span class="filter_count">343</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Fisker" value="Fisker" name="make[]">
                                                            <label class="form-check-label" for="Fisker">
                                                            <span>Fisker</span><span class="filter_count">339</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Lotus" value="Lotus" name="make[]">
                                                            <label class="form-check-label" for="Lotus">
                                                            <span>Lotus</span><span class="filter_count">286</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Rivian" value="Rivian" name="make[]">
                                                            <label class="form-check-label" for="Rivian">
                                                            <span>Rivian</span><span class="filter_count">251</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Vinfast" value="Vinfast" name="make[]">
                                                            <label class="form-check-label" for="Vinfast">
                                                            <span>Vinfast</span><span class="filter_count">236</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Plymouth" value="Plymouth" name="make[]">
                                                            <label class="form-check-label" for="Plymouth">
                                                            <span>Plymouth</span><span class="filter_count">156</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Sterling" value="Sterling" name="make[]">
                                                            <label class="form-check-label" for="Sterling">
                                                            <span>Sterling</span><span class="filter_count">102</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Lucid" value="Lucid" name="make[]">
                                                            <label class="form-check-label" for="Lucid">
                                                            <span>Lucid</span><span class="filter_count">79</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Karma" value="Karma" name="make[]">
                                                            <label class="form-check-label" for="Karma">
                                                            <span>Karma</span><span class="filter_count">77</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="AM_General" value="AM General" name="make[]">
                                                            <label class="form-check-label" for="AM_General">
                                                            <span>AM General</span><span class="filter_count">55</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Datsun" value="Datsun" name="make[]">
                                                            <label class="form-check-label" for="Datsun">
                                                            <span>Datsun</span><span class="filter_count">31</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Maybach" value="Maybach" name="make[]">
                                                            <label class="form-check-label" for="Maybach">
                                                            <span>Maybach</span><span class="filter_count">28</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Geo" value="Geo" name="make[]">
                                                            <label class="form-check-label" for="Geo">
                                                            <span>Geo</span><span class="filter_count">27</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Bugatti" value="Bugatti" name="make[]">
                                                            <label class="form-check-label" for="Bugatti">
                                                            <span>Bugatti</span><span class="filter_count">9</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Eagle" value="Eagle" name="make[]">
                                                            <label class="form-check-label" for="Eagle">
                                                            <span>Eagle</span><span class="filter_count">9</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Daewoo" value="Daewoo" name="make[]">
                                                            <label class="form-check-label" for="Daewoo">
                                                            <span>Daewoo</span><span class="filter_count">6</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="AMC" value="AMC" name="make[]">
                                                            <label class="form-check-label" for="AMC">
                                                            <span>AMC</span><span class="filter_count">4</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Daihatsu" value="Daihatsu" name="make[]">
                                                            <label class="form-check-label" for="Daihatsu">
                                                            <span>Daihatsu</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            
                                                        <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Yugo" value="Yugo" name="make[]">
                                                            <label class="form-check-label" for="Yugo">
                                                            <span>Yugo</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                    </ul>
                                            </div>
                                        </div>

                                        <!-- Filter by Model -->
                                        
                                        <!-- Filter by Trim -->
                                        
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
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Automatic" value="Automatic" name="transmission[]">
                                                            <label class="form-check-label" for="Automatic">
                                                            <span>Automatic</span><span class="filter_count">4776110</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="CVT" value="CVT" name="transmission[]">
                                                            <label class="form-check-label" for="CVT">
                                                            <span>CVT</span><span class="filter_count">865598</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Manual" value="Manual" name="transmission[]">
                                                            <label class="form-check-label" for="Manual">
                                                            <span>Manual</span><span class="filter_count">93998</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                    
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
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.0L_I4" value="2.0L I4" name="engine[]">
                                                            <label class="form-check-label" for="2.0L_I4">
                                                            <span>2.0L I4</span><span class="filter_count">1050983</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.5L_I4" value="2.5L I4" name="engine[]">
                                                            <label class="form-check-label" for="2.5L_I4">
                                                            <span>2.5L I4</span><span class="filter_count">583470</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.5L_V6" value="3.5L V6" name="engine[]">
                                                            <label class="form-check-label" for="3.5L_V6">
                                                            <span>3.5L V6</span><span class="filter_count">467072</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.6L_V6" value="3.6L V6" name="engine[]">
                                                            <label class="form-check-label" for="3.6L_V6">
                                                            <span>3.6L V6</span><span class="filter_count">440726</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.5L_I4" value="1.5L I4" name="engine[]">
                                                            <label class="form-check-label" for="1.5L_I4">
                                                            <span>1.5L I4</span><span class="filter_count">260943</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.4L_I4" value="2.4L I4" name="engine[]">
                                                            <label class="form-check-label" for="2.4L_I4">
                                                            <span>2.4L I4</span><span class="filter_count">228990</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.3L_V8" value="5.3L V8" name="engine[]">
                                                            <label class="form-check-label" for="5.3L_V8">
                                                            <span>5.3L V8</span><span class="filter_count">191143</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.6L_I4" value="1.6L I4" name="engine[]">
                                                            <label class="form-check-label" for="1.6L_I4">
                                                            <span>1.6L I4</span><span class="filter_count">150935</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_I6" value="3.0L I6" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_I6">
                                                            <span>3.0L I6</span><span class="filter_count">146320</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.5L_I3" value="1.5L I3" name="engine[]">
                                                            <label class="form-check-label" for="1.5L_I3">
                                                            <span>1.5L I3</span><span class="filter_count">142966</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.2L_V8" value="6.2L V8" name="engine[]">
                                                            <label class="form-check-label" for="6.2L_V8">
                                                            <span>6.2L V8</span><span class="filter_count">109318</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.6L_V8" value="6.6L V8" name="engine[]">
                                                            <label class="form-check-label" for="6.6L_V8">
                                                            <span>6.6L V8</span><span class="filter_count">108772</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.5L_H4" value="2.5L H4" name="engine[]">
                                                            <label class="form-check-label" for="2.5L_H4">
                                                            <span>2.5L H4</span><span class="filter_count">108702</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_V6" value="3.0L V6" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_V6">
                                                            <span>3.0L V6</span><span class="filter_count">99848</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.8L_V6" value="3.8L V6" name="engine[]">
                                                            <label class="form-check-label" for="3.8L_V6">
                                                            <span>3.8L V6</span><span class="filter_count">92140</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.3L_I4" value="2.3L I4" name="engine[]">
                                                            <label class="form-check-label" for="2.3L_I4">
                                                            <span>2.3L I4</span><span class="filter_count">91537</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.7L_I4" value="2.7L I4" name="engine[]">
                                                            <label class="form-check-label" for="2.7L_I4">
                                                            <span>2.7L I4</span><span class="filter_count">90345</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.7L_V8" value="5.7L V8" name="engine[]">
                                                            <label class="form-check-label" for="5.7L_V8">
                                                            <span>5.7L V8</span><span class="filter_count">87694</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.7L_V6" value="2.7L V6" name="engine[]">
                                                            <label class="form-check-label" for="2.7L_V6">
                                                            <span>2.7L V6</span><span class="filter_count">81394</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.8L_I4" value="1.8L I4" name="engine[]">
                                                            <label class="form-check-label" for="1.8L_I4">
                                                            <span>1.8L I4</span><span class="filter_count">76145</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.7L_V8" value="6.7L V8" name="engine[]">
                                                            <label class="form-check-label" for="6.7L_V8">
                                                            <span>6.7L V8</span><span class="filter_count">66170</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.7L_I6" value="6.7L I6" name="engine[]">
                                                            <label class="form-check-label" for="6.7L_I6">
                                                            <span>6.7L I6</span><span class="filter_count">65128</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.0L_V8" value="5.0L V8" name="engine[]">
                                                            <label class="form-check-label" for="5.0L_V8">
                                                            <span>5.0L V8</span><span class="filter_count">62703</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.2L_I3" value="1.2L I3" name="engine[]">
                                                            <label class="form-check-label" for="1.2L_I3">
                                                            <span>1.2L I3</span><span class="filter_count">60326</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.4L_V6" value="3.4L V6" name="engine[]">
                                                            <label class="form-check-label" for="3.4L_V6">
                                                            <span>3.4L V6</span><span class="filter_count">48343</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.3L_I3" value="1.3L I3" name="engine[]">
                                                            <label class="form-check-label" for="1.3L_I3">
                                                            <span>1.3L I3</span><span class="filter_count">42816</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.4L_V8" value="6.4L V8" name="engine[]">
                                                            <label class="form-check-label" for="6.4L_V8">
                                                            <span>6.4L V8</span><span class="filter_count">42723</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.4L_I4" value="1.4L I4" name="engine[]">
                                                            <label class="form-check-label" for="1.4L_I4">
                                                            <span>1.4L I4</span><span class="filter_count">38510</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.0L_V6" value="4.0L V6" name="engine[]">
                                                            <label class="form-check-label" for="4.0L_V6">
                                                            <span>4.0L V6</span><span class="filter_count">36085</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.4L_H4" value="2.4L H4" name="engine[]">
                                                            <label class="form-check-label" for="2.4L_H4">
                                                            <span>2.4L H4</span><span class="filter_count">36043</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.0L_H4" value="2.0L H4" name="engine[]">
                                                            <label class="form-check-label" for="2.0L_H4">
                                                            <span>2.0L H4</span><span class="filter_count">35845</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.7L_V6" value="3.7L V6" name="engine[]">
                                                            <label class="form-check-label" for="3.7L_V6">
                                                            <span>3.7L V6</span><span class="filter_count">24694</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.6L_V8" value="5.6L V8" name="engine[]">
                                                            <label class="form-check-label" for="5.6L_V8">
                                                            <span>5.6L V8</span><span class="filter_count">24694</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="7.3L_V8" value="7.3L V8" name="engine[]">
                                                            <label class="form-check-label" for="7.3L_V8">
                                                            <span>7.3L V8</span><span class="filter_count">24015</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.0L_V8" value="4.0L V8" name="engine[]">
                                                            <label class="form-check-label" for="4.0L_V8">
                                                            <span>4.0L V8</span><span class="filter_count">21798</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.8L_V8" value="6.8L V8" name="engine[]">
                                                            <label class="form-check-label" for="6.8L_V8">
                                                            <span>6.8L V8</span><span class="filter_count">21155</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.3L_I6" value="3.3L I6" name="engine[]">
                                                            <label class="form-check-label" for="3.3L_I6">
                                                            <span>3.3L I6</span><span class="filter_count">20250</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.3L_V6" value="3.3L V6" name="engine[]">
                                                            <label class="form-check-label" for="3.3L_V6">
                                                            <span>3.3L V6</span><span class="filter_count">18763</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.4L_V8" value="4.4L V8" name="engine[]">
                                                            <label class="form-check-label" for="4.4L_V8">
                                                            <span>4.4L V8</span><span class="filter_count">16911</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.6L_V8" value="4.6L V8" name="engine[]">
                                                            <label class="form-check-label" for="4.6L_V8">
                                                            <span>4.6L V8</span><span class="filter_count">15673</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.3L_I4" value="1.3L I4" name="engine[]">
                                                            <label class="form-check-label" for="1.3L_I4">
                                                            <span>1.3L I4</span><span class="filter_count">14981</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.2L_V6" value="3.2L V6" name="engine[]">
                                                            <label class="form-check-label" for="3.2L_V6">
                                                            <span>3.2L V6</span><span class="filter_count">13247</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.4L_V8" value="5.4L V8" name="engine[]">
                                                            <label class="form-check-label" for="5.4L_V8">
                                                            <span>5.4L V8</span><span class="filter_count">12068</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.3L_V6" value="4.3L V6" name="engine[]">
                                                            <label class="form-check-label" for="4.3L_V6">
                                                            <span>4.3L V6</span><span class="filter_count">11755</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.0L_V8" value="6.0L V8" name="engine[]">
                                                            <label class="form-check-label" for="6.0L_V8">
                                                            <span>6.0L V8</span><span class="filter_count">10276</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.7L_V8" value="4.7L V8" name="engine[]">
                                                            <label class="form-check-label" for="4.7L_V8">
                                                            <span>4.7L V8</span><span class="filter_count">9954</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3L_V6" value="3L V6" name="engine[]">
                                                            <label class="form-check-label" for="3L_V6">
                                                            <span>3L V6</span><span class="filter_count">6834</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.8L_V8" value="4.8L V8" name="engine[]">
                                                            <label class="form-check-label" for="4.8L_V8">
                                                            <span>4.8L V8</span><span class="filter_count">6363</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.5L_I5" value="2.5L I5" name="engine[]">
                                                            <label class="form-check-label" for="2.5L_I5">
                                                            <span>2.5L I5</span><span class="filter_count">5892</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6L_V8" value="6L V8" name="engine[]">
                                                            <label class="form-check-label" for="6L_V8">
                                                            <span>6L V8</span><span class="filter_count">5048</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.9L_V6" value="2.9L V6" name="engine[]">
                                                            <label class="form-check-label" for="2.9L_V6">
                                                            <span>2.9L V6</span><span class="filter_count">4368</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2L_I4" value="2L I4" name="engine[]">
                                                            <label class="form-check-label" for="2L_I4">
                                                            <span>2L I4</span><span class="filter_count">4316</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.5L_V8" value="5.5L V8" name="engine[]">
                                                            <label class="form-check-label" for="5.5L_V8">
                                                            <span>5.5L V8</span><span class="filter_count">4240</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4L_V6" value="4L V6" name="engine[]">
                                                            <label class="form-check-label" for="4L_V6">
                                                            <span>4L V6</span><span class="filter_count">3664</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.0L_I3" value="1.0L I3" name="engine[]">
                                                            <label class="form-check-label" for="1.0L_I3">
                                                            <span>1.0L I3</span><span class="filter_count">2712</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.2L_I4" value="2.2L I4" name="engine[]">
                                                            <label class="form-check-label" for="2.2L_I4">
                                                            <span>2.2L I4</span><span class="filter_count">2599</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_H6" value="3.0L H6" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_H6">
                                                            <span>3.0L H6</span><span class="filter_count">2549</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3L_I6" value="3L I6" name="engine[]">
                                                            <label class="form-check-label" for="3L_I6">
                                                            <span>3L I6</span><span class="filter_count">2499</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.6L_H6" value="3.6L H6" name="engine[]">
                                                            <label class="form-check-label" for="3.6L_H6">
                                                            <span>3.6L H6</span><span class="filter_count">2470</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.5L_V6" value="2.5L V6" name="engine[]">
                                                            <label class="form-check-label" for="2.5L_V6">
                                                            <span>2.5L V6</span><span class="filter_count">2325</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.2L_I6" value="3.2L I6" name="engine[]">
                                                            <label class="form-check-label" for="3.2L_I6">
                                                            <span>3.2L I6</span><span class="filter_count">1930</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4L_I6" value="4L I6" name="engine[]">
                                                            <label class="form-check-label" for="4L_I6">
                                                            <span>4L I6</span><span class="filter_count">1847</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.8L_V10" value="6.8L V10" name="engine[]">
                                                            <label class="form-check-label" for="6.8L_V10">
                                                            <span>6.8L V10</span><span class="filter_count">1800</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.2L_I6" value="4.2L I6" name="engine[]">
                                                            <label class="form-check-label" for="4.2L_I6">
                                                            <span>4.2L I6</span><span class="filter_count">1773</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.9L_V8" value="3.9L V8" name="engine[]">
                                                            <label class="form-check-label" for="3.9L_V8">
                                                            <span>3.9L V8</span><span class="filter_count">1731</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.8L_H6" value="3.8L H6" name="engine[]">
                                                            <label class="form-check-label" for="3.8L_H6">
                                                            <span>3.8L H6</span><span class="filter_count">1660</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.2L_V8" value="5.2L V8" name="engine[]">
                                                            <label class="form-check-label" for="5.2L_V8">
                                                            <span>5.2L V8</span><span class="filter_count">1637</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.2L_V8" value="4.2L V8" name="engine[]">
                                                            <label class="form-check-label" for="4.2L_V8">
                                                            <span>4.2L V8</span><span class="filter_count">1529</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5L_V8" value="5L V8" name="engine[]">
                                                            <label class="form-check-label" for="5L_V8">
                                                            <span>5L V8</span><span class="filter_count">1501</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.9L_V6" value="3.9L V6" name="engine[]">
                                                            <label class="form-check-label" for="3.9L_V6">
                                                            <span>3.9L V6</span><span class="filter_count">1452</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.3L_V8" value="4.3L V8" name="engine[]">
                                                            <label class="form-check-label" for="4.3L_V8">
                                                            <span>4.3L V8</span><span class="filter_count">1383</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.0L_W12" value="6.0L W12" name="engine[]">
                                                            <label class="form-check-label" for="6.0L_W12">
                                                            <span>6.0L W12</span><span class="filter_count">1189</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.9L_I6" value="5.9L I6" name="engine[]">
                                                            <label class="form-check-label" for="5.9L_I6">
                                                            <span>5.9L I6</span><span class="filter_count">1115</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.2L_V10" value="5.2L V10" name="engine[]">
                                                            <label class="form-check-label" for="5.2L_V10">
                                                            <span>5.2L V10</span><span class="filter_count">1063</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.0L_H6" value="4.0L H6" name="engine[]">
                                                            <label class="form-check-label" for="4.0L_H6">
                                                            <span>4.0L H6</span><span class="filter_count">1047</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.7L_I5" value="3.7L I5" name="engine[]">
                                                            <label class="form-check-label" for="3.7L_I5">
                                                            <span>3.7L I5</span><span class="filter_count">989</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.6L_I3" value="1.6L I3" name="engine[]">
                                                            <label class="form-check-label" for="1.6L_I3">
                                                            <span>1.6L I3</span><span class="filter_count">956</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.8L_I4" value="2.8L I4" name="engine[]">
                                                            <label class="form-check-label" for="2.8L_I4">
                                                            <span>2.8L I4</span><span class="filter_count">947</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.7L_V12" value="6.7L V12" name="engine[]">
                                                            <label class="form-check-label" for="6.7L_V12">
                                                            <span>6.7L V12</span><span class="filter_count">814</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.5L_I6" value="2.5L I6" name="engine[]">
                                                            <label class="form-check-label" for="2.5L_I6">
                                                            <span>2.5L I6</span><span class="filter_count">802</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.2L_I4" value="1.2L I4" name="engine[]">
                                                            <label class="form-check-label" for="1.2L_I4">
                                                            <span>1.2L I4</span><span class="filter_count">708</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.4L_H6" value="3.4L H6" name="engine[]">
                                                            <label class="form-check-label" for="3.4L_H6">
                                                            <span>3.4L H6</span><span class="filter_count">697</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.2L_V6" value="4.2L V6" name="engine[]">
                                                            <label class="form-check-label" for="4.2L_V6">
                                                            <span>4.2L V6</span><span class="filter_count">677</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.6L_V12" value="6.6L V12" name="engine[]">
                                                            <label class="form-check-label" for="6.6L_V12">
                                                            <span>6.6L V12</span><span class="filter_count">649</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.7L_I4" value="1.7L I4" name="engine[]">
                                                            <label class="form-check-label" for="1.7L_I4">
                                                            <span>1.7L I4</span><span class="filter_count">646</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.5L_I5" value="3.5L I5" name="engine[]">
                                                            <label class="form-check-label" for="3.5L_I5">
                                                            <span>3.5L I5</span><span class="filter_count">545</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.1L_V6" value="3.1L V6" name="engine[]">
                                                            <label class="form-check-label" for="3.1L_V6">
                                                            <span>3.1L V6</span><span class="filter_count">532</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4L_V8" value="4L V8" name="engine[]">
                                                            <label class="form-check-label" for="4L_V8">
                                                            <span>4L V8</span><span class="filter_count">517</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.8L_V8" value="3.8L V8" name="engine[]">
                                                            <label class="form-check-label" for="3.8L_V8">
                                                            <span>3.8L V8</span><span class="filter_count">484</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.7L_H6" value="2.7L H6" name="engine[]">
                                                            <label class="form-check-label" for="2.7L_H6">
                                                            <span>2.7L H6</span><span class="filter_count">483</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.1L_I4" value="2.1L I4" name="engine[]">
                                                            <label class="form-check-label" for="2.1L_I4">
                                                            <span>2.1L I4</span><span class="filter_count">453</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.1L_V8" value="6.1L V8" name="engine[]">
                                                            <label class="form-check-label" for="6.1L_V8">
                                                            <span>6.1L V8</span><span class="filter_count">411</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.4L_I5" value="2.4L I5" name="engine[]">
                                                            <label class="form-check-label" for="2.4L_I5">
                                                            <span>2.4L I5</span><span class="filter_count">397</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6L_W12" value="6L W12" name="engine[]">
                                                            <label class="form-check-label" for="6L_W12">
                                                            <span>6L W12</span><span class="filter_count">373</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.0L_V12" value="6.0L V12" name="engine[]">
                                                            <label class="form-check-label" for="6.0L_V12">
                                                            <span>6.0L V12</span><span class="filter_count">368</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.5L_V8" value="4.5L V8" name="engine[]">
                                                            <label class="form-check-label" for="4.5L_V8">
                                                            <span>4.5L V8</span><span class="filter_count">367</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.5L_V12" value="6.5L V12" name="engine[]">
                                                            <label class="form-check-label" for="6.5L_V12">
                                                            <span>6.5L V12</span><span class="filter_count">355</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.9L_I4" value="2.9L I4" name="engine[]">
                                                            <label class="form-check-label" for="2.9L_I4">
                                                            <span>2.9L I4</span><span class="filter_count">354</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.9L_V8" value="5.9L V8" name="engine[]">
                                                            <label class="form-check-label" for="5.9L_V8">
                                                            <span>5.9L V8</span><span class="filter_count">338</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.2L_I4" value="5.2L I4" name="engine[]">
                                                            <label class="form-check-label" for="5.2L_I4">
                                                            <span>5.2L I4</span><span class="filter_count">325</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.8L_V6" value="2.8L V6" name="engine[]">
                                                            <label class="form-check-label" for="2.8L_V6">
                                                            <span>2.8L V6</span><span class="filter_count">304</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_I4" value="3.0L I4" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_I4">
                                                            <span>3.0L I4</span><span class="filter_count">272</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="0.6L_I2" value="0.6L I2" name="engine[]">
                                                            <label class="form-check-label" for="0.6L_I2">
                                                            <span>0.6L I2</span><span class="filter_count">251</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.2L_I5" value="3.2L I5" name="engine[]">
                                                            <label class="form-check-label" for="3.2L_I5">
                                                            <span>3.2L I5</span><span class="filter_count">239</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.9L_V12" value="5.9L V12" name="engine[]">
                                                            <label class="form-check-label" for="5.9L_V12">
                                                            <span>5.9L V12</span><span class="filter_count">236</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.9L_I4" value="1.9L I4" name="engine[]">
                                                            <label class="form-check-label" for="1.9L_I4">
                                                            <span>1.9L I4</span><span class="filter_count">234</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="7.0L_V8" value="7.0L V8" name="engine[]">
                                                            <label class="form-check-label" for="7.0L_V8">
                                                            <span>7.0L V8</span><span class="filter_count">232</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5L_V10" value="5L V10" name="engine[]">
                                                            <label class="form-check-label" for="5L_V10">
                                                            <span>5L V10</span><span class="filter_count">222</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="8.1L_V8" value="8.1L V8" name="engine[]">
                                                            <label class="form-check-label" for="8.1L_V8">
                                                            <span>8.1L V8</span><span class="filter_count">185</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="8.3L_V10" value="8.3L V10" name="engine[]">
                                                            <label class="form-check-label" for="8.3L_V10">
                                                            <span>8.3L V10</span><span class="filter_count">176</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.2L_V12" value="5.2L V12" name="engine[]">
                                                            <label class="form-check-label" for="5.2L_V12">
                                                            <span>5.2L V12</span><span class="filter_count">151</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.6L_V6" value="2.6L V6" name="engine[]">
                                                            <label class="form-check-label" for="2.6L_V6">
                                                            <span>2.6L V6</span><span class="filter_count">144</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_V8" value="3.0L V8" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_V8">
                                                            <span>3.0L V8</span><span class="filter_count">143</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.2L_H6" value="3.2L H6" name="engine[]">
                                                            <label class="form-check-label" for="3.2L_H6">
                                                            <span>3.2L H6</span><span class="filter_count">138</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.3L_V12" value="6.3L V12" name="engine[]">
                                                            <label class="form-check-label" for="6.3L_V12">
                                                            <span>6.3L V12</span><span class="filter_count">121</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.8L_I6" value="2.8L I6" name="engine[]">
                                                            <label class="form-check-label" for="2.8L_I6">
                                                            <span>2.8L I6</span><span class="filter_count">119</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.5L_V12" value="5.5L V12" name="engine[]">
                                                            <label class="form-check-label" for="5.5L_V12">
                                                            <span>5.5L V12</span><span class="filter_count">116</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.6L_V8" value="3.6L V8" name="engine[]">
                                                            <label class="form-check-label" for="3.6L_V8">
                                                            <span>3.6L V8</span><span class="filter_count">109</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.5L_H6" value="2.5L H6" name="engine[]">
                                                            <label class="form-check-label" for="2.5L_H6">
                                                            <span>2.5L H6</span><span class="filter_count">108</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6L_V12" value="6L V12" name="engine[]">
                                                            <label class="form-check-label" for="6L_V12">
                                                            <span>6L V12</span><span class="filter_count">100</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="8L_V10" value="8L V10" name="engine[]">
                                                            <label class="form-check-label" for="8L_V10">
                                                            <span>8L V10</span><span class="filter_count">99</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.6L_R2" value="2.6L R2" name="engine[]">
                                                            <label class="form-check-label" for="2.6L_R2">
                                                            <span>2.6L R2</span><span class="filter_count">90</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.2L_V5" value="3.2L V5" name="engine[]">
                                                            <label class="form-check-label" for="3.2L_V5">
                                                            <span>3.2L V5</span><span class="filter_count">88</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.8L_V8" value="5.8L V8" name="engine[]">
                                                            <label class="form-check-label" for="5.8L_V8">
                                                            <span>5.8L V8</span><span class="filter_count">85</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.0L_I6" value="4.0L I6" name="engine[]">
                                                            <label class="form-check-label" for="4.0L_I6">
                                                            <span>4.0L I6</span><span class="filter_count">83</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="7.4L_V8" value="7.4L V8" name="engine[]">
                                                            <label class="form-check-label" for="7.4L_V8">
                                                            <span>7.4L V8</span><span class="filter_count">83</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.6L_I4" value="3.6L I4" name="engine[]">
                                                            <label class="form-check-label" for="3.6L_I4">
                                                            <span>3.6L I4</span><span class="filter_count">82</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.9L_I8" value="5.9L I8" name="engine[]">
                                                            <label class="form-check-label" for="5.9L_I8">
                                                            <span>5.9L I8</span><span class="filter_count">80</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.5L_V8" value="6.5L V8" name="engine[]">
                                                            <label class="form-check-label" for="6.5L_V8">
                                                            <span>6.5L V8</span><span class="filter_count">79</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.9L_V8" value="4.9L V8" name="engine[]">
                                                            <label class="form-check-label" for="4.9L_V8">
                                                            <span>4.9L V8</span><span class="filter_count">77</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="0.9L_I3" value="0.9L I3" name="engine[]">
                                                            <label class="form-check-label" for="0.9L_I3">
                                                            <span>0.9L I3</span><span class="filter_count">75</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="0.7L_I2" value="0.7L I2" name="engine[]">
                                                            <label class="form-check-label" for="0.7L_I2">
                                                            <span>0.7L I2</span><span class="filter_count">72</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.9L_H6" value="2.9L H6" name="engine[]">
                                                            <label class="form-check-label" for="2.9L_H6">
                                                            <span>2.9L H6</span><span class="filter_count">67</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="8.4L_V10" value="8.4L V10" name="engine[]">
                                                            <label class="form-check-label" for="8.4L_V10">
                                                            <span>8.4L V10</span><span class="filter_count">65</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.9L_I6" value="2.9L I6" name="engine[]">
                                                            <label class="form-check-label" for="2.9L_I6">
                                                            <span>2.9L I6</span><span class="filter_count">62</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.7L_I5" value="2.7L I5" name="engine[]">
                                                            <label class="form-check-label" for="2.7L_I5">
                                                            <span>2.7L I5</span><span class="filter_count">54</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3L_H6" value="3L H6" name="engine[]">
                                                            <label class="form-check-label" for="3L_H6">
                                                            <span>3L H6</span><span class="filter_count">47</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.7L_V12" value="5.7L V12" name="engine[]">
                                                            <label class="form-check-label" for="5.7L_V12">
                                                            <span>5.7L V12</span><span class="filter_count">47</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2L_H4" value="2L H4" name="engine[]">
                                                            <label class="form-check-label" for="2L_H4">
                                                            <span>2L H4</span><span class="filter_count">39</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.5L_I6" value="4.5L I6" name="engine[]">
                                                            <label class="form-check-label" for="4.5L_I6">
                                                            <span>4.5L I6</span><span class="filter_count">30</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.3L_I5" value="2.3L I5" name="engine[]">
                                                            <label class="form-check-label" for="2.3L_I5">
                                                            <span>2.3L I5</span><span class="filter_count">29</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="7.5L_V8" value="7.5L V8" name="engine[]">
                                                            <label class="form-check-label" for="7.5L_V8">
                                                            <span>7.5L V8</span><span class="filter_count">28</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.5L_V8" value="3.5L V8" name="engine[]">
                                                            <label class="form-check-label" for="3.5L_V8">
                                                            <span>3.5L V8</span><span class="filter_count">27</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.2L_H4" value="2.2L H4" name="engine[]">
                                                            <label class="form-check-label" for="2.2L_H4">
                                                            <span>2.2L H4</span><span class="filter_count">25</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.2L_V12" value="6.2L V12" name="engine[]">
                                                            <label class="form-check-label" for="6.2L_V12">
                                                            <span>6.2L V12</span><span class="filter_count">21</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.7L_V8_OHV_12V" value="5.7L V8 OHV 12V" name="engine[]">
                                                            <label class="form-check-label" for="5.7L_V8_OHV_12V">
                                                            <span>5.7L V8 OHV 12V</span><span class="filter_count">17</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.0L_I4" value="1.0L I4" name="engine[]">
                                                            <label class="form-check-label" for="1.0L_I4">
                                                            <span>1.0L I4</span><span class="filter_count">15</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.8L_V12" value="5.8L V12" name="engine[]">
                                                            <label class="form-check-label" for="5.8L_V12">
                                                            <span>5.8L V12</span><span class="filter_count">15</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.1L_V8" value="4.1L V8" name="engine[]">
                                                            <label class="form-check-label" for="4.1L_V8">
                                                            <span>4.1L V8</span><span class="filter_count">14</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.4L_V12" value="5.4L V12" name="engine[]">
                                                            <label class="form-check-label" for="5.4L_V12">
                                                            <span>5.4L V12</span><span class="filter_count">14</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.7L_V8_OHV_16V" value="5.7L V8 OHV 16V" name="engine[]">
                                                            <label class="form-check-label" for="5.7L_V8_OHV_16V">
                                                            <span>5.7L V8 OHV 16V</span><span class="filter_count">13</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.0L_V10" value="5.0L V10" name="engine[]">
                                                            <label class="form-check-label" for="5.0L_V10">
                                                            <span>5.0L V10</span><span class="filter_count">12</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.0L_V8_OHV_16V" value="5.0L V8 OHV 16V" name="engine[]">
                                                            <label class="form-check-label" for="5.0L_V8_OHV_16V">
                                                            <span>5.0L V8 OHV 16V</span><span class="filter_count">12</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.3L_V5" value="5.3L V5" name="engine[]">
                                                            <label class="form-check-label" for="5.3L_V5">
                                                            <span>5.3L V5</span><span class="filter_count">11</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.7L_V10" value="5.7L V10" name="engine[]">
                                                            <label class="form-check-label" for="5.7L_V10">
                                                            <span>5.7L V10</span><span class="filter_count">10</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.5L_I4" value="3.5L I4" name="engine[]">
                                                            <label class="form-check-label" for="3.5L_I4">
                                                            <span>3.5L I4</span><span class="filter_count">8</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.2L_L6_DOHC_24V" value="3.2L L6 DOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="3.2L_L6_DOHC_24V">
                                                            <span>3.2L L6 DOHC 24V</span><span class="filter_count">7</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.6L_V8_SOHC_16V" value="5.6L V8 SOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="5.6L_V8_SOHC_16V">
                                                            <span>5.6L V8 SOHC 16V</span><span class="filter_count">7</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.3L_W12" value="6.3L W12" name="engine[]">
                                                            <label class="form-check-label" for="6.3L_W12">
                                                            <span>6.3L W12</span><span class="filter_count">7</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_V6_DOHC_24V" value="3.0L V6 DOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_V6_DOHC_24V">
                                                            <span>3.0L V6 DOHC 24V</span><span class="filter_count">6</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1312CC" value="1312CC" name="engine[]">
                                                            <label class="form-check-label" for="1312CC">
                                                            <span>1312CC</span><span class="filter_count">5</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1L_I3" value="1L I3" name="engine[]">
                                                            <label class="form-check-label" for="1L_I3">
                                                            <span>1L I3</span><span class="filter_count">4</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.8L_V6_OHV_12V" value="3.8L V6 OHV 12V" name="engine[]">
                                                            <label class="form-check-label" for="3.8L_V6_OHV_12V">
                                                            <span>3.8L V6 OHV 12V</span><span class="filter_count">4</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.8L_V10" value="4.8L V10" name="engine[]">
                                                            <label class="form-check-label" for="4.8L_V10">
                                                            <span>4.8L V10</span><span class="filter_count">4</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.5L_H12" value="5.5L H12" name="engine[]">
                                                            <label class="form-check-label" for="5.5L_H12">
                                                            <span>5.5L H12</span><span class="filter_count">4</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.8L_L4_DOHC_16V" value="1.8L L4 DOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="1.8L_L4_DOHC_16V">
                                                            <span>1.8L L4 DOHC 16V</span><span class="filter_count">3</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.8L_V6_OHV_12V" value="2.8L V6 OHV 12V" name="engine[]">
                                                            <label class="form-check-label" for="2.8L_V6_OHV_12V">
                                                            <span>2.8L V6 OHV 12V</span><span class="filter_count">3</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_H6_SOHC_12V" value="3.0L H6 SOHC 12V" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_H6_SOHC_12V">
                                                            <span>3.0L H6 SOHC 12V</span><span class="filter_count">3</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.6L_V8_DOHC_32V" value="4.6L V8 DOHC 32V" name="engine[]">
                                                            <label class="form-check-label" for="4.6L_V8_DOHC_32V">
                                                            <span>4.6L V8 DOHC 32V</span><span class="filter_count">3</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.9L_V10" value="4.9L V10" name="engine[]">
                                                            <label class="form-check-label" for="4.9L_V10">
                                                            <span>4.9L V10</span><span class="filter_count">3</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.0L_V8_VIH_16V" value="5.0L V8 VIH 16V" name="engine[]">
                                                            <label class="form-check-label" for="5.0L_V8_VIH_16V">
                                                            <span>5.0L V8 VIH 16V</span><span class="filter_count">3</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.3L_V12_SOHC_24V" value="5.3L V12 SOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="5.3L_V12_SOHC_24V">
                                                            <span>5.3L V12 SOHC 24V</span><span class="filter_count">3</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.6L_L4_DOHC_16V" value="1.6L L4 DOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="1.6L_L4_DOHC_16V">
                                                            <span>1.6L L4 DOHC 16V</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.0L_L4_DOHC_16V" value="2.0L L4 DOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="2.0L_L4_DOHC_16V">
                                                            <span>2.0L L4 DOHC 16V</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.5L_L4_SOHC_8V_TURBO" value="2.5L L4 SOHC 8V TURBO" name="engine[]">
                                                            <label class="form-check-label" for="2.5L_L4_SOHC_8V_TURBO">
                                                            <span>2.5L L4 SOHC 8V TURBO</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.8L_L6_DOHC_16V" value="2.8L L6 DOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="2.8L_L6_DOHC_16V">
                                                            <span>2.8L L6 DOHC 16V</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_L6_DOHC_24V" value="3.0L L6 DOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_L6_DOHC_24V">
                                                            <span>3.0L L6 DOHC 24V</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_L6_DOHC_24V_TURBO" value="3.0L L6 DOHC 24V TURBO" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_L6_DOHC_24V_TURBO">
                                                            <span>3.0L L6 DOHC 24V TURBO</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_L6_SOHC_12V" value="3.0L L6 SOHC 12V" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_L6_SOHC_12V">
                                                            <span>3.0L L6 SOHC 12V</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.2L_H6_SOHC_12V" value="3.2L H6 SOHC 12V" name="engine[]">
                                                            <label class="form-check-label" for="3.2L_H6_SOHC_12V">
                                                            <span>3.2L H6 SOHC 12V</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.6L_H6_DOHC_24V" value="3.6L H6 DOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="3.6L_H6_DOHC_24V">
                                                            <span>3.6L H6 DOHC 24V</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.6L_L6_SOHC_12V" value="3.6L L6 SOHC 12V" name="engine[]">
                                                            <label class="form-check-label" for="3.6L_L6_SOHC_12V">
                                                            <span>3.6L L6 SOHC 12V</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.8L_V6_OHV_12V_TURBO" value="3.8L V6 OHV 12V TURBO" name="engine[]">
                                                            <label class="form-check-label" for="3.8L_V6_OHV_12V_TURBO">
                                                            <span>3.8L V6 OHV 12V TURBO</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.0L_V8_DOHC_32V" value="5.0L V8 DOHC 32V" name="engine[]">
                                                            <label class="form-check-label" for="5.0L_V8_DOHC_32V">
                                                            <span>5.0L V8 DOHC 32V</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.9L_I12" value="5.9L I12" name="engine[]">
                                                            <label class="form-check-label" for="5.9L_I12">
                                                            <span>5.9L I12</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="582CC" value="582CC" name="engine[]">
                                                            <label class="form-check-label" for="582CC">
                                                            <span>582CC</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.8L_V8_OHV_16V_TURBO" value="6.8L V8 OHV 16V TURBO" name="engine[]">
                                                            <label class="form-check-label" for="6.8L_V8_OHV_16V_TURBO">
                                                            <span>6.8L V8 OHV 16V TURBO</span><span class="filter_count">2</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="0.8L_I3" value="0.8L I3" name="engine[]">
                                                            <label class="form-check-label" for="0.8L_I3">
                                                            <span>0.8L I3</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="0.8L_L3_SOHC_6V" value="0.8L L3 SOHC 6V" name="engine[]">
                                                            <label class="form-check-label" for="0.8L_L3_SOHC_6V">
                                                            <span>0.8L L3 SOHC 6V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.3L_ROTARY" value="1.3L ROTARY" name="engine[]">
                                                            <label class="form-check-label" for="1.3L_ROTARY">
                                                            <span>1.3L ROTARY</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.7L_L4_SOHC_16V" value="1.7L L4 SOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="1.7L_L4_SOHC_16V">
                                                            <span>1.7L L4 SOHC 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1.9L_L4_DOHC_16V" value="1.9L L4 DOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="1.9L_L4_DOHC_16V">
                                                            <span>1.9L L4 DOHC 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1462CC" value="1462CC" name="engine[]">
                                                            <label class="form-check-label" for="1462CC">
                                                            <span>1462CC</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="1795CC" value="1795CC" name="engine[]">
                                                            <label class="form-check-label" for="1795CC">
                                                            <span>1795CC</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.0L_L4_SOHC_16V" value="2.0L L4 SOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="2.0L_L4_SOHC_16V">
                                                            <span>2.0L L4 SOHC 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.3L_V6" value="2.3L V6" name="engine[]">
                                                            <label class="form-check-label" for="2.3L_V6">
                                                            <span>2.3L V6</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.4L_L4_DOHC_16V" value="2.4L L4 DOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="2.4L_L4_DOHC_16V">
                                                            <span>2.4L L4 DOHC 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.5L_L4_SOHC_8V" value="2.5L L4 SOHC 8V" name="engine[]">
                                                            <label class="form-check-label" for="2.5L_L4_SOHC_8V">
                                                            <span>2.5L L4 SOHC 8V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.6L_I4" value="2.6L I4" name="engine[]">
                                                            <label class="form-check-label" for="2.6L_I4">
                                                            <span>2.6L I4</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.6L_L4_SOHC_8V" value="2.6L L4 SOHC 8V" name="engine[]">
                                                            <label class="form-check-label" for="2.6L_L4_SOHC_8V">
                                                            <span>2.6L L4 SOHC 8V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.7L_V6_SOHC_24V" value="2.7L V6 SOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="2.7L_V6_SOHC_24V">
                                                            <span>2.7L V6 SOHC 24V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.8L_L6_OHV" value="2.8L L6 OHV" name="engine[]">
                                                            <label class="form-check-label" for="2.8L_L6_OHV">
                                                            <span>2.8L L6 OHV</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.8L_V6_DOHC_12V" value="2.8L V6 DOHC 12V" name="engine[]">
                                                            <label class="form-check-label" for="2.8L_V6_DOHC_12V">
                                                            <span>2.8L V6 DOHC 12V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.9L_L4_DOHC_16V" value="2.9L L4 DOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="2.9L_L4_DOHC_16V">
                                                            <span>2.9L L4 DOHC 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="2.9L_V8_SOHC_16V" value="2.9L V8 SOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="2.9L_V8_SOHC_16V">
                                                            <span>2.9L V8 SOHC 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_L4_DOHC_16V" value="3.0L L4 DOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_L4_DOHC_16V">
                                                            <span>3.0L L4 DOHC 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_V6_SOHC_12V" value="3.0L V6 SOHC 12V" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_V6_SOHC_12V">
                                                            <span>3.0L V6 SOHC 12V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.0L_V6_SOHC_24V" value="3.0L V6 SOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="3.0L_V6_SOHC_24V">
                                                            <span>3.0L V6 SOHC 24V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.2L_V6_DOHC_24V" value="3.2L V6 DOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="3.2L_V6_DOHC_24V">
                                                            <span>3.2L V6 DOHC 24V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.3L_H6_SOHC_12V_TURBO" value="3.3L H6 SOHC 12V TURBO" name="engine[]">
                                                            <label class="form-check-label" for="3.3L_H6_SOHC_12V_TURBO">
                                                            <span>3.3L H6 SOHC 12V TURBO</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.4L_V6_DOHC_24V" value="3.4L V6 DOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="3.4L_V6_DOHC_24V">
                                                            <span>3.4L V6 DOHC 24V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.5L_L6_DOHC_24V" value="3.5L L6 DOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="3.5L_L6_DOHC_24V">
                                                            <span>3.5L L6 DOHC 24V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.6L_H6_DOHC_24V_TURBO" value="3.6L H6 DOHC 24V TURBO" name="engine[]">
                                                            <label class="form-check-label" for="3.6L_H6_DOHC_24V_TURBO">
                                                            <span>3.6L H6 DOHC 24V TURBO</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.6L_V8_2-DOHC_40V" value="3.6L V8 2-DOHC 40V" name="engine[]">
                                                            <label class="form-check-label" for="3.6L_V8_2-DOHC_40V">
                                                            <span>3.6L V8 2-DOHC 40V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.7L_H6" value="3.7L H6" name="engine[]">
                                                            <label class="form-check-label" for="3.7L_H6">
                                                            <span>3.7L H6</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.7L_L5_DOHC_20V" value="3.7L L5 DOHC 20V" name="engine[]">
                                                            <label class="form-check-label" for="3.7L_L5_DOHC_20V">
                                                            <span>3.7L L5 DOHC 20V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="3.9L_V8_DOHC_32V" value="3.9L V8 DOHC 32V" name="engine[]">
                                                            <label class="form-check-label" for="3.9L_V8_DOHC_32V">
                                                            <span>3.9L V8 DOHC 32V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.2L_L6_OHV" value="4.2L L6 OHV" name="engine[]">
                                                            <label class="form-check-label" for="4.2L_L6_OHV">
                                                            <span>4.2L L6 OHV</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.5L_V8_OHV_16V" value="4.5L V8 OHV 16V" name="engine[]">
                                                            <label class="form-check-label" for="4.5L_V8_OHV_16V">
                                                            <span>4.5L V8 OHV 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.6L_V8_SOHC_16V" value="4.6L V8 SOHC 16V" name="engine[]">
                                                            <label class="form-check-label" for="4.6L_V8_SOHC_16V">
                                                            <span>4.6L V8 SOHC 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4.6L_V8_SOHC_16V_CNG" value="4.6L V8 SOHC 16V CNG" name="engine[]">
                                                            <label class="form-check-label" for="4.6L_V8_SOHC_16V_CNG">
                                                            <span>4.6L V8 SOHC 16V CNG</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="475CC" value="475CC" name="engine[]">
                                                            <label class="form-check-label" for="475CC">
                                                            <span>475CC</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="497CC" value="497CC" name="engine[]">
                                                            <label class="form-check-label" for="497CC">
                                                            <span>497CC</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4L_W8" value="4L W8" name="engine[]">
                                                            <label class="form-check-label" for="4L_W8">
                                                            <span>4L W8</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.4L_V12_SOHC_24V" value="5.4L V12 SOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="5.4L_V12_SOHC_24V">
                                                            <span>5.4L V12 SOHC 24V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.7L_V8_DOHC_32V" value="5.7L V8 DOHC 32V" name="engine[]">
                                                            <label class="form-check-label" for="5.7L_V8_DOHC_32V">
                                                            <span>5.7L V8 DOHC 32V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.7L_V8_OHV_16V_CNG" value="5.7L V8 OHV 16V CNG" name="engine[]">
                                                            <label class="form-check-label" for="5.7L_V8_OHV_16V_CNG">
                                                            <span>5.7L V8 OHV 16V CNG</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.8L_V8_OHV_16V" value="5.8L V8 OHV 16V" name="engine[]">
                                                            <label class="form-check-label" for="5.8L_V8_OHV_16V">
                                                            <span>5.8L V8 OHV 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.9L_L6_OHV_24V_TURBO_DIESEL" value="5.9L L6 OHV 24V TURBO DIESEL" name="engine[]">
                                                            <label class="form-check-label" for="5.9L_L6_OHV_24V_TURBO_DIESEL">
                                                            <span>5.9L L6 OHV 24V TURBO DIESEL</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.9L_V12_DOHC_48V" value="5.9L V12 DOHC 48V" name="engine[]">
                                                            <label class="form-check-label" for="5.9L_V12_DOHC_48V">
                                                            <span>5.9L V12 DOHC 48V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="5.9L_V8_OHV_16V" value="5.9L V8 OHV 16V" name="engine[]">
                                                            <label class="form-check-label" for="5.9L_V8_OHV_16V">
                                                            <span>5.9L V8 OHV 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="583CC" value="583CC" name="engine[]">
                                                            <label class="form-check-label" for="583CC">
                                                            <span>583CC</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="6.0L_V12_SOHC_24V" value="6.0L V12 SOHC 24V" name="engine[]">
                                                            <label class="form-check-label" for="6.0L_V12_SOHC_24V">
                                                            <span>6.0L V12 SOHC 24V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="7.3L_V8_OHV_16V_TURBO_DIESEL" value="7.3L V8 OHV 16V TURBO DIESEL" name="engine[]">
                                                            <label class="form-check-label" for="7.3L_V8_OHV_16V_TURBO_DIESEL">
                                                            <span>7.3L V8 OHV 16V TURBO DIESEL</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="7.4L_V8_OHV_16V" value="7.4L V8 OHV 16V" name="engine[]">
                                                            <label class="form-check-label" for="7.4L_V8_OHV_16V">
                                                            <span>7.4L V8 OHV 16V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="745CC" value="745CC" name="engine[]">
                                                            <label class="form-check-label" for="745CC">
                                                            <span>745CC</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="8.3L_V10_OHV_20V" value="8.3L V10 OHV 20V" name="engine[]">
                                                            <label class="form-check-label" for="8.3L_V10_OHV_20V">
                                                            <span>8.3L V10 OHV 20V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="8.4L_V10_OHV_20V" value="8.4L V10 OHV 20V" name="engine[]">
                                                            <label class="form-check-label" for="8.4L_V10_OHV_20V">
                                                            <span>8.4L V10 OHV 20V</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="F512_M" value="F512 M" name="engine[]">
                                                            <label class="form-check-label" for="F512_M">
                                                            <span>F512 M</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="L4101" value="L4101" name="engine[]">
                                                            <label class="form-check-label" for="L4101">
                                                            <span>L4101</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="LG5" value="LG5" name="engine[]">
                                                            <label class="form-check-label" for="LG5">
                                                            <span>LG5</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                    
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

                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Unleaded" value="Unleaded" name="fuel_type[]">
                                                            <label class="form-check-label" for="Unleaded">
                                                            <span>Unleaded</span><span class="filter_count">3947740</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Premium_Unleaded" value="Premium Unleaded" name="fuel_type[]">
                                                            <label class="form-check-label" for="Premium_Unleaded">
                                                            <span>Premium Unleaded</span><span class="filter_count">932772</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Diesel" value="Diesel" name="fuel_type[]">
                                                            <label class="form-check-label" for="Diesel">
                                                            <span>Diesel</span><span class="filter_count">261255</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Electric" value="Electric" name="fuel_type[]">
                                                            <label class="form-check-label" for="Electric">
                                                            <span>Electric</span><span class="filter_count">227082</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="E85_/_Unleaded" value="E85 / Unleaded" name="fuel_type[]">
                                                            <label class="form-check-label" for="E85_/_Unleaded">
                                                            <span>E85 / Unleaded</span><span class="filter_count">190736</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Electric_/_Unleaded" value="Electric / Unleaded" name="fuel_type[]">
                                                            <label class="form-check-label" for="Electric_/_Unleaded">
                                                            <span>Electric / Unleaded</span><span class="filter_count">90591</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Electric_/_Premium_Unleaded" value="Electric / Premium Unleaded" name="fuel_type[]">
                                                            <label class="form-check-label" for="Electric_/_Premium_Unleaded">
                                                            <span>Electric / Premium Unleaded</span><span class="filter_count">59166</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="E85" value="E85" name="fuel_type[]">
                                                            <label class="form-check-label" for="E85">
                                                            <span>E85</span><span class="filter_count">13450</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="E85_/_Premium_Unleaded" value="E85 / Premium Unleaded" name="fuel_type[]">
                                                            <label class="form-check-label" for="E85_/_Premium_Unleaded">
                                                            <span>E85 / Premium Unleaded</span><span class="filter_count">7759</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Premium_Unleaded_/_Unleaded" value="Premium Unleaded / Unleaded" name="fuel_type[]">
                                                            <label class="form-check-label" for="Premium_Unleaded_/_Unleaded">
                                                            <span>Premium Unleaded / Unleaded</span><span class="filter_count">1562</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Unleaded_/_E85" value="Unleaded / E85" name="fuel_type[]">
                                                            <label class="form-check-label" for="Unleaded_/_E85">
                                                            <span>Unleaded / E85</span><span class="filter_count">1365</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Biodiesel" value="Biodiesel" name="fuel_type[]">
                                                            <label class="form-check-label" for="Biodiesel">
                                                            <span>Biodiesel</span><span class="filter_count">547</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Hydrogen" value="Hydrogen" name="fuel_type[]">
                                                            <label class="form-check-label" for="Hydrogen">
                                                            <span>Hydrogen</span><span class="filter_count">355</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Compressed_Natural_Gas" value="Compressed Natural Gas" name="fuel_type[]">
                                                            <label class="form-check-label" for="Compressed_Natural_Gas">
                                                            <span>Compressed Natural Gas</span><span class="filter_count">238</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Electric_/_Hydrogen" value="Electric / Hydrogen" name="fuel_type[]">
                                                            <label class="form-check-label" for="Electric_/_Hydrogen">
                                                            <span>Electric / Hydrogen</span><span class="filter_count">105</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Compressed_Natural_Gas_/_Unleaded" value="Compressed Natural Gas / Unleaded" name="fuel_type[]">
                                                            <label class="form-check-label" for="Compressed_Natural_Gas_/_Unleaded">
                                                            <span>Compressed Natural Gas / Unleaded</span><span class="filter_count">67</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Compressed_Natural_Gas_/_Lpg" value="Compressed Natural Gas / Lpg" name="fuel_type[]">
                                                            <label class="form-check-label" for="Compressed_Natural_Gas_/_Lpg">
                                                            <span>Compressed Natural Gas / Lpg</span><span class="filter_count">35</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Unleaded_/_Premium_Unleaded" value="Unleaded / Premium Unleaded" name="fuel_type[]">
                                                            <label class="form-check-label" for="Unleaded_/_Premium_Unleaded">
                                                            <span>Unleaded / Premium Unleaded</span><span class="filter_count">29</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Electric_/_E85" value="Electric / E85" name="fuel_type[]">
                                                            <label class="form-check-label" for="Electric_/_E85">
                                                            <span>Electric / E85</span><span class="filter_count">27</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Unleaded_/_Electric" value="Unleaded / Electric" name="fuel_type[]">
                                                            <label class="form-check-label" for="Unleaded_/_Electric">
                                                            <span>Unleaded / Electric</span><span class="filter_count">26</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Premium_Unleaded_/_E85" value="Premium Unleaded / E85" name="fuel_type[]">
                                                            <label class="form-check-label" for="Premium_Unleaded_/_E85">
                                                            <span>Premium Unleaded / E85</span><span class="filter_count">16</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Premium_Unleaded_/_Natural_Gas" value="Premium Unleaded / Natural Gas" name="fuel_type[]">
                                                            <label class="form-check-label" for="Premium_Unleaded_/_Natural_Gas">
                                                            <span>Premium Unleaded / Natural Gas</span><span class="filter_count">11</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="M85_/_Unleaded" value="M85 / Unleaded" name="fuel_type[]">
                                                            <label class="form-check-label" for="M85_/_Unleaded">
                                                            <span>M85 / Unleaded</span><span class="filter_count">7</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="Unleaded_/_Natural_Gas" value="Unleaded / Natural Gas" name="fuel_type[]">
                                                            <label class="form-check-label" for="Unleaded_/_Natural_Gas">
                                                            <span>Unleaded / Natural Gas</span><span class="filter_count">1</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                    
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

                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="4WD" value="4WD" name="drivetrain[]">
                                                            <label class="form-check-label" for="4WD">
                                                            <span>4WD</span><span class="filter_count">3529802</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="FWD" value="FWD" name="drivetrain[]">
                                                            <label class="form-check-label" for="FWD">
                                                            <span>FWD</span><span class="filter_count">1564835</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                            <li class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="RWD" value="RWD" name="drivetrain[]">
                                                            <label class="form-check-label" for="RWD">
                                                            <span>RWD</span><span class="filter_count">639767</span>
                                                            </label>
                                                        </li>
                                                    
                                                                                    
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
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="SUV" value="SUV" name="body_type[]">
                                                            <label class="form-check-label" for="SUV">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="SUV">
                                                                    </span>
                                                                    SUV
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">3005701</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Pickup" value="Pickup" name="body_type[]">
                                                            <label class="form-check-label" for="Pickup">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Pickup">
                                                                    </span>
                                                                    Pickup
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">1166892</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Sedan" value="Sedan" name="body_type[]">
                                                            <label class="form-check-label" for="Sedan">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Sedan">
                                                                    </span>
                                                                    Sedan
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">910300</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Hatchback" value="Hatchback" name="body_type[]">
                                                            <label class="form-check-label" for="Hatchback">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Hatchback">
                                                                    </span>
                                                                    Hatchback
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">186101</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Coupe" value="Coupe" name="body_type[]">
                                                            <label class="form-check-label" for="Coupe">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Coupe">
                                                                    </span>
                                                                    Coupe
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">100534</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Minivan" value="Minivan" name="body_type[]">
                                                            <label class="form-check-label" for="Minivan">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Minivan">
                                                                    </span>
                                                                    Minivan
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">94553</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Cargo_Van" value="Cargo Van" name="body_type[]">
                                                            <label class="form-check-label" for="Cargo_Van">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Cargo Van">
                                                                    </span>
                                                                    Cargo Van
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">76166</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Wagon" value="Wagon" name="body_type[]">
                                                            <label class="form-check-label" for="Wagon">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Wagon">
                                                                    </span>
                                                                    Wagon
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">57639</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Convertible" value="Convertible" name="body_type[]">
                                                            <label class="form-check-label" for="Convertible">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Convertible">
                                                                    </span>
                                                                    Convertible
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">52708</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Chassis_Cab" value="Chassis Cab" name="body_type[]">
                                                            <label class="form-check-label" for="Chassis_Cab">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Chassis Cab">
                                                                    </span>
                                                                    Chassis Cab
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">46787</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Cutaway" value="Cutaway" name="body_type[]">
                                                            <label class="form-check-label" for="Cutaway">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Cutaway">
                                                                    </span>
                                                                    Cutaway
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">13302</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Targa" value="Targa" name="body_type[]">
                                                            <label class="form-check-label" for="Targa">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Targa">
                                                                    </span>
                                                                    Targa
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">10667</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Passenger_Van" value="Passenger Van" name="body_type[]">
                                                            <label class="form-check-label" for="Passenger_Van">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Passenger Van">
                                                                    </span>
                                                                    Passenger Van
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">8533</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Car_Van" value="Car Van" name="body_type[]">
                                                            <label class="form-check-label" for="Car_Van">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Car Van">
                                                                    </span>
                                                                    Car Van
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">4797</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Combi" value="Combi" name="body_type[]">
                                                            <label class="form-check-label" for="Combi">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Combi">
                                                                    </span>
                                                                    Combi
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">4766</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Mini_Mpv" value="Mini Mpv" name="body_type[]">
                                                            <label class="form-check-label" for="Mini_Mpv">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Mini Mpv">
                                                                    </span>
                                                                    Mini Mpv
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">4442</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Micro_Car" value="Micro Car" name="body_type[]">
                                                            <label class="form-check-label" for="Micro_Car">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Micro Car">
                                                                    </span>
                                                                    Micro Car
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">535</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Van" value="Van" name="body_type[]">
                                                            <label class="form-check-label" for="Van">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Van">
                                                                    </span>
                                                                    Van
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">30</span>
                                                            </label>

                                                            </li>
                                                                                                                                            <li class="form-check">
                                                            <!-- Checkbox with conditional check for the body type -->
                                                            <input class="form-check-input" type="checkbox" id="Commercial_Wagon" value="Commercial Wagon" name="body_type[]">
                                                            <label class="form-check-label" for="Commercial_Wagon">
                                                                <span class="d-flex align-items-center">
                                                                    <span class="filter_bodyimg">
                                                                        <!-- Use the correct image path -->
                                                                        <img src="https://autopulse.ai/assets/images/suv.png" alt="Commercial Wagon">
                                                                    </span>
                                                                    Commercial Wagon
                                                                </span>
                                                                <!-- Display the count -->
                                                                <span class="filter_count">14</span>
                                                            </label>

                                                            </li>
                                                        
                                                    
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
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="5" type="checkbox" id="5" name="seating_capacity[]">
                                                        <label class="form-check-label" for="5">
                                                            <span>5</span>
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="6" type="checkbox" id="6" name="seating_capacity[]">
                                                        <label class="form-check-label" for="6">
                                                            <span>6</span>
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="7" type="checkbox" id="7" name="seating_capacity[]">
                                                        <label class="form-check-label" for="7">
                                                            <span>7</span>
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="8" type="checkbox" id="8" name="seating_capacity[]">
                                                        <label class="form-check-label" for="8">
                                                            <span>8</span>
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="4" type="checkbox" id="4" name="seating_capacity[]">
                                                        <label class="form-check-label" for="4">
                                                            <span>4</span>
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="3" type="checkbox" id="3" name="seating_capacity[]">
                                                        <label class="form-check-label" for="3">
                                                            <span>3</span>
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="2" type="checkbox" id="2" name="seating_capacity[]">
                                                        <label class="form-check-label" for="2">
                                                            <span>2</span>
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="9" type="checkbox" id="9" name="seating_capacity[]">
                                                        <label class="form-check-label" for="9">
                                                            <span>9</span>
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="12" type="checkbox" id="12" name="seating_capacity[]">
                                                        <label class="form-check-label" for="12">
                                                            <span>12</span>
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="15" type="checkbox" id="15" name="seating_capacity[]">
                                                        <label class="form-check-label" for="15">
                                                            <span>15</span>
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="1" type="checkbox" id="1" name="seating_capacity[]">
                                                        <label class="form-check-label" for="1">
                                                            <span>1</span>
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check col col-4">
                                                        <input class="form-check-input" value="10" type="checkbox" id="10" name="seating_capacity[]">
                                                        <label class="form-check-label" for="10">
                                                            <span>10</span>
                                                        </label>
                                                    </li>
                                                                                    
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
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Black" id="#000000" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#000000"></span>Black</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Gray" id="#808080" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#808080"></span>Gray</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Charcoal" id="#36454F" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#36454F"></span>Charcoal</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Ebony" id="#555D50" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#555D50"></span>Ebony</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Jet Black" id="#0A0A0A" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#0A0A0A"></span>Jet Black</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Tan" id="#D2B48C" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#D2B48C"></span>Tan</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Beige" id="#F5F5DC" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#F5F5DC"></span>Beige</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Medium Dark Slate" id="#2F4F4F" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#2F4F4F"></span>Medium Dark Slate</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Graphite" id="#53565A" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#53565A"></span>Graphite</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Titan Black" id="#3F3F3F" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#3F3F3F"></span>Titan Black</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Brown" id="#A52A2A" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#A52A2A"></span>Brown</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Sandstone" id="#C9B092" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#C9B092"></span>Sandstone</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Red" id="#FF0000" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#FF0000"></span>Red</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Grey" id="#BEBEBE" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#BEBEBE"></span>Grey</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Light Gray" id="#D3D3D3" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#D3D3D3"></span>Light Gray</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="White" id="#FFFFFF" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#FFFFFF"></span>White</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Ivory" id="#FFFFF0" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#FFFFF0"></span>Ivory</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Medium Gray" id="#B2BEB5" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#B2BEB5"></span>Medium Gray</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Cognac" id="#7C4C3A" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#7C4C3A"></span>Cognac</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Dark Gray" id="#A9A9A9" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#A9A9A9"></span>Dark Gray</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Carbon Black" id="Blank" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:Blank"></span>Carbon Black</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Light Slate" id="#B2BEB5" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#B2BEB5"></span>Light Slate</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Black/Black" id="#080808" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#080808"></span>Black/Black</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Cement" id="#D5D5D5" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#D5D5D5"></span>Cement</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Okapi Brown" id="#7B5C38" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#7B5C38"></span>Okapi Brown</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Bk" id="#000000" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#000000"></span>Bk</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Blue" id="#0000FF" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#0000FF"></span>Blue</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Silver" id="#C0C0C0" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#C0C0C0"></span>Silver</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" value="Dark Slate Gray" id="#2F4F4F" name="exterior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#2F4F4F"></span>Dark Slate Gray</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
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
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Black" value="Black" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#000000"></span>Black</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Gray" value="Gray" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#808080"></span>Gray</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Charcoal" value="Charcoal" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#36454F"></span>Charcoal</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Ebony" value="Ebony" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#555D50"></span>Ebony</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Jet_Black" value="Jet Black" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#0A0A0A"></span>Jet Black</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Tan" value="Tan" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#D2B48C"></span>Tan</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Beige" value="Beige" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#F5F5DC"></span>Beige</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Medium_Dark_Slate" value="Medium Dark Slate" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#2F4F4F"></span>Medium Dark Slate</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Graphite" value="Graphite" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#53565A"></span>Graphite</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Titan_Black" value="Titan Black" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#3F3F3F"></span>Titan Black</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Brown" value="Brown" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#A52A2A"></span>Brown</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Sandstone" value="Sandstone" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#C9B092"></span>Sandstone</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Red" value="Red" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#FF0000"></span>Red</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Grey" value="Grey" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#BEBEBE"></span>Grey</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Light_Gray" value="Light Gray" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#D3D3D3"></span>Light Gray</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="White" value="White" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#FFFFFF"></span>White</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Ivory" value="Ivory" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#FFFFF0"></span>Ivory</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Medium_Gray" value="Medium Gray" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#B2BEB5"></span>Medium Gray</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Cognac" value="Cognac" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#7C4C3A"></span>Cognac</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Dark_Gray" value="Dark Gray" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#A9A9A9"></span>Dark Gray</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Carbon_Black" value="Carbon Black" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:Blank"></span>Carbon Black</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Light_Slate" value="Light Slate" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#B2BEB5"></span>Light Slate</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Black/Black" value="Black/Black" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#080808"></span>Black/Black</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Cement" value="Cement" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#D5D5D5"></span>Cement</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Okapi_Brown" value="Okapi Brown" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#7B5C38"></span>Okapi Brown</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Bk" value="Bk" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#000000"></span>Bk</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Blue" value="Blue" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#0000FF"></span>Blue</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Silver" value="Silver" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#C0C0C0"></span>Silver</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        <li class="form-check">
                                                        <input class="form-check-input" type="checkbox" id="Dark_Slate_Gray" value="Dark Slate Gray" name="interior_color[]">
                                                        <label class="form-check-label" for="blackchk1">
                                                            <span class="d-flex align-items-center"><span class="filter_colorSq " style="background-color:#2F4F4F"></span>Dark Slate Gray</span><!--span class="filter_count">4</span-->
                                                        </label>
                                                    </li>
                                                                                        
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
                                            

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="door_mirrors/cameras" value="door mirrors/cameras" name="high_value_features[]">
                                                                <label class="form-check-label" for="door_mirrors/cameras">
                                                                <span>door mirrors/cameras</span><span class="filter_count">5289025</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="automatic_transmission" value="automatic transmission" name="high_value_features[]">
                                                                <label class="form-check-label" for="automatic_transmission">
                                                                <span>automatic transmission</span><span class="filter_count">5251853</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="brake_assist" value="brake assist" name="high_value_features[]">
                                                                <label class="form-check-label" for="brake_assist">
                                                                <span>brake assist</span><span class="filter_count">5202679</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="keyless_entry/locking" value="keyless entry/locking" name="high_value_features[]">
                                                                <label class="form-check-label" for="keyless_entry/locking">
                                                                <span>keyless entry/locking</span><span class="filter_count">5149069</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="bluetooth" value="bluetooth" name="high_value_features[]">
                                                                <label class="form-check-label" for="bluetooth">
                                                                <span>bluetooth</span><span class="filter_count">5141739</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="usb_connection" value="usb connection" name="high_value_features[]">
                                                                <label class="form-check-label" for="usb_connection">
                                                                <span>usb connection</span><span class="filter_count">5128073</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="premium_wheels" value="premium wheels" name="high_value_features[]">
                                                                <label class="form-check-label" for="premium_wheels">
                                                                <span>premium wheels</span><span class="filter_count">4973026</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="parking_distance_system" value="parking distance system" name="high_value_features[]">
                                                                <label class="form-check-label" for="parking_distance_system">
                                                                <span>parking distance system</span><span class="filter_count">4967716</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="gasoline" value="gasoline" name="high_value_features[]">
                                                                <label class="form-check-label" for="gasoline">
                                                                <span>gasoline</span><span class="filter_count">4891640</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="steering_wheel_controls" value="steering wheel controls" name="high_value_features[]">
                                                                <label class="form-check-label" for="steering_wheel_controls">
                                                                <span>steering wheel controls</span><span class="filter_count">4862803</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="voice_recognition" value="voice recognition" name="high_value_features[]">
                                                                <label class="form-check-label" for="voice_recognition">
                                                                <span>voice recognition</span><span class="filter_count">4856479</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="heated_door_mirrors" value="heated door mirrors" name="high_value_features[]">
                                                                <label class="form-check-label" for="heated_door_mirrors">
                                                                <span>heated door mirrors</span><span class="filter_count">4541010</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="smart_card_/_smart_key" value="smart card / smart key" name="high_value_features[]">
                                                                <label class="form-check-label" for="smart_card_/_smart_key">
                                                                <span>smart card / smart key</span><span class="filter_count">4476396</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="keyless_start/remote_engine_start" value="keyless start/remote engine start" name="high_value_features[]">
                                                                <label class="form-check-label" for="keyless_start/remote_engine_start">
                                                                <span>keyless start/remote engine start</span><span class="filter_count">4442221</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="satellite_radio" value="satellite radio" name="high_value_features[]">
                                                                <label class="form-check-label" for="satellite_radio">
                                                                <span>satellite radio</span><span class="filter_count">4437086</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="touch_screen" value="touch screen" name="high_value_features[]">
                                                                <label class="form-check-label" for="touch_screen">
                                                                <span>touch screen</span><span class="filter_count">4360015</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="phone_integration" value="phone integration" name="high_value_features[]">
                                                                <label class="form-check-label" for="phone_integration">
                                                                <span>phone integration</span><span class="filter_count">4315460</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="apple_carplay" value="apple carplay" name="high_value_features[]">
                                                                <label class="form-check-label" for="apple_carplay">
                                                                <span>apple carplay</span><span class="filter_count">4309267</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="touch_screen_audio" value="touch screen audio" name="high_value_features[]">
                                                                <label class="form-check-label" for="touch_screen_audio">
                                                                <span>touch screen audio</span><span class="filter_count">4267772</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="android_auto" value="android auto" name="high_value_features[]">
                                                                <label class="form-check-label" for="android_auto">
                                                                <span>android auto</span><span class="filter_count">4256251</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="anti_collision_system" value="anti collision system" name="high_value_features[]">
                                                                <label class="form-check-label" for="anti_collision_system">
                                                                <span>anti collision system</span><span class="filter_count">4133330</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="parking_assistance" value="parking assistance" name="high_value_features[]">
                                                                <label class="form-check-label" for="parking_assistance">
                                                                <span>parking assistance</span><span class="filter_count">3900694</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="lane_keep_assist" value="lane keep assist" name="high_value_features[]">
                                                                <label class="form-check-label" for="lane_keep_assist">
                                                                <span>lane keep assist</span><span class="filter_count">3764756</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="heated_seats" value="heated seats" name="high_value_features[]">
                                                                <label class="form-check-label" for="heated_seats">
                                                                <span>heated seats</span><span class="filter_count">3614867</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="blind_spot_system" value="blind spot system" name="high_value_features[]">
                                                                <label class="form-check-label" for="blind_spot_system">
                                                                <span>blind spot system</span><span class="filter_count">3539870</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="backup_camera" value="backup camera" name="high_value_features[]">
                                                                <label class="form-check-label" for="backup_camera">
                                                                <span>backup camera</span><span class="filter_count">3490798</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="wifi_hotspot" value="wifi hotspot" name="high_value_features[]">
                                                                <label class="form-check-label" for="wifi_hotspot">
                                                                <span>wifi hotspot</span><span class="filter_count">3460014</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="collision/breakdown_telematics" value="collision/breakdown telematics" name="high_value_features[]">
                                                                <label class="form-check-label" for="collision/breakdown_telematics">
                                                                <span>collision/breakdown telematics</span><span class="filter_count">3346600</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="aux_jack_input" value="aux jack input" name="high_value_features[]">
                                                                <label class="form-check-label" for="aux_jack_input">
                                                                <span>aux jack input</span><span class="filter_count">3135650</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="fog_lights" value="fog lights" name="high_value_features[]">
                                                                <label class="form-check-label" for="fog_lights">
                                                                <span>fog lights</span><span class="filter_count">2818456</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="adaptive_cruise_control" value="adaptive cruise control" name="high_value_features[]">
                                                                <label class="form-check-label" for="adaptive_cruise_control">
                                                                <span>adaptive cruise control</span><span class="filter_count">2788291</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="navigation" value="navigation" name="high_value_features[]">
                                                                <label class="form-check-label" for="navigation">
                                                                <span>navigation</span><span class="filter_count">2708114</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="autonomous_drive_functions" value="autonomous drive functions" name="high_value_features[]">
                                                                <label class="form-check-label" for="autonomous_drive_functions">
                                                                <span>autonomous drive functions</span><span class="filter_count">2643423</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="trailer_assist" value="trailer assist" name="high_value_features[]">
                                                                <label class="form-check-label" for="trailer_assist">
                                                                <span>trailer assist</span><span class="filter_count">2528115</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="coming_home_device" value="coming home device" name="high_value_features[]">
                                                                <label class="form-check-label" for="coming_home_device">
                                                                <span>coming home device</span><span class="filter_count">2474629</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="premium_audio" value="premium audio" name="high_value_features[]">
                                                                <label class="form-check-label" for="premium_audio">
                                                                <span>premium audio</span><span class="filter_count">2453423</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="sun/moonroof" value="sun/moonroof" name="high_value_features[]">
                                                                <label class="form-check-label" for="sun/moonroof">
                                                                <span>sun/moonroof</span><span class="filter_count">2116844</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="wireless_charging/connection" value="wireless charging/connection" name="high_value_features[]">
                                                                <label class="form-check-label" for="wireless_charging/connection">
                                                                <span>wireless charging/connection</span><span class="filter_count">1964370</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="memory_seats" value="memory seats" name="high_value_features[]">
                                                                <label class="form-check-label" for="memory_seats">
                                                                <span>memory seats</span><span class="filter_count">1945515</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="power_closing_liftgate" value="power closing liftgate" name="high_value_features[]">
                                                                <label class="form-check-label" for="power_closing_liftgate">
                                                                <span>power closing liftgate</span><span class="filter_count">1922490</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="leather_seats" value="leather seats" name="high_value_features[]">
                                                                <label class="form-check-label" for="leather_seats">
                                                                <span>leather seats</span><span class="filter_count">1922147</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="power_closing_doors" value="power closing doors" name="high_value_features[]">
                                                                <label class="form-check-label" for="power_closing_doors">
                                                                <span>power closing doors</span><span class="filter_count">1833333</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="autonomous_drive_-_level_2" value="autonomous drive - level 2" name="high_value_features[]">
                                                                <label class="form-check-label" for="autonomous_drive_-_level_2">
                                                                <span>autonomous drive - level 2</span><span class="filter_count">1741348</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="memory_mirrors" value="memory mirrors" name="high_value_features[]">
                                                                <label class="form-check-label" for="memory_mirrors">
                                                                <span>memory mirrors</span><span class="filter_count">1720074</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="leatherette_seats" value="leatherette seats" name="high_value_features[]">
                                                                <label class="form-check-label" for="leatherette_seats">
                                                                <span>leatherette seats</span><span class="filter_count">1226227</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="heated/cooled_seats" value="heated/cooled seats" name="high_value_features[]">
                                                                <label class="form-check-label" for="heated/cooled_seats">
                                                                <span>heated/cooled seats</span><span class="filter_count">1142680</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="hands_free_tailgate/trunk_release" value="hands free tailgate/trunk release" name="high_value_features[]">
                                                                <label class="form-check-label" for="hands_free_tailgate/trunk_release">
                                                                <span>hands free tailgate/trunk release</span><span class="filter_count">1131831</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="rear/multi-zone_air_conditioning" value="rear/multi-zone air conditioning" name="high_value_features[]">
                                                                <label class="form-check-label" for="rear/multi-zone_air_conditioning">
                                                                <span>rear/multi-zone air conditioning</span><span class="filter_count">1021234</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="panoramic_sun/moonroof" value="panoramic sun/moonroof" name="high_value_features[]">
                                                                <label class="form-check-label" for="panoramic_sun/moonroof">
                                                                <span>panoramic sun/moonroof</span><span class="filter_count">1011521</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="directional_headlights" value="directional headlights" name="high_value_features[]">
                                                                <label class="form-check-label" for="directional_headlights">
                                                                <span>directional headlights</span><span class="filter_count">907162</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="3rd_row_seats" value="3rd row seats" name="high_value_features[]">
                                                                <label class="form-check-label" for="3rd_row_seats">
                                                                <span>3rd row seats</span><span class="filter_count">901132</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="autonomous_drive_-_level_1" value="autonomous drive - level 1" name="high_value_features[]">
                                                                <label class="form-check-label" for="autonomous_drive_-_level_1">
                                                                <span>autonomous drive - level 1</span><span class="filter_count">847358</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="memory_steering_wheel_position" value="memory steering wheel position" name="high_value_features[]">
                                                                <label class="form-check-label" for="memory_steering_wheel_position">
                                                                <span>memory steering wheel position</span><span class="filter_count">721792</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="hybrid" value="hybrid" name="high_value_features[]">
                                                                <label class="form-check-label" for="hybrid">
                                                                <span>hybrid</span><span class="filter_count">617828</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="short_pickup_bed" value="short pickup bed" name="high_value_features[]">
                                                                <label class="form-check-label" for="short_pickup_bed">
                                                                <span>short pickup bed</span><span class="filter_count">614596</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="cvt_transmission" value="cvt transmission" name="high_value_features[]">
                                                                <label class="form-check-label" for="cvt_transmission">
                                                                <span>cvt transmission</span><span class="filter_count">588008</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="concierge_services" value="concierge services" name="high_value_features[]">
                                                                <label class="form-check-label" for="concierge_services">
                                                                <span>concierge services</span><span class="filter_count">410676</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="pickup_bed_liner" value="pickup bed liner" name="high_value_features[]">
                                                                <label class="form-check-label" for="pickup_bed_liner">
                                                                <span>pickup bed liner</span><span class="filter_count">406389</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="video_entertainment" value="video entertainment" name="high_value_features[]">
                                                                <label class="form-check-label" for="video_entertainment">
                                                                <span>video entertainment</span><span class="filter_count">377777</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="active_hybrid" value="active hybrid" name="high_value_features[]">
                                                                <label class="form-check-label" for="active_hybrid">
                                                                <span>active hybrid</span><span class="filter_count">357452</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="electric" value="electric" name="high_value_features[]">
                                                                <label class="form-check-label" for="electric">
                                                                <span>electric</span><span class="filter_count">340880</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="plug-in_hybrid" value="plug-in hybrid" name="high_value_features[]">
                                                                <label class="form-check-label" for="plug-in_hybrid">
                                                                <span>plug-in hybrid</span><span class="filter_count">338567</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="regular_pickup_bed" value="regular pickup bed" name="high_value_features[]">
                                                                <label class="form-check-label" for="regular_pickup_bed">
                                                                <span>regular pickup bed</span><span class="filter_count">316085</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="trailer_tow_mirrors" value="trailer tow mirrors" name="high_value_features[]">
                                                                <label class="form-check-label" for="trailer_tow_mirrors">
                                                                <span>trailer tow mirrors</span><span class="filter_count">311691</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="convertible_roof" value="convertible roof" name="high_value_features[]">
                                                                <label class="form-check-label" for="convertible_roof">
                                                                <span>convertible roof</span><span class="filter_count">232546</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="diesel" value="diesel" name="high_value_features[]">
                                                                <label class="form-check-label" for="diesel">
                                                                <span>diesel</span><span class="filter_count">213689</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="manual_transmission" value="manual transmission" name="high_value_features[]">
                                                                <label class="form-check-label" for="manual_transmission">
                                                                <span>manual transmission</span><span class="filter_count">193034</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="massage_seats" value="massage seats" name="high_value_features[]">
                                                                <label class="form-check-label" for="massage_seats">
                                                                <span>massage seats</span><span class="filter_count">170525</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="hands_free_liftgate" value="hands free liftgate" name="high_value_features[]">
                                                                <label class="form-check-label" for="hands_free_liftgate">
                                                                <span>hands free liftgate</span><span class="filter_count">140087</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="long_pickup_bed" value="long pickup bed" name="high_value_features[]">
                                                                <label class="form-check-label" for="long_pickup_bed">
                                                                <span>long pickup bed</span><span class="filter_count">134127</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="mirrorlink" value="mirrorlink" name="high_value_features[]">
                                                                <label class="form-check-label" for="mirrorlink">
                                                                <span>mirrorlink</span><span class="filter_count">125651</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="dynamic_steering" value="dynamic steering" name="high_value_features[]">
                                                                <label class="form-check-label" for="dynamic_steering">
                                                                <span>dynamic steering</span><span class="filter_count">108656</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="matrix_headlight_control" value="matrix headlight control" name="high_value_features[]">
                                                                <label class="form-check-label" for="matrix_headlight_control">
                                                                <span>matrix headlight control</span><span class="filter_count">76190</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="dual_rear_wheels" value="dual rear wheels" name="high_value_features[]">
                                                                <label class="form-check-label" for="dual_rear_wheels">
                                                                <span>dual rear wheels</span><span class="filter_count">71625</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="4-wheel_steering" value="4-wheel steering" name="high_value_features[]">
                                                                <label class="form-check-label" for="4-wheel_steering">
                                                                <span>4-wheel steering</span><span class="filter_count">50355</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="facial/gesture_control" value="facial/gesture control" name="high_value_features[]">
                                                                <label class="form-check-label" for="facial/gesture_control">
                                                                <span>facial/gesture control</span><span class="filter_count">50282</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="hdmi_connection" value="hdmi connection" name="high_value_features[]">
                                                                <label class="form-check-label" for="hdmi_connection">
                                                                <span>hdmi connection</span><span class="filter_count">42580</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="pickup_bed_cover" value="pickup bed cover" name="high_value_features[]">
                                                                <label class="form-check-label" for="pickup_bed_cover">
                                                                <span>pickup bed cover</span><span class="filter_count">33109</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="pickup_bed_extender" value="pickup bed extender" name="high_value_features[]">
                                                                <label class="form-check-label" for="pickup_bed_extender">
                                                                <span>pickup bed extender</span><span class="filter_count">24933</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="premium_cup_holders" value="premium cup holders" name="high_value_features[]">
                                                                <label class="form-check-label" for="premium_cup_holders">
                                                                <span>premium cup holders</span><span class="filter_count">4898</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="autonomous_drive_-_level_3" value="autonomous drive - level 3" name="high_value_features[]">
                                                                <label class="form-check-label" for="autonomous_drive_-_level_3">
                                                                <span>autonomous drive - level 3</span><span class="filter_count">1001</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="heated_door_locks" value="heated door locks" name="high_value_features[]">
                                                                <label class="form-check-label" for="heated_door_locks">
                                                                <span>heated door locks</span><span class="filter_count">529</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="hydrogen" value="hydrogen" name="high_value_features[]">
                                                                <label class="form-check-label" for="hydrogen">
                                                                <span>hydrogen</span><span class="filter_count">439</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="compressed_natural_gas" value="compressed natural gas" name="high_value_features[]">
                                                                <label class="form-check-label" for="compressed_natural_gas">
                                                                <span>compressed natural gas</span><span class="filter_count">342</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="electric_hybrid" value="electric hybrid" name="high_value_features[]">
                                                                <label class="form-check-label" for="electric_hybrid">
                                                                <span>electric hybrid</span><span class="filter_count">332</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="turbo_boost" value="turbo boost" name="high_value_features[]">
                                                                <label class="form-check-label" for="turbo_boost">
                                                                <span>turbo boost</span><span class="filter_count">250</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="biodiesel" value="biodiesel" name="high_value_features[]">
                                                                <label class="form-check-label" for="biodiesel">
                                                                <span>biodiesel</span><span class="filter_count">17</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="lpg" value="lpg" name="high_value_features[]">
                                                                <label class="form-check-label" for="lpg">
                                                                <span>lpg</span><span class="filter_count">8</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="heads_up_display" value="heads up display" name="high_value_features[]">
                                                                <label class="form-check-label" for="heads_up_display">
                                                                <span>heads up display</span><span class="filter_count">2</span>
                                                                </label>
                                                            </li>

                                                                                                    <li class="form-check">
                                                                <input class="form-check-input" type="checkbox" id="parking_radar" value="parking radar" name="high_value_features[]">
                                                                <label class="form-check-label" for="parking_radar">
                                                                <span>parking radar</span><span class="filter_count">2</span>
                                                                </label>
                                                            </li>

                                                        
                                                    
                                                </ul>
                                            </div>
                                        </div>
                                        <input type="hidden" name="life_style" id="lifesytle" value="">
                                        <input type="hidden" name="popular" id="popular" value="">
                                        <input type="hidden" name="Latest" id="Latest" value="">

                                        <input type="hidden" name="sort_by" id="sort_by" value="price">
                                        <input type="hidden" name="sort_order" id="sort_order" value="desc">
                                        <input type="hidden" name="price_range" id="price_range" value="">
                                        <input type="hidden" name="miles_range" id="miles_range" value="">
                                        <input type="hidden" name="year_range" id="year_range" value="">
                                    </form>
                                </div>
                                <!-- explore filter end -->
                            </div>
                        </div>

                        <div class="col col-12 explore_list_col">
                            <div class="position-relative explore_list">
                                <div class="position-relative listing_filter_sort">
                                    <div class="row">
                                        <div class="col col-lg-6 col-6 d-flex align-items-center">
                                            <!-- Filter Tab for open -->
                                            <div class="position-relative listing_filter_icon">
                                                <a class="navbar-toggler listing_filter_collapse">
                                                    <i class="fa-solid fa-filter me-2"></i>Filter
                                                </a>
                                            </div>
                                        </div>
                                        <div class="col col-lg-6 col-6">
                                            <!-- Sort By -->
                                            <div class="position-relative listing_sort ms-auto">
                                                <select class="form-select mb-0" id="sorting" onchange="updateSortFields()">
                                                    <option selected="">Relevance</option>
                                                    <option value="price-asc">Price - Low to High</option>
                                                    <option value="price-desc" selected="">Price - High to Low</option>
                                                    <option value="miles-asc">Miles - Low to High</option>
                                                    <option value="miles-desc">Miles - High to Low</option>
                                                    <option value="year-asc">Year - Low to High</option>
                                                    <option value="year-desc">Year - High to Low</option>
                                                    <option value="dom-asc">Latest Cars</option>
                                                    <option value="dom-desc">Oldest Cars</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div class="col col-lg-10 col-12">
                                            <!-- Filter Tags -->
                                            <div class="tags-container">
                                                <form id="filter-form" action="" method="GET" cr-attached="true">
                                                    <span class="tag" style="display:none;">50<a href="javascript:void(0);" class="tag-remove" data-key="radius" data-value="50">×</a></span>
                                                    <span class="tag" style="display:none;">price<a href="javascript:void(0);" class="tag-remove" data-key="sort_by" data-value="price">×</a></span>
                                                    <span class="tag" style="display:none;">desc<a href="javascript:void(0);" class="tag-remove" data-key="sort_order" data-value="desc">×</a></span>
                                                </form>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="position-relative">
                                    <div class="row g-2 m-0">
                                        <?php  
                                            for ($x = 1; $x <= 5; $x++) {
                                        ?>
                                        <div class="col col-12 chatbx_card_col">
                                            <div class="chatbx_car_card chatbx_explore_card">
                                                <!-- Favorite and share -->
                                                <div class="like_share_icon details_like_share">
                                                    <div class="form-check fevCheck">
                                                        <input type="checkbox" class="form-check-input" id="btn-check_1"  onclick="makeFavourite(this,'1','1','')">
                                                        <label class="form-check-label" for="btn-check_1"><i class="fas fa-heart" id="heart-icon_1"></i></label>
                                                    </div>

                                                    <!-- Share Icon -->
                                                    <div class="share_icon">
                                                        <i class="fa-regular fa-share-from-square"  onclick="showSharePopup(`1`, '1,1', '2020 test modal123')"></i>
                                                    </div>
                                                </div>

                                                <a href="javascript:void(0)" class="chatbxfulldetail_show_btn">
                                                    <img src="./assets/images/newjeep.jpg" alt="car">
                                                    <div class="chatbx_carcard_content">
                                                        <h3>2022 Jeep Compass</h3>
                                                        <div class="chatbx_carcard_loc_price">
                                                            <div class="chatbx_car_loc">
                                                                <i class="fa-solid fa-location-dot me-2"></i><span>Oneida NY</span>
                                                            </div>
                                                            <h5>$35,304</h5>                                                
                                                        </div>
                                                        <hr>
                                                        <div class="car_spec">
                                                            <span class="car_spec_year">212 Miles</span>
                                                            <div class="car_spec_info">
                                                                <span>test</span>&nbsp;|&nbsp;<span>test</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </a>
                                            </div>
                                        </div>
                                        <?php  
                                            }
                                        ?>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                 
                <!-- Loader -->
                <div class="chatbx_msg_loader" id="loader" style="display:none;">
                    <div class="chatbx_msg_l chatbx_msg_loader_inn">
                        <small>Typing</small><div class="dot-pulse"></div>
                    </div>
                </div>
                
            </div>

            <!-- Close Confirmation -->
            <div class="chatbx_close_conf" style="display:none;">
                <div class="chatbx_close_msg">
                    <p><small>Are you sure? this action will delete your previous conversion?</small></p>
                    <div class="chatbx_closemsg_btns">
                        <a class="btn btn_chatbx chatbx_close_yes">Yes</a>
                        <a class="btn btn_chatbx chatbx_close_no">No</a>
                    </div>
                </div>
            </div>

            <!-- Search Input + Btn -->
            <div class="chatbx_input">
                <div class="input-group align-items-center flex-nowrap">
                    <input type="text" class="form-control mb-0 border-0" id="userInput" placeholder="Type any questions here...">
                    <a id="sendBtn" class="px-2"><i class="fa-solid fa-paper-plane-top"></i></a>
                </div>
                <small id="charCount" class="text-muted">0/2000</small>
            </div>
        </div>
    </div>
</div>

<div class="modal fade" id="chattreqInfoConfirmationModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
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

@push('after-scripts')
<script>
    $(document).on('click', '.chatbx_cars_slides .owl-next', function() {
        if ($('.chatbx_main').hasClass('collapsed')) {
            $('.chatbx_main').removeClass('collapsed');
        }
    });

    $(document).on('click', '.chatbx_cars_slides .owl-prev', function() {
        if ($('.chatbx_main').hasClass('collapsed')) {
            $('.chatbx_main').removeClass('collapsed');
        }
    });

    function initializeChatbot() {

        if ($('.chatbx_main').hasClass('fullScreen') == false) {
            var chatbxWindowHeight = $('.chatbx_primary').innerHeight() - ($('.chatbx_head').innerHeight() + $('.chatbx_input').innerHeight());
            $('.chatbx_window').css({'min-height': chatbxWindowHeight, 'max-height': chatbxWindowHeight});
            $('.chatbx_primary').innerWidth('350px');
            $('body').css('overflow', 'unset');
            $('.chatbx_card_col').removeClass('col-lg-4 col-md-6');
            $('.explore_filters_col').removeClass('col-lg-3');
            $('.explore_list_col').removeClass('col-lg-9');
            chatbxFulldetails();

        } else {
            var chatbxWindowHeight = $(window).height() - ($('.chatbx_primary .chatbx_head').innerHeight() + $('.chatbx_primary .chatbx_input').innerHeight());
            $('.chatbx_window').css({'min-height': chatbxWindowHeight, 'max-height': chatbxWindowHeight});
            $('.chatbx_window').css('overflow-y', 'auto');
            $('body').css('overflow', 'hidden');

            if($(window).width() < 991 && $(window).width() > 600){
                var primaryWidth = $('.chatbx_main').innerWidth() / 1.6;
            } else if($(window).width() < 600){
                var primaryWidth = $('.chatbx_main').innerWidth();
            } else{
                var primaryWidth = $('.chatbx_main').innerWidth() / 2;
            }
            $('.chatbx_primary').innerWidth(primaryWidth);
            $('.chatbx_card_col').addClass('col-lg-4 col-md-6');
            $('.explore_filters_col').addClass('col-lg-3');
            $('.explore_list_col').addClass('col-lg-9');
            chatbxFulldetails();
        }

        if ($('.chatbx_main').hasClass('fullScreen') && $(window).width() > 1500) {
            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
            $('.chatbx_cars_slides').owlCarousel({
                items: 4,
                loop: true,
                margin: 10,
                dots: false,
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
            });
        } else if ($('.chatbx_main').hasClass('fullScreen') && $(window).width() > 991) {
            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
            $('.chatbx_cars_slides').owlCarousel({
                items: 3,
                loop: true,
                margin: 10,
                dots: false,
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
            });
        } else if ($('.chatbx_main').hasClass('fullScreen') && $(window).width() > 600) {
            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
            $('.chatbx_cars_slides').owlCarousel({
                items: 2,
                loop: true,
                margin: 10,
                dots: false,
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
            });                            
        } else {
            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
            $('.chatbx_cars_slides').owlCarousel({
                items: 1,
                loop: true,
                margin: 10,
                dots: false,
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
            });                            
        }  
    }

    function resetchatbx() {
        $('body').css('overflow', 'unset');
        $('.chatbx_main').removeClass('collapsed');
        $('.chatbx_main').removeClass('fullScreen');
        $('.chatbx_req_info').removeClass('chatbxreq_show');
        $('.chatbx_fulldetail_info').removeClass('chatbxdetails_show');
    }

    // Call the function to initialize chatbot on page load
    $(document).ready(function() {
        initializeChatbot();

        $('.chatboxO_a').click(function(e) {
           
            if($('.chatbx_main').hasClass('chat_open')){
                $('.chatbx_window').css('overflow-y', 'hidden');
                $('.chatbx_main').removeClass('collapsed');
                $('.chatbx_close_conf').css('display', 'block'); 
            } else {
                $('.chatbx_main').addClass('chat_open');
            }
            hidePopup()    
            // $('.chatbx_main').toggleClass('chat_open');
            // resetchatbx();
            // initializeChatbot();
        });
        $('.chatbx_close_yes').click(function(e) {
            $('.chatbx_close_conf').css('display', 'none');        
            $('.chatbx_window').css('overflow-y', 'auto');
            $('.chatbx_main').removeClass('chat_open');
            $('.chatbx_response').html(` <div class="chatbx_msg_l"><small>Hello, my name is Autopulse, your AI automotive concierge.</small></div>`);
             conversation_id = '';
             context = '';
             lastUserInput = '';
             lastFormData = {};
            resetchatbx();
            initializeChatbot();
        });
        $('.chatbx_close_no').click(function(e) {
            $('.chatbx_close_conf').css('display', 'none');        
            $('.chatbx_window').css('overflow-y', 'auto');
        });

        $('body').on('click', '.btn_expand', function(e) {
            vehicle  = JSON.parse($(this).attr('data_attr'));
            href  = ($(this).attr('data_href'));
            $('#full_detail_href').attr('href', href);
            console.log(vehicle);
            var image = vehicle?.['media']?.['photo_links']?.[0] ?? '';
            var title = `${vehicle?.['build']?.['year'] ?? ''} ${vehicle?.['build']?.['make'] ?? ''} ${vehicle?.['build']?.['model'] ?? ''}`;
            var location = `${vehicle?.['dealer']?.['city'] ?? ''} ${vehicle?.['dealer']?.['state'] ?? ''}`;
            var price = vehicle?.['price'] ? `$${Math.floor(vehicle['price']).toLocaleString('en-US')}` : 'N/A';


            $('#image_car_detail').attr('src', image);
            $('.car_title').html(title);
            $('#dealer_car_location').html(location);
            $('#dealer_car_price').html(price);
            $('#car_attribute').html('');
            $('#vid').val(vehicle?.id ?? '');

            var vehicle_detail = '';

            vehicle_detail += `<li class="col col-6">
                <div class="position-relative chatbx_cardetails_spec">
                    <i class="fa-regular fa-square-check"></i>
                    <div class="position-relative d-inline-block">
                        <p><small>Body Type</small></p>
                        <p>${vehicle?.['build']?.['body_type'] ?? ''}</p>
                    </div>
                </div>
            </li>`;

            vehicle_detail += `<li class="col col-6">
                <div class="position-relative chatbx_cardetails_spec">
                    <i class="fa-regular fa-square-check"></i>
                    <div class="position-relative d-inline-block">
                        <p><small>Trim</small></p>
                        <p>${vehicle?.['build']?.['trim'] ?? ''}</p>
                    </div>
                </div>
            </li>`;

            vehicle_detail += `<li class="col col-6">
                <div class="position-relative chatbx_cardetails_spec">
                    <i class="fa-regular fa-square-check"></i>
                    <div class="position-relative d-inline-block">
                        <p><small>Engine</small></p>
                        <p>${vehicle?.['build']?.['engine'] ?? ''}</p>
                    </div>
                </div>
            </li>`;

            vehicle_detail += `<li class="col col-6">
                <div class="position-relative chatbx_cardetails_spec">
                    <i class="fa-regular fa-square-check"></i>
                    <div class="position-relative d-inline-block">
                        <p><small>Transmission</small></p>
                        <p>${vehicle?.['build']?.['transmission'] ?? ''}</p>
                    </div>
                </div>
            </li>`;

            vehicle_detail += `<li class="col col-6">
                <div class="position-relative chatbx_cardetails_spec">
                    <i class="fa-regular fa-square-check"></i>
                    <div class="position-relative d-inline-block">
                        <p><small>Fuel Type</small></p>
                        <p>${vehicle?.['build']?.['fuel_type'] ?? ''}</p>
                    </div>
                </div>
            </li>`;

            vehicle_detail += `<li class="col col-6">
                <div class="position-relative chatbx_cardetails_spec">
                    <i class="fa-regular fa-square-check"></i>
                    <div class="position-relative d-inline-block">
                        <p><small>Drive Train</small></p>
                        <p>${vehicle?.['build']?.['drivetrain'] ?? ''}</p>
                    </div>
                </div>
            </li>`;

            $('#car_attribute').html(vehicle_detail);

            $('.chatbx_main').addClass('collapsed');
        });
        // collapse sections
        
        $('.chatbxfulldetail_show_btn').click(function(e) {
            fulldetailslider();
            setTimeout(function() {
                $('.chatbx_fulldetail_info').toggleClass('chatbxdetails_show');
                chatbxSidebarCollapsed();
            }, 400);
            
        });

        $('.chatbxreq_show_btn').click(function(e) {
            $('.chatbx_req_info').toggleClass('chatbxreq_show');
        });

        $('.full_screen').click(function(e) {
            $('.chatbx_main').toggleClass('fullScreen');
            chatbxListingFilter();
            initializeChatbot();
        });

        // Minimize
        $('.mini_a').click(function(e) {
            if($('.chatbx_main').hasClass('chat_open')){       
                $('.chatbx_main').removeClass('chat_open');
            } else {
                $('.chatbx_main').addClass('chat_open');
            }
            // if($('.chatbx_main').hasClass('fullScreen')){
            //     $('.chatbx_main').removeClass('fullScreen');
            //     initializeChatbot();
            // }    
            // $('.chatbx_main').toggleClass('minimize');    
        });
    });

    var conversation_id = '';
    var context = '';
    var lastUserInput = '';
    var lastFormData = {};
    var resendBtn = '<a id="resendBtn" class="px-2"><i class="fa-solid fa-redo"></i></a>';
    
    $(document).ready(function() {
        $('#sendBtn').on('click', function() {
            if (!$(this).hasClass('chatbx_disable')) {
                sendUserMessage();
            }
        });

        $('#resendBtn').on('click', function() {
            resendLastMessage();
        });

        $('#userInput').on('keypress', function(e) {
            var userInput = $(this).val();
            $('#charCount').text(userInput.length + '/2000');

            if (userInput.length > 2000) {
                e.preventDefault();
                alert('Query should not be more than 2000 characters.');
            }

            if (e.which === 13) { // Enter key pressed
                if (!$('#sendBtn').hasClass('chatbx_disable')) {
                    sendUserMessage();
                }
            }
        });
    });


        function sendUserMessage() {
            var userInput = $('#userInput').val().trim();

            if (userInput === '') {
                return;
            }

            if (userInput.length > 2000) {
                alert('Query should not be more than 2000 characters.');
                return;
            }

            lastUserInput = userInput;

            // Append user's message to chatbox
            $('.chatbx_response').append('<div class="chatbx_msg_r"><small>' + userInput + '</small><span class="ch_time">' + getCurrentTime() + '</span></div>');
            $('#userInput').val('');
            $('#charCount').text('0/2000');

            // Show the loader
            $('#loader').show();
            $('#sendBtn').addClass('chatbx_disable');
            formData = {
                "request": userInput,
                "context": context,
                "conversation_id": conversation_id,
            };

            lastFormData = formData;

            url = '{{route("chat")}}';
            chatajax(url, formData, 'post', '', 'json', function(response) {
                $('#loader').hide();
               
                if (response) {
                    conversation_id = response.conversation_id;
                    if(response.rawoutput !='Thank you for the question. This topic is beyond my training with providing support for automotive shoppers. I suggest using different resources. Are you interested in purchasing a new or pre-owned vehicle?')
                    context += response.rawoutput;

                    // Parse and display the response in the chatbox
                    var responseText = formatApiResponse(response);
                    var html = response.html;

                    $('.chatbx_response').append('<div class="chatbx_msg_l"><small>' + responseText + '</small><span class="ch_time">' + getCurrentTime() + '</span></div>');
                    var carhtml = '';
                    if (html) {
                        carhtml = `<div class="chatbx_car_card_main">
                            <div class="owl-carousel owl-theme chatbx_cars_slides circular_nav">` + html + `</div>
                            <span class="ch_time">` + getCurrentTime() + `</span></div>`;
                        $('.chatbx_response').append(carhtml);
                    }
                    if (carhtml) {
                        $('.chatbx_cars_slides').trigger('destroy.owl.carousel').removeClass('owl-carousel owl-loaded');
                        if ($('.chatbx_main').hasClass('fullScreen') && $(window).width() > 1500) {
                            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
                            $('.chatbx_cars_slides').owlCarousel({
                                items: 4,
                                loop: true,
                                margin: 10,
                                dots: false,
                                nav: true,
                                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
                            });
                        } else if ($('.chatbx_main').hasClass('fullScreen') && $(window).width() > 991) {
                            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
                            $('.chatbx_cars_slides').owlCarousel({
                                items: 3,
                                loop: true,
                                margin: 10,
                                dots: false,
                                nav: true,
                                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
                            });
                        } else if ($('.chatbx_main').hasClass('fullScreen') && $(window).width() > 600) {
                            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
                            $('.chatbx_cars_slides').owlCarousel({
                                items: 2,
                                loop: true,
                                margin: 10,
                                dots: false,
                                nav: true,
                                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
                            });                            
                        } else {
                            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
                            $('.chatbx_cars_slides').owlCarousel({
                                items: 1,
                                loop: true,
                                margin: 10,
                                dots: false,
                                nav: true,
                                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
                            });                            
                        }
                        $('.chatbx_cars_slides').addClass('owl-carousel owl-loaded');
                    }
                    console.log($('.chatbx_window')[0].scrollHeight);
                    setTimeout(function() {
                        $('.chatbx_window').scrollTop($('.chatbx_window')[0].scrollHeight);
                    }, 100);
                    $('.chatbx_window').scrollTop  = $('.chatbx_window')[0].scrollHeight;
                    $('.chatbx_window').scrollTop($('.chatbx_window')[0].scrollHeight);
                } else {
                    displayErrorMessage('Failed to fetch data from the API');
                }
                $('.chatbx_response').scrollTop($('.chatbx_response')[0].scrollHeight);
            });
        }

       

        function formatApiResponse(response) {
            if (response && response.response) {
                let data;
                    try {
                        data = JSON.parse(response.response);
                    } catch (e) {
                        console.error('Failed to parse response as JSON:', e);
                        return '<p>'+response.rawoutput+'</p>';
                    }

                    if (!data || typeof data !== 'object') {
                        return '<p>'+response.rawoutput+'</p>';
                    }
           
           
                console.log(data);
                let formattedResponse = '';

                if (data.heading) {
                    formattedResponse += `<h5>${data.heading}</h5>`;
                }

                if (data.subheading) {
                    formattedResponse += `<h6>${data.subheading}</h6>`;
                }

                if (data.paragraphs && data.paragraphs.length > 0) {
                    data.paragraphs.forEach(paragraph => {
                        formattedResponse += `<p>${paragraph}</p>`;
                    });
                }

                if (data.list && data.list.length > 0) {
                    formattedResponse += '<ul>';
                    data.list.forEach(item => {
                        formattedResponse += `<li>${item}</li>`;
                    });
                    formattedResponse += '</ul>';
                }

                return formattedResponse;
            }else{
                return response.rawoutput;
            }
            //return 'No response received from the API.';
            return 'No response received from the API.';
        }

       

       
  
function displayErrorMessage(message) {
        $('.chatbx_response').append('<div class="chatbx_msg_l"><small>' + message + '</small><span class="ch_time">' + getCurrentTime() + '</span></div>' + resendBtn);
        $('.chatbx_response').scrollTop($('.chatbx_response')[0].scrollHeight);

        $('#resendBtn').on('click', function() {
            resendLastMessage();
        });
}
function resendLastMessage() {
    if (lastUserInput !== '') {
        $('#userInput').val(lastUserInput);
        sendUserMessage();
    }
}
function getCurrentTime() {
    var now = new Date();
    return now.getHours() + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();
}
function saverequest()
    {

        url = '{{ route("visitStore") }}';
        formData = $('#validaterequest').serialize();
        if($('#validaterequest').valid()){
            runajax(url, formData, 'get', '', 'json', function(output) {
                if (output.success) 
                {
                    
                    $('#chattreqInfoConfirmationModal').modal('show');
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
// ***********************
// New
// ***********************

// Full Details
chatbxFulldetails();
function chatbxFulldetails() {
    let chatbxfulldetailsHeight = $('.chatbx_fulldetail_info').innerHeight() - $('.chatbx_fulldetail_info .chatbx_subhead').innerHeight();
    $('.chatbx_detail_full').css({'min-height': chatbxfulldetailsHeight, 'max-height': chatbxfulldetailsHeight});
}

// Collapse Sidebar
function chatbxSidebarCollapsed() {
    if($('.chatbx_main').hasClass('collapsed') == false && $('.chatbx_fulldetail_info').hasClass('chatbxdetails_show')){
        $('.chatbx_main').addClass('collapsed');
    } else {
        $('.chatbx_main').removeClass('collapsed');
    }
}
chatbxSidebarCollapsed();

// Full Details - Car slider with thumbnail
function fulldetailslider() {
    console.log('slider js loaded');
    var bigimage = $("#big");
    var thumbs = $("#thumbs");
    //var totalslides = 10;
    var syncedSecondary = true;
  
    bigimage
      .owlCarousel({
      items: 1,
      slideSpeed: 2000,
      nav: false,
      autoplay: false,
      dots: false,
      loop: true,
      responsiveRefreshRate: 200,
    //   navText: [
    //     '<i class="fa fa-arrow-left" aria-hidden="true"></i>',
    //     '<i class="fa fa-arrow-right" aria-hidden="true"></i>'
    //   ]
    })
      .on("changed.owl.carousel", syncPosition);
  
    thumbs
      .on("initialized.owl.carousel", function() {
      thumbs
        .find(".owl-item")
        .eq(0)
        .addClass("current");
    })
      .owlCarousel({
        items: 5,
        dots: false,
        nav: true,
        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"],
        smartSpeed: 200,
        slideSpeed: 500,
        slideBy: 4,
        margin: 6,
        responsiveRefreshRate: 100,
        responsiveClass: true,
        responsive: {
            0: {
                items: 3,
                margin: 6,
                nav: false
            },
            600: {
                items: 3,
                margin: 8,
            },
            1000: {
                items: 5,
                margin: 8,
            },
            1200: {
                items: 5
            }
        },
    })
      .on("changed.owl.carousel", syncPosition2);
  
    function syncPosition(el) {
      var count = el.item.count - 1;
      var current = Math.round(el.item.index - el.item.count / 2 - 0.5);
  
      if (current < 0) {
        current = count;
      }
      if (current > count) {
        current = 0;
      }
      thumbs
        .find(".owl-item")
        .removeClass("current")
        .eq(current)
        .addClass("current");
      var onscreen = thumbs.find(".owl-item.active").length - 1;
      var start = thumbs
      .find(".owl-item.active")
      .first()
      .index();
      var end = thumbs
      .find(".owl-item.active")
      .last()
      .index();
  
      if (current > end) {
        thumbs.data("owl.carousel").to(current, 100, true);
      }
      if (current < start) {
        thumbs.data("owl.carousel").to(current - onscreen, 100, true);
      }
    }
  
    function syncPosition2(el) {
      if (syncedSecondary) {
        var number = el.item.index;
        bigimage.data("owl.carousel").to(number, 100, true);
      }
    }
  
    thumbs.on("click", ".owl-item", function(e) {
      e.preventDefault();
      var number = $(this).index();
      bigimage.data("owl.carousel").to(number, 300, true);
    });
};
fulldetailslider();

// Toggle Like Icon
document.addEventListener('DOMContentLoaded', function() {
    // JavaScript to change Font Awesome icon on checkbox checked
    const checkbox = document.getElementById('btn-check');
    const heartIcon = document.getElementById('heart-icon');
    if(heartIcon){
        checkbox.addEventListener('change', function () {
            if (this.checked) {
                heartIcon.classList.remove('far'); // Remove outline style
                heartIcon.classList.add('fas');    // Add solid style
            } else {
                heartIcon.classList.remove('fas'); // Remove solid style
                heartIcon.classList.add('far');    // Add outline style
            }
        });
    }
});
function makeFavourite(obj,vid,vin,url){
   
    formData ={vid:vid,vin:vin};
    runajax(url, formData, 'get', '', 'json', function(output) {
    const checkbox = document.getElementById('btn-check_'+vid);
    const heartIcon = document.getElementById('heart-icon_'+vid);
      
        if (output.success) 
        {
          
            if (output.data.status ==1) {
                console.log('far')
                heartIcon.classList.remove('far'); // Remove outline style
                heartIcon.classList.add('fas');    // Add solid style
            } else {
                console.log('fas')
                heartIcon.classList.remove('fas'); // Remove solid style
                heartIcon.classList.add('far');    // Add outline style
            }
            
        }else{
            $('#userLoginModal').modal('show');    
        }
    }); 
}

// Car Details Page Tabs scroll
$(document).ready(function() {
    function scrollToElement(selector) {
        var target = $(selector);
        var container = $('.chatbx_detail_full');
        container.animate({
            scrollTop: target.offset().top - container.offset().top + container.scrollTop()
        }, 500);
    }

    $('.overviewtab').click(function() {
        scrollToElement('#overview');
    });
    $('.specificationstab').click(function() {
        scrollToElement('#specifications');
    });
    $('.featurestab').click(function() {
        scrollToElement('#features');
    });
});
</script>

<!-- Range Slider -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.5.0/nouislider.min.js"></script>
    <script>
    document.addEventListener('DOMContentLoaded', function() {
    var priceSlider = document.getElementById('priceRange');

    noUiSlider.create(priceSlider, {
        start: [1500, 150000],
        connect: true,
        range: {
            'min': 1500,
            'max': 150000
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
    });

    minPriceInput.addEventListener('change', function() {
        priceSlider.noUiSlider.set([this.value.replace('$', '').replace(',', ''), null]);
    });

    maxPriceInput.addEventListener('change', function() {
        priceSlider.noUiSlider.set([null, this.value.replace('$', '').replace(',', '')]);
    });
});
</script>
<!-- Range Slider End -->

<script>
    // Listing filter collapse
    $('.listing_filter_collapse').click(function() {
        $('.chatbx_window').toggleClass('listingFilterOpen');
        chatbxListingFilter();
    });

    function chatbxListingFilter() {
        if ($('.chatbx_main').hasClass('fullScreen') == false && $('.chatbx_window').hasClass('listingFilterOpen') == true ) {
            setTimeout(function() {
                let chatbxListingFilterHeight = $('.chatbx_window').innerHeight();
                $('.explore_filters_col').css({'height': chatbxListingFilterHeight});
            }, 400);
        } else if($(window).width() > 992){
            $('.explore_filters_col').css({'height': 'auto'});
        } else if($(window).width() < 992){
            setTimeout(function() {
                let chatbxListingFilterHeight = $('.chatbx_window').innerHeight();
                $('.explore_filters_col').css({'height': chatbxListingFilterHeight});
            }, 400);
        }
    }
</script>
@endpush