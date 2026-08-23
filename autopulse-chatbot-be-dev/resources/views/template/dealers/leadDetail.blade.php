
@if($lead['viewed'] ==1 ||  ($subscription && !($subscription->canceled())))
<div class="col col-12">
    <div class="position-relative">
        <div class="modal_heading">
            <h3>Customer Details</h3>
        </div>

        <!-- Consumer Contact -->
        <div class="position-relative">
            <div class="dealer_contact">
                <i class="fa-solid fa-user me-2"></i>
                <div class="position-relative">
                    <p>{{ $user['name']}} {{ $user['last_name']}}</p>
                </div>
            </div>
            @if($user['address'])
            <div class="dealer_contact">
                <i class="fa-solid fa-location-dot me-2"></i>
                <div class="position-relative">
                    <p>{{ $user['address'] ??''}}</p>
                    <p><small>  {{ $user['address2']}}  {{ $user['city']}} {{ $user['state']}} {{ $user['zip_code']}} {{ $user['country']}}</small></p>
                </div>
            </div>
            @endif  
            @if($user['phone_number'])
            <div class="dealer_contact">
                <i class="fa-solid fa-phone me-2"></i>
                <div class="position-relative">
                    <p>+{{ $user['phone_number']}}</p>
                </div>
            </div>
            @endif
            @if($user['email'])
            <div class="dealer_contact">
                <i class="fa-solid fa-envelope me-2"></i>
                <div class="position-relative">
                    <p>{{ $user['email']}}</p>
                </div>
            </div>
            @endif
        </div>

        <div class="position-relative agree_text">
            <!--p class="mb-0 text_secondary"><small>Lorem Ipsum is simply dummy text of the printing and typesetting industry.</small></p-->
        </div>

        <hr>
        
        <!-- Car -->
        <div class="car_card dealer_details_card">
            <a class="car_card_main">
                <div class="car_card_img">          
                    <img src="{{ $vehicle['media']['photo_links'][0] ??'' }}" alt="Car Image">
                </div>
                <div class="car_card_info">
                    <div class="car_title_price">
                        <h4> {{ $vehicle['build']['make']??'' }} {{ $vehicle['build']['model']??'' }} {{ $vehicle['build']['trim'] ??'' }}</h4>
                        <div class="car_spec">
                            <div class="car_spec_info">
                                <span>{{ $vehicle['build']['year']??'' }}</span>&nbsp;|&nbsp;<span>{{ $vehicle['build']['fuel_type']??'' }}</span>&nbsp;|&nbsp;<span>{{ $vehicle['build']['transmission']??'' }}</span>
                            </div>
                        </div>                                                
                        @if(isset($vehicle['price']))
                                <h5>${{ number_format($vehicle['price']) }}</h5>
                        @else
                            <h5>N/A</h5>
                        @endif  
                    </div>
                </div>
            </a>
        </div>
        
    </div>
</div>
@else
<div class="col col-12">
    <div class="position-relative">

       
            <div class="no_cars_available py-5">
                <p class="mb-0"><span>With your free plan, you can only view your first 5 leads for this store. Please subscribe now to access unlimited leads. <a href="{{ route('dealer.stores') }}">Click Here</a></span></p>
            </div>
      
    </div>
</div>
@endif