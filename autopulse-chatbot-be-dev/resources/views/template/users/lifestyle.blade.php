<section class="body_type3 position-relative section_padding bg_light">
    <div class="container">
        <div class="row">
            <div class="col col-lg-5 col-12 d-flex align-items-center">
                <div class="section_heading">
                    <h2>Life Style</h2>
                </div>
            </div>
            <div class="col col-lg-7 col-12">
                <!-- Body Type Slider Tabs -->
                <div class="position-relative">
                    <div class="owl-carousel slider_thumb body_type_thumb">
                        
                        @foreach($lifestyle as $key =>$row) 
                            @php 
                            if( $row['num_found'] ==0){
                                continue;
                            }
                            @endphp

                            
                           
                            <div class="item">
                                <div class="sliding_tab">
                                    <input type="radio" class="btn-check getlifeitemlist" name="life_style" value="{{ $key }}" id="life_style{{$key}}" @if($key=='FAMILY') checked @endif  >
                                    <label class="btn" for="life_style{{$key}}">
                                     
                                        <p>{{ $key }}</p>
                                        <p><small>{{ $row['num_found'] }}</small></p>
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
                    <div class="owl-carousel owl-theme lifestyle_cars_slider nav_left circular_nav life_style">
                    @foreach($lifestyle['FAMILY']['listings'] as $key =>$item)
                        
                        <div class="item">
                            @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
                        </div>
                    @endforeach
                    </div>
                </div>

                <div class="row">
                    <div class="col col-12">
                        <div class="position-relative text-end mt-xl-5 mt-lg-4 mt-3 life_style_number">
                            <!--a href="{{ route('vechile',$lifestyle['FAMILY']['param']) }}" class="btn btn_theme ">View All</a-->
                            <a href="{{ route('vechile',array_merge($mylocation,['life_style'=>'FAMILY']))   }}" class="btn btn_theme ">View All</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>