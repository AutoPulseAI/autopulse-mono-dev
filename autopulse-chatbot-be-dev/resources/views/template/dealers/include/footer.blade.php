<!-- Start Footer Area  -->
<footer class="rainbow-footer footer-style-default footer-style-3 position-relative mt-0">
    <div class="footer-top pb-0">
        <div class="container">
            <div class="row justify-content-center pb--30">
                <div class="col-lg-4 col-md-6 col-sm-12 col-12">
                    <div class="rainbow-footer-widget text-center">
                        <div class="logo">
                            <a href="/">
                            @if(isset($setting['website_logo']) && !empty($setting['website_name'])) 
                                <img class="logo-light" src="{{ $setting['website_logo'] }}" alt="{{ $setting['website_logo'] }}">
                                <img class="logo-dark m-auto" src="{{ $setting['website_logo'] }}" alt="{{ $setting['website_logo'] }}">
                            @else 
                                <img class="logo-light" src="{{ asset('assets/images/auto/logo-w.png') }}" alt="Logo">
                                <img class="logo-dark m-auto" src="{{ asset('assets/images/auto/logo-w.png') }}" alt="Logo">
                            @endif
                            </a>
                        </div>
                        <p class="b1 text-center mt--20 mb--0">AI-Powered Solutions for Dealership Growth.</p>
                    </div>
                </div>
            </div>
            <!-- <div class="separator-animated animated-true mt--50"></div> -->
        </div>
    </div>
</footer>
<!-- End Footer Area  -->
 
@push ('after-scripts')

@endpush