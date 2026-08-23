@extends('layouts.admin')
 
@section('content')

<div class="position-relative">
    <div class="row gx-2">
        <div class="col col-md-12 col-12 page_title">
            <div class="page_title mb-3">
                <h2>Edit Profile</h2>
            </div>
        </div>       
    </div>

    @if(session()->has('success'))
        <div class="row">
            <div class="alert alert-success alert-dismissible text-white" role="alert">
                <span class="text-sm">{{ Session::get('success') }}</span>
                <button type="button" class="btn-close text-lg py-3 opacity-10" data-bs-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    @endif

    <div class="tab_box">
        <ul class="nav nav-pills underline_tabs border-bottom mt-3" role="tablist">
            <li class="nav-item">
                <a class="nav-link active" data-bs-toggle="pill" id="storelistall" href="#profInfo">Profile Information</a>
            </li>
            <li class="nav-item">
                <a class="nav-link" data-bs-toggle="pill" id="storelistall" href="#changepasss">Update Password</a>
            </li>
        </ul>

        <div class="tab-content">
            <div id="profInfo" class="tab-pane active">
                <div class="row justify-content-center mt-3">
                    <div class="col col-xl-7 col-lg-9 col-md-12 col-12">
                        <div class="position-relative mb-3">
                            <div class="position-relative">
                                @if (Session::has('profile'))
                                    <div class="alert alert-success alert-dismissible" role="alert">
                                        <span class="text-sm">{{ Session::get('profile') }}</span>
                                        <button type="button" class="btn-close text-lg py-3 opacity-10"
                                            data-bs-dismiss="alert" aria-label="Close">
                                            <span aria-hidden="true">&times;</span>
                                        </button>
                                    </div>
                                @elseif (Session::has('email'))
                                    <div class="alert alert-danger alert-dismissible" role="alert">
                                        <span class="text-sm">{{ Session::get('email') }}</span>
                                        <button type="button" class="btn-close text-lg py-3 opacity-10"
                                            data-bs-dismiss="alert" aria-label="Close">
                                            <span aria-hidden="true">&times;</span>
                                        </button>
                                    </div>
                                @endif
                            </div>

                            <div class="position-relative">
                                <form class="gx-3 gy-2" method="POST" action="{{ route('admin.updateProfile') }}" enctype="multipart/form-data">
                                    @csrf
                                    <div class="position-relative">
                                        <div class="position-relative px-lg-0 px-3">
                                            <h5 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                                                Profile Information
                                            </h5>

                                            <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                                Update your account's profile information and email address.
                                            </p>
                                        </div>
                                        <div class="tab_box_form border bg-transparent rounded">
                                            <div class="row gx-2 mb-3">
                                                <div class="col col-12 mb-3">                            
                                                    <label class="mb-2" for="name">Name</label>
                                                    <input id="name" type="text" class="form-control @error('name') is-invalid @enderror" name="name" value="{{ old('name',$user['name']) }}" required autocomplete="name" autofocus>
                                                    @error('name')
                                                        <span class="invalid-feedback" role="alert">
                                                            <strong>{{ $message }}</strong>
                                                        </span>
                                                    @enderror
                                                </div>
                                                
                                                <div class="col col-12 mb-3">
                                                    <label class="mb-2" for="profile_pic">Profile Picture</label>
                                                    <input id="profile_pic" type="file" class="form-control @error('profile_pic') is-invalid @enderror" 
                                                    name="profile_pic" value="{{ old('profile_pic',$user['profile_pic']) }}" autocomplete="profile_pic" autofocus>
                                                    @if(isset($user['profile_pic']))
                                                    <img src="{{$user['profile_pic']}}" width="100px" height="100px">
                                                    @endif
                                                    @error('profile_pic')
                                                        <span class="invalid-feedback" role="alert">
                                                            <strong>{{ $message }}</strong>
                                                        </span>
                                                    @enderror
                                                </div>

                                                <div class="col col-12">
                                                    <label class="mb-2" for="email">Email</label>
                                                    <input id="email" type="email" class="form-control @error('email') is-invalid @enderror" 
                                                    name="email" value="{{ old('email',$user['email']) }}" required autocomplete="email" autofocus>
                                                    @error('email')
                                                        <span class="invalid-feedback" role="alert">
                                                            <strong>{{ $message }}</strong>
                                                        </span>
                                                    @enderror
                                                </div>
                                            </div>
                                        </div>
                                        <div class="row justify-content-center">
                                            <div class="col col-lg-2 col-md-3 col-12">
                                                <div class="position-relative text-center mt-3">
                                                    <button type="submit" class="btn btn_theme w-100">
                                                        {{ __('Save') }}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="changepasss" class="tab-pane fade">
               <div class="row justify-content-center mt-3">
                    <div class="col col-xl-7 col-lg-9 col-md-12 col-12">
                        <div class="position-relative mb-3">
                            <div class="position-relative">
                                @if (Session::has('password'))
                                <div class="alert alert-success alert-dismissible" role="alert">
                                    <span class="text-sm">{{ Session::get('password') }}</span>
                                    <button type="button" class="btn-close text-lg py-3 opacity-10"
                                        data-bs-dismiss="alert" aria-label="Close">
                                        <span aria-hidden="true">&times;</span>
                                    </button>
                                </div>
                                @endif
                            </div>
                            
                            <div class="position-relative">
                                <form class="gx-3 gy-2" method="POST" action="{{ route('admin.updatePassword') }}" enctype="multipart/form-data">
                                    @csrf
                                    <div class="position-relative">
                                        <div class="position-relative px-lg-0 px-3">
                                            <h5 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                                                Update Password
                                            </h5>

                                            <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                                Ensure your account is using a long, random password to stay secure.
                                            </p>
                                        </div>

                                        <div class="tab_box_form border bg-transparent rounded">
                                            <div class="row gx-2 mb-3">
                                                <div class="col col-12 mb-3">
                                                    <label class="mb-2" for="current_password">Current Password</label>
                                                    <input id="current_password" type="password" class="form-control @error('current_password') is-invalid @enderror" 
                                                    name="current_password" value="{{ old('current_password') }}" autocomplete="current-password">
                                                    @error('current_password')
                                                        <span class="invalid-feedback" role="alert">
                                                            <strong>{{ $message }}</strong>
                                                        </span>
                                                    @enderror
                                                </div>

                                                <div class="col col-12 mb-3">
                                                    <label class="mb-2" for="new_password">New Password</label>
                                                    <input id="new_password" type="password" class="form-control @error('new_password') is-invalid @enderror" 
                                                    name="new_password" value="{{ old('new_password') }}" autocomplete="current-password">
                                                    @error('new_password')
                                                        <span class="invalid-feedback" role="alert">
                                                            <strong>{{ $message }}</strong>
                                                        </span>
                                                    @enderror
                                                </div>

                                                <div class="col col-12">
                                                    <label class="mb-2" for="confirm_password">Confirm New Password</label>
                                                    <input id="confirm_password" type="password" class="form-control @error('confirm_password') is-invalid @enderror" 
                                                    name="confirm_password" value="{{ old('confirm_password') }}" autocomplete="current-password">
                                                    @error('confirm_password')
                                                        <span class="invalid-feedback" role="alert">
                                                            <strong>{{ $message }}</strong>
                                                        </span>
                                                    @enderror
                                                </div>
                                            </div>
                                        </div>

                                        <div class="row justify-content-center">
                                            <div class="col col-lg-2 col-md-3 col-12">
                                                <div class="position-relative text-center mt-3">
                                                    <button type="submit" class="btn btn_theme w-100">
                                                        {{ __('Save') }}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
  
</div>

@endsection

@push ('after-scripts')

@endpush
