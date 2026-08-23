@if(auth()->guard('dealer')->check())
<header class="rbt-dashboard-header rainbow-header header-default header-left-align rbt-fluid-header">
    <div class="container-fluid position-relative">
        <div class="row align-items-center">
            <div class="col-lg-2 col-md-6 col-7">
                <div class="header-left d-flex">
                    <div class="expand-btn-grp">
                        <button class="bg-solid-primary popup-dashboardleft-btn"><i class="feather-sidebar left"></i></button>
                    </div>
                    <div class="logo">
                        <a href="{{route('dealer.profile') }}">
                            <img class="logo-light" src="{{ asset('assets/images/auto/logo-w.png') }}" alt="ChatBot Logo">
                            <img class="logo-dark" src="{{ asset('assets/images/auto/logo-w.png') }}" alt="Corporate Logo">
                        </a>
                    </div>
                </div>
            </div>
            <div class="col-lg-10 col-md-6 col-5">
                <div class="header-right">
                    <!-- <nav class="mainmenu-nav d-none d-lg-block text-center">
                        <ul class="mainmenu">
                            <li>
                                <a href="{{route('dealer.login') }}">Hello {{ auth('dealer')->user()->name }}</a>
                            </li>
                        </ul>
                    </nav> 

                    <div class="header-btn d-none d-md-block">
                        <a class="btn-default btn-small round me-3" href="{{route('dealer.billing') }}">Upgrade <i class="feather-zap"></i></a>
                    </div>
                    -->
                    <!-- Start Mobile-Menu-Bar -->
                    <!-- <div class="mobile-menu-bar mr--10 ml--10 d-block d-lg-none">
                        <div class="hamberger">
                            <button class="hamberger-button">
                                <i class="feather-menu"></i>
                            </button>
                        </div>
                    </div> -->
                    <!-- Start Mobile-Menu-Bar -->

                    <!-- Start admin Area  -->
                    <div class="account-access rbt-user-wrapper right-align-dropdown">
                        <div class="rbt-user ml--0">
                            <a class="admin-img" href="#"><img src="{{ asset('assets/front/images/user.png') }}" alt="Admin"></a>
                        </div>
                        <div class="rbt-user-menu-list-wrapper">
                            <div class="inner">
                                <div class="rbt-admin-profile pb-1">
                                    <div class="admin-info d-block">
                                        <span class="name d-block w-100">Hello {{ auth('dealer')->user()->name }}</span>
                                        <a class="rbt-btn-link color-primary" href="{{route('dealer.profile') }}">View Profile</a>
                                    </div>
                                </div>                     
                                <hr class="mt--10 mb--10">
                                <ul class="user-list-wrapper user-nav">
                                    <li>
                                        <a href="{{route('dealer.chat.index') }}">
                                            <i class="feather-message-square"></i>
                                            <span>Chatbot</span>
                                        </a>
                                    </li>
                                    <li>
                                        <a href="{{route('dealer.contact') }}">
                                            <i class="feather-phone"></i>
                                            <span>Contact</span>
                                        </a>
                                    </li>
                                </ul>           
                                <hr class="mt--10 mb--10">
                                <ul class="user-list-wrapper">
                                    <li>
                                        <a href="javascript:void(0)" data-bs-toggle="modal" data-bs-target="#dealerlogoutConfirmationModal">
                                            <i class="feather-log-out"></i>
                                            <span>Logout</span>
                                        </a>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <!-- Start admin Area  -->

                    <div class="expand-btn-grp d-none">
                        <button class="bg-solid-primary popup-dashboardright-btn"><i class="feather-sidebar right"></i></button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</header>

<!-- Start Logout Modal  -->
<div id="dealerlogoutConfirmationModal" class="modal rbt-modal-box fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content wrapper top-flashlight leftside light-xl modal-small text-center align-items-center">
            <p class="b1 text-center mb--0">Are you sure? You want to logout?</p>
            <div class="bottom-btn mt--20 w-100">
                <button data-bs-dismiss="modal" class="btn-default btn-border btn-small round">No</button>
                <a href="{{ route('dealer.logout')}}" class="btn-default btn-small round">Yes</a>
            </div>
            <button class="close-button" data-bs-dismiss="modal">
                <i class="feather-x"></i>
            </button>
        </div>
    </div>
</div>
<!-- End Logout Modal  -->

@else

<header class="rainbow-header header-default header-transparent header-sticky">
    <div class="container position-relative">
        <div class="row align-items-center row--0">
            <div class="col-lg-2 col-md-6 col-6 d-flex align-items-center">
                <!-- Start Mobile-Menu-Bar -->
                <div class="mobile-menu-bar mr--15 d-block d-lg-none">
                    <div class="hamberger">
                        <button class="hamberger-button">
                            <i class="feather-menu"></i>
                        </button>
                    </div>
                </div>
                <!-- Start Mobile-Menu-Bar -->
                <div class="logo">
                    <a href="/">
                        <img class="logo-light" src="{{ asset('assets/images/auto/logo-w.png') }}" alt="Logo">
                        <img class="logo-dark" src="{{ asset('assets/images/auto/logo-w.png') }}" alt="Logo">
                    </a>
                </div>
            </div>
            <div class="col-lg-8 d-none d-lg-block">
                <nav class="mainmenu-nav d-none d-lg-flex justify-content-center">
                    <ul class="mainmenu">
                        <li>
                            <a href="{{route('dealer.login') }}">Sign In</a>
                        </li>
                        <li>
                            <a href="{{route('dealer.signup') }}">Sign Up</a>
                        </li>
                        <li>
                            <a href="{{route('dealer.index') }}#pricing">Pricing</a>
                        </li>
                        <li>
                            <a href="{{route('dealer.contact') }}">Contact</a>
                        </li>
                    </ul>
                </nav>
            </div>
            <div class="col-lg-2 col-md-6 col-6 position-static">
                <div class="header-right">
                    <!-- Start Header Btn  -->
                     <div class="header-btn">
                        <a class="rainbow-gradient-btn" target="_blank" href data-bs-toggle="modal" data-bs-target="#bookaDemoModal"><span>Book a Demo</span></a>
                    </div>

                    <!-- <div class="header-btn">
                        <button class="btn-default btn-small round" data-bs-toggle="modal" data-bs-target="#bookaDemoModal">Book a Demo</button>
                    </div> -->
                    <!-- End Header Btn  -->

                    
                </div>
            </div>
        </div>
    </div>
</header>
@endif


<!-- Start Book a Demo Modal  -->
@include('template.dealers.include.bookademo')
<!-- End Book a Demo Modal  -->