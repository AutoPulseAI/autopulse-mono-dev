@php
    $favclass = !empty($fav) && isset($item['vin']) && in_array($item['vin'], $fav) ? 'fas' : 'far';
@endphp

<div class="chatbx_car_card chatbx_explore_card {{$class}}">
    @if(!empty($item['is_certified']))
    <div class="certified_badge">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffd43b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-award"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>
    </div>
    @endif
    <div class="like_share_icon details_like_share">
        <!-- Toggle Favorite Button -->
        

        <!-- Share Icon -->
        <!-- <div class="share_icon">
            @if(isset($item['id']) && isset($item['build']['year']) && isset($item['build']['make']) && isset($item['build']['model']) && isset($item['vin']))
                <i class="fa-regular fa-share-from-square" onclick="showSharePopup(`{{ $item['id'] }}`, 
                    `{{ route('vehicle_detail', ['make_model_year' => $item['build']['year'].'-'.$item['build']['make'].'-'.$item['build']['model'], 'vin' => $item['vin']]) }}`, 
                    `{{ $item['build']['year'] ?? '' }} {{ $item['build']['make'] ?? '' }} {{ $item['build']['model'] ?? '' }}`)">
                </i>
            @endif
        </div> -->
    </div>
    @if(isset($item['build']['year']) && isset($item['build']['make']) && isset($item['build']['model']) && isset($item['vin']))
        <a class="btn_chatbx_card btn_expand" data_href="{{ route('vehicle_detail',['make_model_year' => $item['build']['make'].'-'.$item['build']['model'].'-'.$item['build']['year'], 'vin' => $item['vin']]) }}" data_attr= "{{ json_encode($item) }}">
       
    @endif
        <img src="{{ $item['media']['photo_links'][0] ??'' }}" alt="car">
        <div class="chatbx_carcard_content">
            <h3>{{ $item['build']['year'] ??'' }} {{ $item['build']['make'] ??'' }} {{ $item['build']['model']??'' }} {{ $item['build']['trim'] ??'' }} {{ $item['build']['drivetrain'] ??'' }}</h3>
            <div class="chatbx_carcard_loc_price">
                <div class="chatbx_car_loc">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-map-pin"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                    <span class="mt-0 ms-1">{{$item['dealer']['city'] ??''}} {{$item['dealer']['state'] ??''}}</span>
                </div>
                @if(isset($item['price']))
                    <h5>${{ number_format($item['price']) }}</h5>
                @else
                    <h5>N/A</h5>
                @endif                                            
            </div>
            <hr class="mb-2">
            <div class="car_spec">
                <span class="car_spec_year">
                <svg width="14px" height="14px" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><path d="M326.1,231.9l-47.5,75.5a31,31,0,0,1-7,7,30.11,30.11,0,0,1-35-49l75.5-47.5a10.23,10.23,0,0,1,11.7,0A10.06,10.06,0,0,1,326.1,231.9Z" style="fill:#ffffff;"/><path d="M256,64C132.3,64,32,164.2,32,287.9A223.18,223.18,0,0,0,88.3,436.4c1.1,1.2,2.1,2.4,3.2,3.5a25.19,25.19,0,0,0,37.1-.1,173.13,173.13,0,0,1,254.8,0,25.19,25.19,0,0,0,37.1.1l3.2-3.5A223.18,223.18,0,0,0,480,287.9C480,164.2,379.7,64,256,64Z" style="fill:none;stroke:#ffffff;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px"/><line x1="256" y1="128" x2="256" y2="160" style="fill:none;stroke:#ffffff;stroke-linecap:round;stroke-miterlimit:10;stroke-width:32px"/><line x1="416" y1="288" x2="384" y2="288" style="fill:none;stroke:#ffffff;stroke-linecap:round;stroke-miterlimit:10;stroke-width:32px"/><line x1="128" y1="288" x2="96" y2="288" style="fill:none;stroke:#ffffff;stroke-linecap:round;stroke-miterlimit:10;stroke-width:32px"/><line x1="165.49" y1="197.49" x2="142.86" y2="174.86" style="fill:none;stroke:#ffffff;stroke-linecap:round;stroke-miterlimit:10;stroke-width:32px"/><line x1="346.51" y1="197.49" x2="369.14" y2="174.86" style="fill:none;stroke:#ffffff;stroke-linecap:round;stroke-miterlimit:10;stroke-width:32px"/></svg>
                    @if(isset($item['miles']))
                        @if($item['miles'] < 10 && isset($item['inventory_type']) && $item['inventory_type'] == 'used')
                            N/A
                        @else
                            {{ number_format($item['miles']) }}
                        @endif
                    @else
                        N/A
                    @endif Miles
                </span>
                <div class="car_spec_info">
                    <span>
                        {{ $item['build']['engine'] ?? 'N/A' }} 
                    </span>&nbsp;|&nbsp;
                    <span>{{ $item['build']['body_type'] ?? 'N/A' }}</span>
                </div>
            </div>
        </div>
    </a>
    <hr class="my-2">
    <div class="chatbx_carcard_btns mb-2">
        <div class="btn_chatbx_card text-nowrap text_secondary border-0 p-0">
            VIN: <em id="textToCopy" class="text_dark">{{$item['vin']}}</em>
            <svg class="text_primary cursor-pointer copyButton" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-copy"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <small id="message" class="text-success m-0 d-block"></small>
        </div>
    </div>

</div>
