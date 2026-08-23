@section('title', 'About Us | Autopulse Your Trusted Automotive AI Online  Marketplace')

@section('meta_description', ' Learn more about Autopulse, your trusted partner in finding the perfect 
vehicle. Discover our mission, values, and commitment to providing exceptional service and quality used and new cars. Get to know us and our AI partner Autopulse better today!
')
@section('content')
<section class="position-relative about_page section_padding pb-0" id="subpage_mt">
@foreach($forms as $data)
    <!-- About Banner -->
    <div class="container">
        <div class="row g-lg-0">
            <!-- Image -->
            <div class="col col-md-8 col-12">
            @if($data->form['image-1'])
                <div class="ab_banner_img">
                    <img src="{{ $data->form['image-1'] }}" alt="Banner img" class="img-fluid">                    
                </div>
            @endif
            </div>

            <!-- Content -->
            <div class="col col-md-4 col-12 d-flex align-items-center">
                <div class="ab_banner_content">
                    <div class="section_heading mb-lg-4 mb-3">
                        <h1>{!! $data->form['title-1'] !!}</h1>
                    </div>
                    <p>{!! $data->form['content-1'] !!}</p>
                    <a href="{{ $data->form['btn-url-1'] }}" class="btn btn_theme">{{ $data->form['btn-text-1'] }}</a>
                </div>
            </div>
        </div>
    </div>

    <!-- We are new and growing fast -->
    <div class="position-relative section_padding">
        <div class="container">
            <div class="row">
                <!-- Heading -->
                <div class="col col-12">
                    <div class="section_heading text-center">
                    <h1>{{ $data->form['title-2'] }}</h1>
                    </div>
                </div>

                <!-- box -->
                <div class="col col-lg-4 col-12">
                    <div class="growing_box">
                        <h3>{{ $data->form['box-text-1-2'] }}</h3>
                        <p>{!! $data->form['box-content-1-2'] !!}</p>
                    </div>
                </div>
                <div class="col col-lg-4 col-12">
                    <div class="growing_box">
                    <h3>{{ $data->form['box-text-2-2'] }}</h3>
                    <p>{!! $data->form['box-content-2-2'] !!}</p>
                    </div>
                </div>
                <div class="col col-lg-4 col-12">
                    <div class="growing_box">
                    <h3>{{ $data->form['box-text-3-2'] }}</h3>
                    <p>{!! $data->form['box-content-3-2'] !!}</p>
                    </div>
                </div>

            </div>
        </div>
    </div>

    <!-- Personalized search -->
    <div class="position-relative section_padding bg_light">
        <div class="container">
            <div class="row">
                <div class="col col-md-6 col-12">
                @if($data->form['image-3'])
                    <div class="feature_img">
                        <img src="{{ $data->form['image-3'] }}" alt="Feature" class="img-fluid">
                    </div>
                @endif
                </div>
                <div class="col col-md-6 col-12 d-flex align-items-center">
                    <div class="feature_content">
                        <div class="section_heading">
                            <h2>{{ $data->form['title-3'] }}</h2>
                        </div>
                        <p>{!! $data->form['content-3'] !!}</p>
                        <a href="{{ $data->form['btn-url-3'] }}" class="btn btn_theme">{{ $data->form['btn-text-3'] }}</a>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Attractive selling conditions -->
    <div class="position-relative section_padding">
        <div class="container">
            <div class="row">
                <div class="col col-md-6 col-12 order-md-2">
                @if($data->form['image-4'])
                    <div class="feature_img">
                        <img src="{{ $data->form['image-4'] }}" alt="Feature" class="img-fluid">
                    </div>
                @endif
                </div>
                <div class="col col-md-6 col-12 order-md-1 d-flex align-items-center">
                    <div class="feature_content">
                        <div class="section_heading">
                            <h2>{{ $data->form['title-4'] }}</h2>
                        </div>
                        <p>{!! $data->form['content-4'] !!}</p>
                        <a href="{{ $data->form['btn-url-4'] }}" class="btn btn_theme">{{ $data->form['btn-text-4'] }}</a>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div class="position-relative section_padding bg_light">
        <div class="container">
            <div class="row">
                <div class="col col-md-6 col-12">
                @if($data->form['image-5'])
                    <div class="feature_img">
                        <img src="{{ $data->form['image-5'] }}" alt="Feature" class="img-fluid">
                    </div>
                @endif
                </div>
                <div class="col col-md-6 col-12 d-flex align-items-center">
                    <div class="feature_content">
                        <div class="section_heading">
                            <h2>{{ $data->form['title-5'] }}</h2>
                        </div>
                        <p>{!! $data->form['content-5'] !!}</p>
                        <a href="{{ $data->form['btn-url-5'] }}" class="btn btn_theme">{{ $data->form['btn-text-5'] }}</a>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Testimonials -->
    <div class="position-relative about_testimonials">
        <div class="container">
            <div class="row">
                <div class="col col-12">
                    <div class="testimonials_main">
                        <div class="row">
                            <div class="col col-md-8 col-12">
                                <div class="position-relative">
                                    <div class="section_heading">
                                    <h2>{{ $data->form['title-6'] }}</h2>
                                    </div>
                                    <div class="testimonials_slider_main">
                                        <div class="owl-carousel owl-theme testimonials_slider circular_nav">
                                            <div class="item">
                                                <div class="testimonial_slide">
                                                    <h5>{!! $data->form['testimonial-text-1-6'] !!}</h5>
                                                    <p>{{ $data->form['testimonial-content-1-6'] }}</p>
                                                </div>
                                            </div>
                                            <div class="item">
                                                <div class="testimonial_slide">
                                                    <h5>{!! $data->form['testimonial-text-2-6'] !!}</h5>
                                                    <p>{{ $data->form['testimonial-content-2-6'] }}</p>
                                                </div>
                                            </div>
                                            <div class="item">
                                                <div class="testimonial_slide">
                                                    <h5>{!! $data->form['testimonial-text-3-6'] !!}</h5>
                                                    <p>{{ $data->form['testimonial-content-3-6'] }}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        @if($data->form['image-6'])
                        <div class="testimonials_car">
                            <img src="{{ $data->form['image-6'] }}" alt="Car" class="img-fluid">
                        </div>
                        @endif
                    </div>
                    
                </div>
                
            </div>
        </div>
    </div>

    <!-- Blog -->
    <div class="position-relative section_padding bg_light">
        <div class="container">
            <div class="row">
                <!-- box -->
                @foreach($posts as $post)
                    <div class="col col-md-4 col-12">
                        <div class="blog_card">
                        <a href="{{route('blogs',$post->slug)}}" style="text-decoration:none;color:#2F3B48;text-align:justify;">
                            <div class="blog_img">
                                @if($post->image)
                                    @php $image = $post->image; @endphp
                                @else
                                    @php $image = asset('assets/images/active.png'); @endphp
                                @endif
                                    <img src="{{$image}}" alt="{{$post->title}}">
                                </div>
                                <div class="blog_content">
                                @php
                                    $title_without_tags = strip_tags($post->title); 
                                    $title = substr($title_without_tags, 0, 30); 
                                @endphp
                                  <h3>{{$post->title}}</h3>
                                @php
                                    $content_without_tags = strip_tags($post->excerpts); 
                                    $excerpts = substr($content_without_tags, 0, 200); 
                                @endphp
                                    <p style="text-align:justify;">{!! Str::limit($excerpts, 199, ' ...') !!}</p>
                                </div>
                            </div>
                        </a>
                    </div>
                @endforeach
            </div>
        </div>
    </div>

</section>
@endforeach
@endsection

