@extends('layouts.app')
 
@section('content')

<section class="account_main" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-3 col-12">
                @include('template.users.include.user-sidebar')
            </div>
            <div class="col col-lg-9 col-12">
                <!-- Vehicles Of Interest -->
                <div class="acc_right_main">
                    <div class="acc_page_head sticky" id="acc_page_head">
                        <div class="row align-items-center">
                            <div class="col col-md-6 col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    <div class="acc_page_heading">
                                        <h3>Vehicles Of Interest</h3>
                                    </div>
                                </div>
                            </div>
                            <div class="col col-md-6 col-12">
                                <div class="acc_page_search">
                                    <input type="text" class="form-control mb-0" id="searchInput" placeholder="Search">
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="acc_page_content acc_page_box">

                   
                    <?php 
                        if(count($vehiclelist['listings'])>0){ 
                            foreach($vehiclelist['listings'] as $key =>$item) { 
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
                                                            
                                                <img src="{{ $item['media']['photo_links'][0]??'' }}" alt="Car Image">
                                            </div>
                                            <div class="car_card_info">
                                                <div class="car_title_price">
                                                    <h4>{{ $item['build']['year'] ??'' }} {{ $item['build']['make'] ??'' }} {{ $item['build']['model']??'' }} {{ $item['build']['trim'] ??'' }} {{ $item['build']['drivetrain'] ??'' }}</h4>
                                                    <div class="car_spec">
                                                        <div class="car_spec_info">
                                                            <span>{{ $item['build']['year'] ??'NA'}}</span>&nbsp;|&nbsp;<span>{{ $item['build']['fuel_type'] ??'NA'}}</span>&nbsp;|&nbsp;<span>{{ $item['build']['transmission'] ??'NA'}}</span>
                                                        </div>
                                                    </div>             
                                                    @if(isset($item['price']))
                                                        <h5 class="price">${{ number_format($item['price']) }}</h5>
                                                    @else
                                                        <h5 class="price">N/A</h5>
                                                    @endif
                                                
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
                        <?php }else{ ?>
                            <div class="no_cars_available py-5">
                                        <p class="mb-0"><span>No Cars Available</span></p>
                                    </div>
                        <?php } ?>
                    </div>
                    

                    
                </div>

            </div>
        </div>
    </div>
</section>
@endsection
@push ('after-scripts')
<script>
    document.addEventListener("DOMContentLoaded", function() {
        const searchInput = document.getElementById('searchInput');
        const vehicleCards = document.querySelectorAll('.recommended_list_card');

        searchInput.addEventListener('input', function() {
            const searchTerm = searchInput.value.toLowerCase();
            const searchNumber = searchTerm.replace(/[^0-9.]/g, ''); // Extract numbers from the search term

            vehicleCards.forEach(function(card) {
                const titleElement = card.querySelector('.car_title_price h4');
                const title = titleElement ? titleElement.textContent.toLowerCase() : '';

                const priceElement = card.querySelector('.car_title_price .price');
                const priceText = priceElement ? priceElement.textContent : '';
                const price = priceText.replace(/[^0-9.]/g, ''); // Extract numbers from the price text

                const specElement = card.querySelector('.car_spec_info');
                const specText = specElement ? specElement.textContent.toLowerCase() : '';

                // Check if the title includes the search term (case-insensitive)
                const titleMatches = title.includes(searchTerm);
                // Check if the price includes the search number
                const priceMatches = price.includes(searchNumber);
                // Check if the car specifications include the search term (case-insensitive)
                const specMatches = specText.includes(searchTerm);

                if (titleMatches || (searchNumber && priceMatches) || specMatches) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    });
</script>



@endpush
