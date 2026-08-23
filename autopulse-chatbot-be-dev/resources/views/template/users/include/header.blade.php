<header class="main_header" id="main_header">
    <nav class="navbar">
        <div class="container-fluid">
            <a href="{{route('home')}}" class="navbar-brand">
                @if(isset($setting['website_logo_light']) && !empty($setting['website_logo_light'])) 
                    <img src="{{ $setting['website_logo_light'] }}" alt="{{ $setting['website_logo_light'] }}" class="logo_light">
                @else 
                    <img src="{{asset('assets/images/logo.png') }}" alt="Logo" class="logo_light">
                @endif

                @if(isset($setting['website_logo_dark']) && !empty($setting['website_logo_dark'])) 
                    <img src="{{ $setting['website_logo_dark'] }}" alt="{{ $setting['website_logo_dark'] }}" class="logo_dark">
                @else 
                    <img src="{{asset('assets/images/logo-b.png') }}" alt="Logo" class="logo_dark">
                @endif
               
                <!--img src="{{asset('assets/images/logo-b.png') }}" alt="autopulse.ai" class="logo_dark"-->
            </a>
            <div class="nav_auth order-md-3">
               
                @if(auth()->check())
                    <a href="{{ route('favourite') }}" class="nav_auth_heart"><i class="fa-regular fa-heart"></i></a>
                    <a href="{{ route('dashboard') }} " class="nav_auth_login"><i class="fa-regular fa-user me-lg-3 me-2"></i>Hello {{ auth()->user()->name }}</a>
                @else
                    <a data-bs-toggle="modal" data-bs-target="#userLoginModal" class="nav_auth_heart"><i class="fa-regular fa-heart"></i></a>
                    <a data-bs-toggle="modal" data-bs-target="#userLoginModal" class="nav_auth_login"><i class="fa-regular fa-user me-lg-3 me-2"></i><span>Login / Signup</span></a>
                    <a href="{{ route('dealer.index') }}" class="btn nav_dealerbtn" >Dealer</a>
                @endif
                
            </div>
            <!--div class="position-relative nav_search order-md-2">
                <div class="input-group">
                    <input type="text" class="form-control" placeholder="Search Car">
                    <button class="btn" type="button"><i class="fa-solid fa-magnifying-glass"></i></button>
                </div>
            </div-->                
        </div>
    </nav>
</header>