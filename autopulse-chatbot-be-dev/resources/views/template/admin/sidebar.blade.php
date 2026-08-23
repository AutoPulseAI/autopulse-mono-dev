<div id="sideNav" class="d-flex flex-column flex-shrink-0 sidebar_main">
    <a href="{{ route('admin.dashboard') }}" class="text-decoration-none sidebar_logo">
        @if(isset($setting['website_logo']) && !empty($setting['website_logo'])) 
            <img src="{{ $setting['website_logo'] }}" alt="{{ $setting['website_logo'] }}">
        @else 
            <img src="{{asset('assets/images/auto/logo-w.png') }}" alt="Logo" >
        @endif
    </a>

    <ul class="nav nav-pills flex-column mb-auto sidebar_nav">
       
        <li>
            <a href="{{ route('admin.dashboard') }}" class="nav-link{{ request()->routeIs('admin.dashboard') ? ' active' : '' }}"><i class="fa-light fa-grid-2"></i>Dashboard</a>
        </li>       
       
        <li>
            <a href="{{ route('dealerlist.index') }}" class="nav-link{{ request()->routeIs('dealerlist.index') ? ' active' : '' }}"><i class="fa-light fa-store"></i>Manage Stores</a>
        </li>

        <li>
            <a href="{{ route('admin.employee') }}" class="nav-link{{ request()->routeIs('admin.employee') ? ' active' : '' }}"><i class="fa-light fa-users"></i>Manage Employee</a>
        </li>
       
        <!--<li>
            <a href="{{ route('reqeust.index') }}" class="nav-link{{ request()->routeIs('reqeust.index') ? ' active' : '' }}"><i class="fa-light fa-hand-wave"></i>Request Demo</a>
        </li>-->
        <li>
            <a href="{{ route('admin.transaction') }}" class="nav-link{{ request()->routeIs('admin.transaction') ? ' active' : '' }}"><i class="fa-light fa-sack-dollar"></i>Transaction</a>
        </li>
        
        <li>
            <a href="{{ route('admin.plan.index') }}" class="nav-link{{ request()->routeIs('admin.plan.index') ? ' active' : '' }}"><i class="fa-light fa-credit-card"></i>Plans</a>
        </li>
        
        <li>
            <a href="{{ route('admin.cancellation.request.list') }}" class="nav-link{{ request()->routeIs('admin.cancellation.request.list') ? ' active' : '' }}"><i class="fa-light fa-square-xmark"></i>Cancellation</a>
        </li>

        <li>
            <a href="{{ route('lead.index') }}" class="nav-link{{ request()->routeIs('lead.index') ? ' active' : '' }}"><i class="fa-light fa-magnet"></i>Leads</a>
        </li>
        <li>
            <a href="{{ route('booking.index') }}" class="nav-link{{ request()->routeIs('booking.index') ? ' active' : '' }}"><i class="fa-light fa-lock-keyhole"></i>Appointment</a>
        </li>

        <li>
            <a href="{{ route('admin.log') }}" class="nav-link{{ request()->routeIs('admin.log') ? ' active' : '' }}"><i class="fa-light fa-comments"></i>Conversations</a>
        </li>
    </ul>

    <div class="dropdown sidebar_dropdown">
        <a href="#" class="d-flex align-items-center link-light text-decoration-none dropdown-toggle" id="dropdownUser2" data-bs-toggle="dropdown" aria-expanded="false">
            @if(auth('admin')->user()->profile_pic)
                <img src="{{ auth('admin')->user()->profile_pic }}" width="32" height="32" class="rounded-circle me-2">
            @else
                <img src="{{ asset('assets/admin/images/avatar.png') }}" alt="" width="32" height="32" class="rounded-circle me-2">
            @endif
            <strong>{{ auth('admin')->user()->name }}</strong>
        </a>
        <ul class="dropdown-menu text-small shadow" aria-labelledby="dropdownUser2">
            <!-- <li><a class="dropdown-item" href="{{ route('admin.setting') }}">Setting</a></li> -->
            <li><a class="dropdown-item" href="{{ route('admin.profile') }}"><i class="fa-light fa-user me-2"></i>Profile</a></li>
            <li><hr class="dropdown-divider"></li>
            <li>
                <form method="get" action="{{ route('admin.logout') }}">
                    @csrf
                    <a href="login" onclick="event.preventDefault(); this.closest('form').submit();" class="dropdown-item"><i class="fa-light fa-right-from-bracket me-2"></i>Log out</a>
                </form>
            </li>
        </ul>
    </div>
</div>
