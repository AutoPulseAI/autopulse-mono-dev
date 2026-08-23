@extends('layouts.app')
@section('title', 'About Us | Autopulse Your Trusted Automotive AI Online  Marketplace')

@section('meta_description', ' Learn more about Autopulse, your trusted partner in finding the perfect 
vehicle. Discover our mission, values, and commitment to providing exceptional service and quality used and new cars. Get to know us and our AI partner Autopulse better today!
')
@section('content')
<section class="position-relative about_page section_padding pb-0" id="subpage_mt">
    <!-- About Banner -->
    <div class="container">
        <div class="row g-lg-0">
            <!-- Image -->
            <div class="col col-md-8 col-12">
                <div class="ab_banner_img">
                    <img src="./assets/images/aboutcar.png" alt="Banner img" class="img-fluid">                    
                </div>
            </div>

            <!-- Content -->
            <div class="col col-md-4 col-12 d-flex align-items-center">
                <div class="ab_banner_content">
                    <div class="section_heading mb-lg-4 mb-3">
                        <h1>About Car<span>Next</span>.Autos</h1>
                    </div>
                    <p> Autopulse is unifying the car shopping journey by leveraging AI-Driven intent-based search, revolutionizing how customers will discover, research, and purchase your NEXT vehicle. </p>
                    <a href="{{ route('vechile') }}" class="btn btn_theme">Search Car</a>
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
                        <h2>We are new and growing fast</h2>
                    </div>
                </div>

                <!-- box -->
                <div class="col col-lg-4 col-12">
                    <div class="growing_box">
                        <h3>AI Features</h3>
                        <p>Assistance in the research phase with personalized recommendations, Autopulse AI will answer questions, provide options and streamline the decision-making process by offering insights.</p>
                    </div>
                </div>
                <div class="col col-lg-4 col-12">
                    <div class="growing_box">
                        <h3>Efficiency</h3>
                        <p>We simplify the negotiations and purchase process by guiding buyers through pricing information, financing options, payments, recommended add-ons, reducing stress and uncertainty.</p>
                    </div>
                </div>
                <div class="col col-lg-4 col-12">
                    <div class="growing_box">
                        <h3>Empowerment</h3>
                        <p>We provide detailed information leading to well-informed decisions without the pressure of traditional in-person sales tactics.  Autopulse AI can analyze market trends to ensure the best available options.</p>
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
                    <div class="feature_img">
                        <img src="./assets/images/personalize.png" alt="Feature" class="img-fluid">
                    </div>
                </div>
                <div class="col col-md-6 col-12 d-flex align-items-center">
                    <div class="feature_content">
                        <div class="section_heading">
                            <h2>Personalized search</h2>
                        </div>
                        <p style="text-align: justify;">Experience the power of tailored search on Autopulse. Our advanced algorithms tailor each search to your preferences, ensuring you find the perfect vehicle match quickly and effortlessly. Say goodbye to endless scrolling and hello to a streamlined, efficient car shopping experience.</p>
                        <a href="{{route('vechile')}}" class="btn btn_theme">Search Car</a>
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
                    <div class="feature_img">
                        <img src="./assets/images/active.png" alt="Feature" class="img-fluid">
                    </div>
                </div>
                <div class="col col-md-6 col-12 order-md-1 d-flex align-items-center">
                    <div class="feature_content">
                        <div class="section_heading">
                            <h2>We drive efficiency and empowerment:</h2>
                        </div>
                        <p style="text-align: justify;">Autopulse provides the largest selection of inventory, competitive pricing, flexible financing options, and AI tools to make buying or selling your car easier than ever. Autopulse will simplify the negotiations and purchase process by guiding buyers through pricing information, financing options, payments, and recommended add-ons. This reduces the stress and uncertainty often associated with car buying. </p>
                        <a href="{{route('vechile')}}" class="btn btn_theme">Search Car</a>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div class="position-relative section_padding bg_light">
        <div class="container">
            <div class="row">
                <div class="col col-md-6 col-12">
                    <div class="feature_img">
                        <img src="./assets/images/personalize.png" alt="Feature" class="img-fluid">
                    </div>
                </div>
                <div class="col col-md-6 col-12 d-flex align-items-center">
                    <div class="feature_content">
                        <div class="section_heading">
                            <h2>Personalized Recommendations</h2>
                        </div>
                        <p style="text-align: justify;">Autopulse AI will assist in the research phase by providing personalized recommendations based on the buyer's preferences and budget.  Autopulse AI answers questions, provides detailed information on different car models, suggests suitable options, and will even schedule test drives.  Autopulse AI can also streamline decision-making by offering insights based on extensive data analysis, helping consumers make more informed choices.</p>
                        <a href="{{route('vechile')}}" class="btn btn_theme">Search Car</a>
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
                                        <h2>Testimonials</h2>
                                    </div>
                                    <div class="testimonials_slider_main">
                                        <div class="owl-carousel owl-theme testimonials_slider circular_nav">
                                            <div class="item">
                                                <div class="testimonial_slide">
                                                    <h5><span>"</span>We are excited to work with autopulse.ai as they streamline the car buying process.  Currently customers shop across multiple sites but this will provide a unified approach allowing 1 stop shopping. <span>”</span></h5>
                                                    <p>- John S. Maserati of Monmouth </p>
                                                </div>
                                            </div>
                                          
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="testimonials_car">
                            <img src="./assets/images/about-car.png" alt="Car" class="img-fluid">
                        </div>
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
                                    <p>{!! Str::limit($excerpts, 199, ' ...') !!}</p>
                                </div>
                            </div>
                        </a>
                    </div>
                @endforeach
            </div>
        </div>
    </div>

</section>


@endsection

