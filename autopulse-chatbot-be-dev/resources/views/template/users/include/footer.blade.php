
<footer class="footer_section">
    <div class="container">
        <div class="footer_top">
            <div class="row">
                <div class="col col-lg-3 col-md-12 col-12">
                    <div class="footer_logo_dealer">
                        <div class="position-relative footer_logo">
                            <a href="/">
                            @if(isset($setting['website_logo']) && !empty($setting['website_name'])) 
                                <img src="{{ $setting['website_logo'] }}" alt="{{ $setting['website_logo'] }}">
                            @else 
                                <img src="{{asset('assets/images/logo.png') }}" alt="Logo">
                            @endif
                            </a>
                        </div>
                        <div class="position-relative footer_dealer">
                            <a href="{{ route('dealer.index') }}" class="btn" target="_blank"><i class="fa-solid fa-eye me-2"></i>Dealer</a>
                        </div>
                    </div>
                </div>
                <div class="col col-lg-6 col-md-12 col-12">
                    <div class="position-relative">
                        <div class="row">
                            <div class="col col-md-12 col-12">
                                <div class="footer_sec_head">
                                    <h5>Useful Links</h5>
                                </div>
                            </div>
                            <div class="col col-md-6 col-6">
                                <div class="useful_link_list">
                                    <ul>
                                    <li><a href="{{ route('vechile') }}?car_type=new">Explore New Cars</a></li>
                                        <li><a href="{{ route('vechile') }}?car_type=used">Explore Used Cars</a></li>
                                        <li><a href="{{ route('about') }}">About Us</a></li>
                                        <li><a href="{{ route('faq') }}">FAQ’s</a></li>
                                    </ul>
                                </div>
                            </div>
                            <div class="col col-md-6 col-6">
                                <div class="useful_link_list">
                                    <ul>

                                        <li><a href="{{ route('contactus') }}">Contact Us</a></li>
                                        <li><a href="{{ route('blog_list') }}">Blog</a></li>
                                        <li><a href="{{ route('media_list') }}">Press Release</a></li>
                                        
                                        <li><a href="{{ route('term') }}">Terms and Conditions</a></li>
                                        <li><a href="{{ route('privacy') }}">Privacy Policy</a></li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col col-lg-3 col-md-12 col-12">
                    <div class="footer_social_media">
                        <div class="footer_sec_head">
                            <h5>Connect with us</h5>
                        </div>
                        <div class="footer_social">
                            <ul>
                                @if(isset($setting['website_twitter']) && !empty($setting['website_twitter'])) 
                                    <li><a href="{{ $setting['website_twitter'] }}" class="tw"><i class="fa-brands fa-twitter   "></i></a></li>
                                @endif

                                @if(isset($setting['website_fb']) && !empty($setting['website_fb'])) 
                                    <li><a href="{{ $setting['website_fb'] }}" class="fb"><i class="fa-brands fa-facebook"></i></a></li>
                                @endif

                                @if(isset($setting['website_youtube']) && !empty($setting['website_youtube'])) 
                                    <li><a href="{{ $setting['website_youtube'] }}" class="fb"><i class="fa-brands fa-youtube"></i></a></li>
                                @endif
                                @if(isset($setting['website_linkedin']) && !empty($setting['website_linkedin'])) 
                                    <li><a href="{{ $setting['website_linkedin'] }}" class="ln"><i class="fa-brands fa-linkedin"></i></a></li>
                                @endif
                                
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <hr class="m-0">

        <!-- Copyright -->
        <div class="footer_copyright">
            <div class="row">
                <div class="col col-md-6 col-12">
                    <p>Copyright © {{ date('Y')}} autopulse.ai</p>
                </div>
                <div class="col col-md-6 col-12 text-md-end">
                    <p>Design & developed by <a href="https://katharostechie.in/" target="_blank">Katharos Techie</a></p>
                </div>
            </div>
        </div>
    </div>
</footer>
<div id="loader-overlay" class="loader-overlay" style="display:none;">
    <div class="loader_inn">
        <i class="fa-duotone fa-tire"></i>
    </div>
</div>

<!-- Autopulse default modal -->
<div class="modal fade" id="autoModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content auto_modal_out">
        <div class="modal-body auto_modal">
            <div class="position-relative">
                <a class="modal_close_btn text-white" data-bs-dismiss="modal" aria-label="Close"><i class="fa-regular fa-xmark"></i></a>

                <div class="row">
                    <div class="col col-12">
                        <div class="position-relative">                            
                            <div class="position-relative autopopimg_out">                            
                                <img src="{{asset('assets/images/auto/auto_popup.png') }}" alt="Image" class="img-fluid" id="autopopimg">
                                <div class="autopopimgloader"></div>
                            </div>
                            <div class="position-relative auto_modal_text">                            
                                <div class="modal_heading">
                                    <h3>Car Shopping Simplified.</h3>
                                </div>
                                <div class="position-relative text-center">
                                    <a href="javascript:void(0)" class="btn btn_theme w-75 chatboxO_a" data-bs-dismiss="modal">Search Now with AI</a>
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
