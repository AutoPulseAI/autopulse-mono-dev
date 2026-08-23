<div class="popup-mobile-menu">
        <div class="inner-popup">
            <div class="header-top">
                <div class="logo">
                    <a href="/">
                        <img class="logo-light" src="{{ asset('assets/images/auto/logo-w.png') }}" alt="ChatBot Logo">
                        <img class="logo-dark" src="{{ asset('assets/images/auto/logo-w.png') }}" alt="Corporate Logo">
                    </a>
                </div>
                <div class="close-menu">
                    <button class="close-button">
                        <i class="feather-x"></i>
                    </button>
                </div>
            </div>

            <div class="content">
                <ul class="mainmenu">
                    <li>                                
                        <a href="{{route('dealer.index') }}#pricing">Pricing</a>
                    </li>
                    <li>                                
                        <a href="{{route('dealer.login') }}">Sign In</a>
                    </li>
                    <li>                                
                        <a href="{{route('dealer.signup') }}">Sign Up</a>
                    </li>
                    <li>                                
                        <a href="{{route('dealer.contact') }}">Contact</a>
                    </li>
                </ul>
            </div>

            <!-- Start Header Btn  -->
            <div class="header-btn d-block d-md-none">
                <button class="btn-default close-menu" data-bs-toggle="modal" data-bs-target="#bookaDemoModal">Book a Demo</button>
            </div>
            <!-- End Header Btn  -->
        </div>
    </div>