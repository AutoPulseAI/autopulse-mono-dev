@extends('layouts.admin')
 
@section('content')
<div class="position-relative min-h-100 main_bg min_h_100">
    
    <div class="container-xxl container-fluid">
        <div class="broadcasts_section mx-md-3">
            <div class="row">
                <div class="col col-12">
                    <!-- Page Heading -->
                    <div class="broadcasts_head mb-3">
                        <div class="position-relative me-auto">
                            <h3>Edit Profile</h3>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row mb-2">
            <div class="col">
                <nav aria-label="breadcrumb" class="bg-body-tertiary rounded-3">
                <ol class="breadcrumb mb-0">
                    <li class="breadcrumb-item"><a href="{{route('admin.dashboard')}}">Dashboard</a></li>
                    <li class="breadcrumb-item"><a href="{{route('admin.profile')}}">User Profile</a></li>
                    <li class="breadcrumb-item active" aria-current="page">Edit Profile</li>
                </ol>
                </nav>
            </div>
            </div>

            <div class="row">
                <!-- Profile Update -->
                <div class="col col-lg-12 col-12 bg-light">
                    <div class="p-4 sm:p-8 bg-white dark:bg-gray-800 bg-white shadow-sm rounded p-3">

                        <section>

                            @if (Session::has('profile'))
                            <div class="alert alert-success alert-dismissible text-white" role="alert">
                                <span class="text-sm">{{ Session::get('profile') }}</span>
                                <button type="button" class="btn-close text-lg py-3 opacity-10"
                                    data-bs-dismiss="alert" aria-label="Close">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>
                            @elseif (Session::has('email'))
                            <div class="alert alert-danger alert-dismissible text-white" role="alert">
                                <span class="text-sm">{{ Session::get('email') }}</span>
                                <button type="button" class="btn-close text-lg py-3 opacity-10"
                                    data-bs-dismiss="alert" aria-label="Close">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>
                            @endif

                            <form method="POST" action="{{ route('admin.updateProfile') }}" enctype="multipart/form-data">
                                @csrf
                                <div class="row">

                                <header class="p-3">
                                    <h5 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                                        Profile Information
                                    </h5>

                                    <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                        Update your account's profile information and email address.
                                    </p>
                                </header>

                                <div class="col col-lg-6 col-md-6 col-12 p-3">
                                
                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="name">
                                    First Name
                                    </label>
                                    <input id="name" type="text" class="form-control @error('name') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" name="name" value="{{ old('name',$user['name']) }}" required autocomplete="name" autofocus>
                                    @error('name')
                                        <span class="invalid-feedback" role="alert">
                                            <strong>{{ $message }}</strong>
                                        </span>
                                    @enderror
                                </div>


                                <div class="col col-lg-6 col-md-6 col-12 p-3">
                                
                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="profile_pic">
                                    Profile Picture
                                    </label>
                                    <input id="profile_pic" type="file" class="form-control @error('profile_pic') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" 
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

                                <div class="col col-lg-6 col-md-6 col-12 p-3">
                                
                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="email">
                                    Email
                                    </label>
                                    <input id="email" type="email" class="form-control @error('email') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" 
                                    name="email" value="{{ old('email',$user['email']) }}" required autocomplete="email" autofocus>
                                    @error('email')
                                        <span class="invalid-feedback" role="alert">
                                            <strong>{{ $message }}</strong>
                                        </span>
                                    @enderror
                                </div>


                                <div class="d-flex justify-content-between mt-4">

                                    <button type="submit" class="btn btn-primary">
                                        {{ __('Save') }}
                                    </button>

                                </div>
                            </div>

                            </form>

                        </section>

                    </div>
                </div>

            </div>


            <div class="row mt-4">
                <!-- Profile Update -->
                <div class="col col-lg-12 col-12 bg-light">
                    <div class="p-4 sm:p-8 bg-white dark:bg-gray-800 bg-white shadow-sm rounded p-3">

                        <section>

                            @if (Session::has('password'))
                            <div class="alert alert-success alert-dismissible text-white" role="alert">
                                <span class="text-sm">{{ Session::get('password') }}</span>
                                <button type="button" class="btn-close text-lg py-3 opacity-10"
                                    data-bs-dismiss="alert" aria-label="Close">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>
                            @endif

                            <form method="POST" action="{{ route('admin.updatePassword') }}" enctype="multipart/form-data">
                                @csrf
                                <div class="row">

                                <header class="p-3">
                                    <h5 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                                        Update Password
                                    </h5>

                                    <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                        Ensure your account is using a long, random password to stay secure.
                                    </p>
                                </header>


                                <div class="col col-lg-6 col-md-6 col-12 p-3 ">
                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="current_password">
                                    Current Password
                                    </label>
                                    <input id="current_password" type="password" class="form-control @error('current_password') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" 
                                    name="current_password" value="{{ old('current_password') }}" autocomplete="current-password">
                                    @error('current_password')
                                        <span class="invalid-feedback" role="alert">
                                            <strong>{{ $message }}</strong>
                                        </span>
                                    @enderror
                                </div>

                                <div class="col col-lg-6 col-md-6 col-12 p-3 ">
                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="new_password">
                                    New Password
                                    </label>
                                    <input id="new_password" type="password" class="form-control @error('new_password') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" 
                                    name="new_password" value="{{ old('new_password') }}" autocomplete="current-password">
                                    @error('new_password')
                                        <span class="invalid-feedback" role="alert">
                                            <strong>{{ $message }}</strong>
                                        </span>
                                    @enderror
                                </div>

                                <div class="col col-lg-6 col-md-6 col-12 p-3">
                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="confirm_password">
                                    Confirm New Password
                                    </label>
                                    <input id="confirm_password" type="password" class="form-control @error('confirm_password') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" 
                                    name="confirm_password" value="{{ old('confirm_password') }}" autocomplete="current-password">
                                    @error('confirm_password')
                                        <span class="invalid-feedback" role="alert">
                                            <strong>{{ $message }}</strong>
                                        </span>
                                    @enderror
                                </div>


                                <div class="d-flex justify-content-between mt-4">

                                    <button type="submit" class="btn btn-primary">
                                        {{ __('Save') }}
                                    </button>

                                </div>
                            </div>

                            </form>

                        </section>

                    </div>
                </div>

            </div>


        </div>
    </div>
    
</div>
@endsection

@push ('after-scripts')

@endpush
