<div class="offcanvas-collapse h-100" id="mobMenu">
    <div class="account_menu sticky" id="account_menu">
        <div class="account_menu_profile">
            <div class="profile_picture">
                <form id="user_profile_form" action="{{ route('updateProfilepic') }}">
                    @csrf
                    <div class="position-relative">
                        <div class="circle">
                            @if(auth()->user()->profile_pic)
                                <img class="profile-pic" src="{{auth()->user()->profile_pic}}">  
                            @else
                                <img class="profile-pic" src="{{asset('assets/images/prof_pic.jpg') }}">  
                            @endif                                  
                        </div>
                        <div class="p-image">
                            <i class="fa-solid fa-pen upload-button"></i>
                            <input class="file-upload" type="file" name="profile_pic" accept="image/*"/>
                        </div>
                    </div>  
                </form>                              
            </div>
            <div class="profile_info">
                <h5>{{ auth()->user()->name }} {{ auth()->user()->last_name }}</h5>
                <p>{{ auth()->user()->phone_number}}</p>
            </div>
        </div>
        <div class="account_menu_list">
            <ul>
                <li>
                    <a href="{{route('listVisit')}}" class="page_link"><span>Vehicles Of Interest</span><i class="fa-solid fa-angle-right"></i></a>
                </li>
                <li>
                    <a href="{{route('favourite')}}" class="page_link"><span>My Favorites</span><i class="fa-solid fa-angle-right"></i></a>
                </li>
                <li>
                    <a href="{{route('dashboard')}}" class="page_link"><span>Profile Settings</span><i class="fa-solid fa-angle-right"></i></a>
                </li>
            </ul>
            <hr class="m-0">
            <ul>
                <li>
                    <a data-bs-toggle="modal" data-bs-target="#logoutConfirmationModal"><span>Logout</span></a>
                </li>
            </ul>
        </div>
    </div>
    <button type="button" class="btn-close text-reset offcanvas_close" id="mobMenuBtn" data-bs-dismiss="offcanvas" aria-label="Close"></button>
</div>
