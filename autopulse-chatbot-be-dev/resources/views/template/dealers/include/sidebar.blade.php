<!-- Start Left panel -->
<div class="rbt-left-panel popup-dashboardleft-section">
    <div class="rbt-default-sidebar">
        <div class="inner">
            <div class="content-item-content">
                <div class="rbt-default-sidebar-wrapper">
                    <nav class="mainmenu-nav">
                        <ul class="dashboard-mainmenu rbt-default-sidebar-list">
                            <li><a href="{{route('dealer.chat.index') }}"><i class="feather-message-square"></i><span>Chatbot</span></a></li>
                            <li><a href="{{route('dealer.conversation') }}"><i class="feather-shopping-bag"></i><span>Conversation</span></a></li>
                            <li><a href="{{route('dealer.profile') }}"><i class="feather-user"></i><span>Profile Settings</span></a></li>
                            <li><a href="{{route('dealer.facebook') }}"><i class="feather-user"></i><span>Facebook Connect</span></a></li>
                            <li><a href="{{route('dealer.billing') }}"><i class="feather-briefcase"></i><span>Manage Billing</span></a></li>
                            <li><a href="{{route('dealer.mylead') }}"><i class="feather-info"></i><span>Leads</span></a></li>
                            <li><a href="{{route('dealer.mybooking') }}"><i class="feather-info"></i><span>Appointment</span></a></li>
                        </ul>
                    </nav>
                </div>
            </div>
        </div>
        <div class="subscription-box">
            <div class="inner">
                <a href="{{route('dealer.profile') }}" class="autor-info">
                    <div class="author-desc">
                        <h6>{{ auth('dealer')->user()->name }}</h6>
                        <p>{{ auth('dealer')->user()->email }}</p>
                    </div>
                    <div class="author-badge"></div>
                </a>
                <div class="btn-part">
                    <a href="javascript:void(0)" class="btn-default btn-border" data-bs-toggle="modal" data-bs-target="#dealerlogoutConfirmationModal">Logout</a>
                </div>
            </div>
        </div>
        <p class="subscription-copyright copyright-text text-center b4  small-text">© {{ date('Y')}} <a>Autopulse Ai</a>.</p>
    </div>
</div>
<!-- End Left panel -->