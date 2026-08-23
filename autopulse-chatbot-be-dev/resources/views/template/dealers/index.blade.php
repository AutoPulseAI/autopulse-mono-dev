@extends('layouts.front')
 
@section('content')

        <!-- Start Header  -->
        @include('template.dealers.include.header')
        <!-- End Header  -->

        <!-- start mobilemenu -->
        @include('template.dealers.include.mobilemenu')
        <!-- End mobilemenu -->

        <!-- Start Slider Area  -->
        <div class="slider-area slider-style-1 variation-default slider-bg-image bg-banner1 slider-bg-shape" data-black-overlay="1">
            <!-- <div class="bg-blend-top bg_dot-mask"></div> -->
            <div class="container">
                <div class="row justify-content-center">
                    <div class="col-lg-12">
                        <div class="inner text-center mt--140">
                            <h1 class="title display-one">Unlock <span class="theme-gradient">Autopulse AI ChatBot:</span><br>
                            AI Intelligence & Real-time Inventory for Dealership Growth
                            </h1>
                            <p class="description">AI-Powered Solutions for Dealership Growth</p>
                            <div class="button-group">
                                <!-- <button class="btn-default bg-light-gradient btn-large" data-bs-toggle="modal" data-bs-target="#bookaDemoModal">
                                    <div class="has-bg-light"></div>
                                    <span>Book a Demo</span>
                                </button> -->
                                <a class="rainbow-gradient-btn btn-large" href="{{route('dealer.signup') }}"><span>Sign Up</span></a>
                                <a class="rainbow-gradient-btn btn-large" data-bs-toggle="modal" data-bs-target="#bookaDemoModal"><span>Book a Demo</span></a>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-11 col-xl-11 order-1 order-lg-2">
                        <div class="frame-image bg-flashlight video-popup icon-center mb--60">
                            <img src="{{ asset('assets/front/images/banner/banner-image-03.png') }}" alt="Banner Images">
                            <div class="video-icon">
                                <a class="btn-default rounded-player popup-video border bg-white-dropshadow" href="#" data-bs-toggle="modal" data-bs-target="#videoModal">
                                    <span><i class="feather-play"></i></span>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <!-- <div class="chatenai-separator has-position-bottom">
                <img class="w-100" src="{{ asset('assets/front/images/separator/separator-top.svg') }}" alt="">
            </div> -->
            <div class="bg-shape">
                <img class="bg-shape-one" src="{{ asset('assets/front/images/bg/bg-shape-four.png') }}" alt="Bg Shape">
                <img class="bg-shape-two" src="{{ asset('assets/front/images/bg/bg-shape-five.png') }}" alt="Bg Shape">
            </div>
        </div>
        <!-- End Slider Area  -->

        <div class="separator-animated animated-true"></div>

        <!-- Start Service__Style--1 Area  -->
        <div class="rainbow-service-area rainbow-section-gap">
            <div class="container">
                <div class="row">
                    <div class="col-lg-12">
                        <div class="section-title text-center" data-sal="slide-up" data-sal-duration="700" data-sal-delay="100">
                            <h4 class="subtitle">
                                <span class="theme-gradient">GET IN TOUCH</span>
                            </h4>
                            <h2 class="title w-600 mb--20">Effortless Inventory Search and Customer Engagement with Autopulse AI</h2>
                            <p class="description b1">Input Vehicle Specs, Get Instant AI-Powered Vehicle Insights</p>
                        </div>
                    </div>
                </div>

                <div class="row row--15 service-wrapper gy-lg-5 gy-md-4 gy-3">
                    <div class="col-lg-4 col-md-6 col-sm-6 col-12" data-sal="slide-up" data-sal-duration="700">
                        <div class="service service__style--1 ser_trans text-start h-100">
                            <div class="service_shape_box">
                                <div class="icon">
                                    <i class="feather-search"></i>
                                </div>
                                <div class="content">
                                    <h4 class="title w-600">VINtelligence™ Inventory Search</h4>
                                    <p class="description b1 color-gray mb--0">AI-driven technology delivers precise VIN specific responses providing quick, precise and accurate vehicle insights from your dealership's inventory, 24/7.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-lg-4 col-md-6 col-sm-6 col-12" data-sal="slide-up" data-sal-duration="700" data-sal-delay="100">
                        <div class="service service__style--1 ser_trans text-start h-100">
                            <div class="service_shape_box">
                            <div class="icon">
                                <i class="feather-check-square"></i>
                            </div>
                            <div class="content">
                                <h4 class="title w-600">SmartMatch™ Inventory AI</h4>
                                <p class="description b1 color-gray mb--0">SmartMatch™ AI recommends vehicles in real-time, guiding customers to inventory that fits their preferences, questions, and intent.</p>
                            </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-lg-4 col-md-6 col-sm-6 col-12" data-sal="slide-up" data-sal-duration="700" data-sal-delay="200">
                        <div class="service service__style--1 ser_trans text-start h-100">
                            <div class="service_shape_box">
                            <div class="icon">
                                <i class="feather-users"></i>
                            </div>
                            <div class="content">
                                <h4 class="title w-600">Seamless Customer Engagement</h4>
                                <p class="description b1 color-gray mb--0">Users can express interest and connect with dealers directly, streamlining the lead process.</p>
                            </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-lg-4 col-md-6 col-sm-6 col-12" data-sal="slide-up" data-sal-duration="700">
                        <div class="service service__style--1 ser_trans text-start h-100">
                            <div class="service_shape_box">
                            <div class="icon">
                                <i class="feather-edit"></i>
                            </div>
                            <div class="content">
                                <h4 class="title w-600">AI-Powered Touchpoint Compression</h4>
                                <p class="description b1 color-gray mb--0">Reduces shopper interactions by streamlining the buying journey, delivering faster, more efficient vehicle recommendations tailored to customer preferences.</p>
                            </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-lg-4 col-md-6 col-sm-6 col-12" data-sal="slide-up" data-sal-duration="700" data-sal-delay="100">
                        <div class="service service__style--1 ser_trans text-start h-100">
                            <div class="service_shape_box">
                            <div class="icon">
                                <i class="feather-bar-chart-2"></i>
                            </div>
                            <div class="content">
                                <h4 class="title w-600">Business Growth Optimization</h4>
                                <p class="description b1 color-gray mb--0">Boosts dealership performance by improving user experience and converting leads faster through AI integration.</p>
                            </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-lg-4 col-md-6 col-sm-6 col-12" data-sal="slide-up" data-sal-duration="700" data-sal-delay="200">
                        <div class="service service__style--1 ser_trans text-start h-100">
                            <div class="service_shape_box">
                            <div class="icon">
                                <i class="feather-award"></i>
                            </div>
                            <div class="content">
                                <h4 class="title w-600">Fully Branded Experience</h4>
                                <p class="description b1 color-gray mb--0">Showcase real-time inventory, where every detail—from logo to color scheme, theme, and brand icons—is customized to reflect your dealership’s unique identity.</p>
                            </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- End Service__Style--1 Area  -->

        <!-- Start Timeline-Style-Four  -->
        <div class="rainbow-timeline-area rainbow-section-gap bg-color-darkest">
            <div class="container">
                <div class="row">
                    <div class="col-lg-12">
                        <div class="section-title text-center" data-sal="slide-up" data-sal-duration="700" data-sal-delay="100">
                            <h4 class="subtitle ">
                                <span class="theme-gradient">HOW IT WORKS</span>
                            </h4>
                            <h2 class="title w-600 mb--20">3 Steps to Utilize Autopulse AI and Maximize Its Potential </h2>
                        </div>
                    </div>
                </div>
                <div class="row justify-content-center">
                    <div class="col-xl-10 col-lg-12 mt--30">
                        <div class="timeline-style-two bg-color-bg-one">
                            <div class="row row--0">
                                <div class="col-lg-4 col-md-4 rainbow-timeline-single dark-line">
                                    <div class="rainbow-timeline">
                                        <img class="timeline_img" src="{{ asset('assets/front/images/process/1.png') }}" alt="Signup">
                                        <h6 class="title" data-sal="slide-up" data-sal-duration="700" data-sal-delay="200">1.Signup</h6>
                                        <div class="progress-line">
                                            <div class="line-inner"></div>
                                        </div>
                                        <div class="progress-dot">
                                            <div class="dot-level">
                                                <div class="dot-inner"></div>
                                            </div>
                                        </div>
                                        <p class="description" data-sal="slide-up" data-sal-duration="700" data-sal-delay="300">Join us today and unlock personalized AI-driven solutions tailored just for you.</p>
                                    </div>
                                </div>
                                <div class="col-lg-4 col-md-4 rainbow-timeline-single dark-line">
                                    <div class="rainbow-timeline">
                                        <img class="timeline_img" src="{{ asset('assets/front/images/process/2.png') }}" alt="Signup">
                                        <h6 class="title" data-sal="slide-up" data-sal-duration="700" data-sal-delay="200">2.Customzied AI tool</h6>
                                        <div class="progress-line">
                                            <div class="line-inner"></div>
                                        </div>
                                        <div class="progress-dot">
                                            <div class="dot-level">
                                                <div class="dot-inner"></div>
                                            </div>
                                        </div>
                                        <p class="description" data-sal="slide-up" data-sal-duration="700" data-sal-delay="300">Customized AI tool: Create your own AI tools, uniquely designed to fit your specific needs and goals.</p>
                                    </div>
                                </div>
                                <div class="col-lg-4 col-md-4 rainbow-timeline-single dark-line">
                                    <div class="rainbow-timeline">
                                        <img class="timeline_img" src="{{ asset('assets/front/images/process/3.png') }}" alt="Signup">
                                        <h6 class="title" data-sal="slide-up" data-sal-duration="700" data-sal-delay="200">3.Generate Ready to use code</h6>
                                        <div class="progress-line">
                                            <div class="line-inner"></div>
                                        </div>
                                        <div class="progress-dot">
                                            <div class="dot-level">
                                                <div class="dot-inner"></div>
                                            </div>
                                        </div>
                                        <p class="description" data-sal="slide-up" data-sal-duration="700" data-sal-delay="300">Generate Ready to use code: Quickly generate clean, efficient code that's ready to implement in your projects.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="button-group mt--40 text-center">
                            <a class="rainbow-gradient-btn btn-large" href="{{route('dealer.signup') }}"><span>Sign Up Now</span></a>
                            <a class="rainbow-gradient-btn btn-large cursor-pointer" data-bs-toggle="modal" data-bs-target="#videoModal"><span><i class="feather-play me-2"></i>See action in video</span></a>

                            <!-- <a class="btn-default btn-large" href="{{route('dealer.signup') }}">Sign Up Now</a>
                            <a class="btn-default btn-large btn-border popup-video" href="#" data-bs-toggle="modal" data-bs-target="#videoModal"><span>
                                    <i class="feather-play"></i>
                                </span> See action in video</a> -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- End Timeline-Style-Four  -->

        <!-- Start Comparison Area  -->
        <div class="rainbow-service-area service_comparison rainbow-section-gap">
            <div class="container">
            <div class="row">
                    <div class="col-lg-12">
                        <div class="section-title text-center" data-sal="slide-up" data-sal-duration="700" data-sal-delay="100">
                            <h4 class="subtitle">
                                <span class="theme-gradient">Book a Demo</span>
                            </h4>
                            <h2 class="title w-600 mb--20">Overcoming the Limitations of Traditional Chatbots with Autopulse AI</h2>
                            <p class="description b1">Input Vehicle Specs, Get Instant AI-Powered Vehicle Insights</p>
                        </div>
                    </div>
                </div>

                <div class="row row--15 service-wrapper gy-lg-5 gy-md-4 gy-3">
                    <div class="col-lg-4 col-md-6 col-sm-6 col-12" data-sal="slide-up" data-sal-duration="700">
                        <div class="service service__style--1 text-start h-100">
                            <div class="service_shape_box">
                                <div class="content">
                                    <h4 class="title w-600">
                                        <a class="pe-none" href="#">Normal Chatbot</a>
                                    </h4>
                                    <ul class="list-style--1 list-unstyled mb-0">
                                        <li class="d-flex align-items-baseline"><i class="feather-disc me-2 theme_color"></i>Basic or no inventory search capabilities.</li>                                   
                                        <li class="d-flex align-items-baseline"><i class="feather-disc me-2 theme_color"></i>Limited or general information.</li>                                   
                                        <li class="d-flex align-items-baseline"><i class="feather-disc me-2 theme_color"></i>Minimal or no personalized recommendations.</li>                                   
                                        <li class="d-flex align-items-baseline"><i class="feather-disc me-2 theme_color"></i>Basic interaction, often requiring manual follow-up and human intervention.</li>                                   
                                        <li class="d-flex align-items-baseline"><i class="feather-disc me-2 theme_color"></i>Limited Ability to understand customer intent, leading to missed lead opportunities.</li>                                   
                                        <li class="d-flex align-items-baseline"><i class="feather-disc me-2 theme_color"></i>General Tool, limited to scripted responses, lacks ability to understand nuanced questions, leading to customer frustration.</li>                                                                
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-lg-4 col-md-6 col-sm-6 col-12 d-lg-block d-md-none d-block" data-sal="slide-up" data-sal-duration="700" data-sal-delay="100">
                        <div class="thumbnail">
                            <img class="radius" src="{{ asset('assets/front/images/comparison.png') }}" alt="Images">
                        </div>
                    </div>

                    <div class="col-lg-4 col-md-6 col-sm-6 col-12" data-sal="slide-up" data-sal-duration="700" data-sal-delay="200">
                        <div class="service service__style--1 text-start h-100">
                            <div class="service_shape_box">
                                <div class="content">
                                    <h4 class="title w-600">
                                        <a class="pe-none" href="#">AutopulseAI</a>
                                    </h4>
                                    <ul class="list-style--1 list-unstyled mb-0">
                                        <li class="d-flex align-items-baseline"><i class="feather-disc me-2 theme_color"></i>Advanced, AI-powered real-time inventory search for cars.</li>                                   
                                        <li class="d-flex align-items-baseline"><i class="feather-disc me-2 theme_color"></i>AI-Driven vehicle insights with VIN level intelligence providing more detailed information.</li>                                   
                                        <li class="d-flex align-items-baseline"><i class="feather-disc me-2 theme_color"></i>AI-Product engine with contextual learning provides tailored, real-time recommendations.</li>                                   
                                        <li class="d-flex align-items-baseline"><i class="feather-disc me-2 theme_color"></i>Seamless engagement with direct form submission to provide leads for dealers.</li>                                   
                                        <li class="d-flex align-items-baseline"><i class="feather-disc me-2 theme_color"></i>Provides dynamic, personalized interactions, understanding customer intent</li>                                   
                                    </ul>
                                </div>
                        </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
        <!-- End Comparison Area  -->

        <!-- Start Pricing Area  -->
        <div class="rainbow-pricing-area rainbow-section-gap bg-color-darkest" id="pricing">
            <div class="container">
                <div class="row">
                    <div class="col-lg-12">
                        <div class="section-title text-center" data-sal="slide-up" data-sal-duration="400" data-sal-delay="150">
                            <h4 class="subtitle "><span class="theme-gradient">Pricing</span></h4>
                            <h2 class="title w-600 mb--20">Commence VINtelligence™ Journey with Autopulse</h2>
                            <p class="description b1">AI-Powered Solutions for Dealership Growth</p>
                        </div>
                    </div>
                </div>
                <div class="row justify-content-center row--15 gy-lg-0 gy-3">
                    <div class="col-lg-4 col-md-6 col-12">
                        <div class="rainbow-pricing style-2 active">
                            <div class="pricing-table-inner bg-flashlight">
                                <div class="pricing-header">
                                    <h4 class="title">Autopulse</h4>
                                    <div class="pricing">
                                        <div class="price-wrapper"><span class="currency">$</span><span class="price">{{ $plans->price}}</span></div><span class="subtitle">USD Per
                                            Month</span>
                                    </div>
                                </div>
                                <div class="separator-animated animated-true mt--30 mb--30"></div>
                                <div class="pricing-footer"><a class="rainbow-gradient-btn m-0" href="{{ route('dealer.signup') }}"><span>Purchase Now</span></a></div>
                                <div class="pricing-body mb-0 mt--30">
                                    <ul class="list-style--1 text-start">
                                        <li><i class="feather-check-circle"></i> AI-Powered Inventory Search</li>
                                        <li><i class="feather-check-circle"></i> Detailed Car Insights</li>
                                        <li><i class="feather-check-circle"></i> Seamless Lead Generation</li>
                                        <li><i class="feather-check-circle"></i>Boost Dealer Sales & Efficiency</li>
                                        <li><i class="feather-check-circle"></i> Customizable for Your Dealership</li>
                                    
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-4 col-md-6 col-12">
                        <div class="rainbow-pricing style-2 active">
                            <div class="pricing-table-inner bg-flashlight">
                                <div class="pricing-header">
                                    <h4 class="title">AutoPulse</h4>
                                    <div class="pricing">
                                        <div class="price-wrapper"><span class="currency">$</span><span class="price">799</span></div><span class="subtitle">USD Per
                                            Month</span>
                                    </div>
                                </div>
                                <div class="separator-animated animated-true mt--30 mb--30"></div>
                                <div class="pricing-footer"><a class="rainbow-gradient-btn m-0" data-bs-toggle="modal" data-bs-target="#bookaDemoModal"><span>Talk to Sales</span></a></div>
                                <div class="pricing-body mb-0 mt--30">
                                    <ul class="list-style--1 text-start">
                                        <li><i class="feather-check-circle"></i> AI-Powered Inventory Search</li>
                                        <li><i class="feather-check-circle"></i> Detailed Car Insights</li>
                                        <li><i class="feather-check-circle"></i> Seamless Lead Generation</li>
                                        <li><i class="feather-check-circle"></i>Boost Dealer Sales & Efficiency</li>
                                        <li><i class="feather-check-circle"></i> Customizable for Your Dealership</li>
                                      
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-4 col-md-6 col-12">
                        <div class="rainbow-pricing style-2 active">
                            <div class="pricing-table-inner bg-flashlight">
                                <div class="pricing-header">
                                    <h4 class="title">Enterprise</h4>
                                    <div class="pricing">
                                        <div class="price-wrapper"><span class="currency theme_color"><b>Custom Pricing</b></span></div>
                                    </div>
                                </div>
                                <div class="separator-animated animated-true mt--30 mb--30"></div>
                                <div class="pricing-footer"><a class="rainbow-gradient-btn m-0" data-bs-toggle="modal" data-bs-target="#bookaDemoModal"><span>Talk to Sales</span></a></div>
                                <div class="pricing-body mb-0 mt--30">
                                    <ul class="list-style--1 text-start">
                                        <li><i class="feather-check-circle"></i> Bulk Account for Autopulse</li>
                                        <li><i class="feather-check-circle"></i> Bulk AI-Powered  Inventory Search</li>
                                        <li><i class="feather-check-circle"></i> Detailed Car Insights</li>
                                        <li><i class="feather-check-circle"></i> Seamless Lead Generation</li>
                                        <li><i class="feather-check-circle"></i>Boost Dealer Sales & Efficiency</li>
                                        <li><i class="feather-check-circle"></i> Customizable for Your Dealership</li>
                                      
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- End Pricing Area  -->

        <!-- Start Accordion-2 Area  -->
        <div class="rainbow-accordion-area rainbow-section-gap">
            <div class="container">
                <div class="row">
                    <div class="col-lg-10 offset-lg-1">
                        <div class="section-title text-center" data-sal="slide-up" data-sal-duration="700" data-sal-delay="100">
                           
                            <h2 class="title w-600 mb--20">Frequently Asked Questions</h2>
                        </div>
                    </div>
                </div>
                <div class="row mt--35 row--20">
                    <div class="col-lg-10 offset-lg-1">
                        <div class="rainbow-accordion-style  accordion">
                            <div class="accordion" id="accordionExamplea">
                                <div class="accordion-item card">
                                    <h2 class="accordion-header card-header" id="headingOne">
                                        <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#collapseOne" aria-expanded="true" aria-controls="collapseOne">
                                        What is Autopulse AI and how does it work?
                                        </button>
                                    </h2>
                                    <div id="collapseOne" class="accordion-collapse collapse show" aria-labelledby="headingOne" data-bs-parent="#accordionExamplea">
                                        <div class="accordion-body card-body">
                                            Autopulse AI is an AI-powered tool designed specifically for auto dealerships. It helps users search inventory, provides detailed car information, and allows potential buyers to express interest in vehicles, streamlining communication with dealers.

                                        </div>
                                    </div>
                                </div>

                                <div class="accordion-item card">
                                    <h2 class="accordion-header card-header" id="headingTwo">
                                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseTwo" aria-expanded="false" aria-controls="collapseTwo">
                                            How can Autopulse AI help boost my auto dealership’s sales?

                                        </button>
                                    </h2>
                                    <div id="collapseTwo" class="accordion-collapse collapse" aria-labelledby="headingTwo" data-bs-parent="#accordionExamplea">
                                        <div class="accordion-body card-body">
                                            Autopulse AI optimizes the car search process with AI-driven recommendations, generates detailed insights about each vehicle, and simplifies customer engagement. By improving the user experience and automating lead generation, dealerships can close deals faster and increase sales.

                                        </div>
                                    </div>
                                </div>

                                <div class="accordion-item card">
                                    <h2 class="accordion-header card-header" id="headingThree">
                                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseThree" aria-expanded="false" aria-controls="collapseThree">
                                        What makes Autopulse AI different from a regular chatbot?
                                        </button>
                                    </h2>
                                    <div id="collapseThree" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#accordionExamplea">
                                        <div class="accordion-body card-body">
                                        Unlike regular chatbots, Autopulse AI is specifically designed for auto dealerships. It not only handles conversations but also offers advanced inventory search, personalized recommendations, detailed vehicle insights, and seamless lead generation, all tailored to the automotive industry.
                                        </div>
                                    </div>
                                </div>

                                <div class="accordion-item card">
                                    <h2 class="accordion-header card-header" id="headingFour">
                                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseFour" aria-expanded="false" aria-controls="collapseFour">
                                        Can Autopulse AI provide detailed insights about each car in my inventory?
                                        </button>
                                    </h2>
                                    <div id="collapseFour" class="accordion-collapse collapse" aria-labelledby="headingFour" data-bs-parent="#accordionExamplea">
                                        <div class="accordion-body card-body">
                                        Yes, Autopulse AI provides comprehensive information about each car, including specifications, features, and more. This enables customers to make informed decisions without having to browse multiple sources.
                                        </div>
                                    </div>
                                </div>
                                <div class="accordion-item card">
                                    <h2 class="accordion-header card-header" id="headingFive">
                                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseFive" aria-expanded="false" aria-controls="collapseFive">
                                        How does Autopulse AI handle customer inquiries and leads?
                                        </button>
                                    </h2>
                                    <div id="collapseFive" class="accordion-collapse collapse" aria-labelledby="headingFive" data-bs-parent="#accordionExamplea">
                                        <div class="accordion-body card-body">
                                        Autopulse AI automates customer engagement by allowing users to express interest directly through the platform. It captures this interest and sends it to the dealer, ensuring a smooth flow from inquiry to lead generation.
                                        </div>
                                    </div>
                                </div>
                                <div class="accordion-item card">
                                    <h2 class="accordion-header card-header" id="headingSix">
                                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseSix" aria-expanded="false" aria-controls="collapseSix">
                                        Is Autopulse AI customizable for different dealership needs?
                                        </button>
                                    </h2>
                                    <div id="collapseSix" class="accordion-collapse collapse" aria-labelledby="headingSix" data-bs-parent="#accordionExamplea">
                                        <div class="accordion-body card-body">
                                        Absolutely! Autopulse AI can be tailored to fit the specific needs of your dealership, including inventory size, customer engagement preferences, and integration with your current systems.
                                        </div>
                                    </div>
                                </div>

                                <div class="accordion-item card">
                                    <h2 class="accordion-header card-header" id="headingSeven">
                                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseSeven" aria-expanded="false" aria-controls="collapseSeven">
                                        How does Autopulse AI ensure seamless communication between customers and dealers?
                                        </button>
                                    </h2>
                                    <div id="collapseSeven" class="accordion-collapse collapse" aria-labelledby="headingSeven" data-bs-parent="#accordionExamplea">
                                        <div class="accordion-body card-body">
                                        Autopulse AI allows users to express interest in specific vehicles, which is instantly communicated to the dealership. Dealers can then follow up directly, eliminating gaps in communication and ensuring timely responses.

                                        </div>
                                    </div>
                                </div>
                                <div class="accordion-item card">
                                    <h2 class="accordion-header card-header" id="headingEight">
                                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseEight" aria-expanded="false" aria-controls="collapseEight">
                                        Can Autopulse AI integrate with my dealership’s existing CRM?
                                        </button>
                                    </h2>
                                    <div id="collapseEight" class="accordion-collapse collapse" aria-labelledby="headingEight" data-bs-parent="#accordionExamplea">
                                        <div class="accordion-body card-body">
                                        Yes, Autopulse AI is designed to integrate seamlessly with most customer relationship management (CRM) systems, ensuring a smooth transition of leads and data into your existing workflows.
                                        </div>
                                    </div>
                                </div>
                                <div class="accordion-item card">
                                    <h2 class="accordion-header card-header" id="headingNine">
                                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseNine" aria-expanded="false" aria-controls="collapseNine">
                                        What kind of reports or analytics does Autopulse AI provide?
                                        </button>
                                    </h2>
                                    <div id="collapseNine" class="accordion-collapse collapse" aria-labelledby="headingNine" data-bs-parent="#accordionExamplea">
                                        <div class="accordion-body card-body">
                                        Autopulse AI offers valuable insights into customer behavior, lead generation, and inventory performance. These reports can help dealerships make informed business decisions and optimize their operations.
                                        </div>
                                    </div>
                                </div>
                                <div class="accordion-item card">
                                    <h2 class="accordion-header card-header" id="headingTen">
                                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseTen" aria-expanded="false" aria-controls="collapseTen">
                                        How easy is it to set up Autopulse AI for my dealership?
                                        </button>
                                    </h2>
                                    <div id="collapseTen" class="accordion-collapse collapse" aria-labelledby="headingTen" data-bs-parent="#accordionExamplea">
                                        <div class="accordion-body card-body">
                                        Setting up Autopulse AI is simple and efficient. Our team provides step-by-step guidance and support to ensure the system is integrated smoothly with your existing processes, allowing you to start benefiting from the tool quickly.
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- End Accordion-2 Area  -->

        <!-- Start Footer Area  -->
        @include('template.dealers.include.footer')
        <!-- End Footer Area  -->

        <!-- Start Copy Right Area  -->
        @include('template.dealers.include.copyRight')
        <!-- End Copy Right Area  -->

        <div class="rn-progress-parent">
            <svg class="rn-back-circle svg-inner" width="100%" height="100%" viewBox="-1 -1 102 102">
                <path d="M50,1 a49,49 0 0,1 0,98 a49,49 0 0,1 0,-98" style="transition: stroke-dashoffset 10ms linear 0s; stroke-dasharray: 307.919, 307.919; stroke-dashoffset: 307.919;"></path>
            </svg>
        </div>

        <!-- Start Forgot Password Modal  -->
        <div id="videoModal" class="modal rbt-modal-box fade" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content wrapper top-flashlight leftside light-xl modal-large text-center p-0">
                    <div class="ratio ratio-16x9">
                        <!-- Custom Video Player -->
                        <video id="customVideo" style="top: -6px;" controls>
                            <source src="{{ asset('assets/front/video/front-video.mp4') }}" type="video/mp4">
                            <!-- <source src="path/to/your/video.ogg" type="video/ogg"> -->
                            Your browser does not support the video tag.
                        </video>
                    </div>

                    <button class="close-button" data-bs-dismiss="modal">
                        <i class="feather-x"></i>
                    </button>
                </div>
            </div>
        </div>
        <!-- End Forgot Password Modal  -->

@endsection
@push ('after-scripts')
<script>
    // HEADER JS - Header Sticky after login
    jQuery('.rbt-dashboard-header').addClass('header-sticky');

    // VIDEO JS
    // Ensure the custom video restarts from the beginning each time the modal opens
    jQuery('#videoModal').on('show.bs.modal', function () {
        const videoElement = document.getElementById('customVideo');
        videoElement.currentTime = 0; // Reset video to start
        videoElement.play(); // Automatically play the video when modal opens
    });

    // Pause the video when the modal is closed
    jQuery('#videoModal').on('hidden.bs.modal', function () {
        const videoElement = document.getElementById('customVideo');
        videoElement.pause(); // Pause the video
        videoElement.currentTime = 0; // Reset video to start
    });

</script>
@endpush