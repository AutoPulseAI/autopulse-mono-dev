@foreach($vehicle['listings'] as $key =>$item)

    
    <div class="item">
        <div class="chatbx_car_card">
            @if(!empty($item['is_certified']))
            <div class="certified_badge">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffd43b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-award"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>
            </div>
            @endif
            <img src="{{ $item['media']['photo_links'][0] ??'' }}" alt="car">
            <div class="chatbx_carcard_content">
                <h3>{{ $item['build']['year'] ??'' }} {{ $item['build']['make'] ??'' }} {{ $item['build']['model']??'' }} </h3>
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
            </div>
            <div class="chatbx_carcard_btns">
                <a class="btn_chatbx_card btn_expand" data_href="{{ route('vehicle_detail',['make_model_year' => $item['build']['make'].'-'.$item['build']['model'].'-'.$item['build']['year'], 'vin' => $item['vin']]) }}" data_attr= "{{ json_encode($item) }}">View Details</a>
                <a href="javascript:;" data_href="{{$weburl}}" class="btn_chatbx_card btn_exploere_more">Explore More</a>
                <div class="btn_chatbx_card text-nowrap text_secondary">VIN: <em id="textToCopy" class="text_dark">{{$item['vin'] }}</em>
                    <svg class="text_primary cursor-pointer copyButton" id="copyButton" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-copy"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </div>
            </div>
        </div>
    </div>
@endforeach