@extends('layouts.guest')
 
@section('content')
<!-- Reset Password -->
<section class="position-relative chatboxauthAi d-flex align-items-center adminauth">
    <div class="chatboxauthAi_inn">
        <div class="container">
            <div class="row justify-content-center">
                <div class="col col-xl-4 col-lg-5 col-md-8 col-12 d-flex align-items-center" >      
                    <div class="position-relative w-100"> 
                        <!-- Logo   -->
                        <div class="authAi_auto_logo mb-5">
                            <img src="{{ asset('assets/images/auto/logo-w.png') }}" alt="img" class="mx-auto">
                        </div>

                        <!-- Reset Password -->
                        <div class="position-relative modal_right authscreen">
                            <div class="position-relative z-1">
                                <div class="position-relative text-center mb-3">
                                    <h3>Reset Password?</h3>
                                    <!-- <p>{{ __('Forgot your password? No problem. Just let us know your email address and we will email you a password reset link that will allow you to choose a new one.') }}</p> -->
                                </div>

                                @if (Session::has('status'))
                                <div class="alert alert-success alert-dismissible text-white" role="alert">
                                    <span class="text-sm">{{ Session::get('status') }}</span>
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
                                
                                <form method="POST" action="{{ route('password.store') }}">
                                    @csrf

                                    <!-- Password Reset Token -->
                                    <input type="hidden" name="token" value="{{ $request->route('token') }}">

                                    <div class="position-relative mb-2">
                                        <input id="email" type="email" class="form-control @error('email') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" name="email" value="{{ old('email', $request->email) }}" required autocomplete="email" autofocus>
                                        @error('email')
                                        <label id="my-error" class="invalid-feedback error">{{ $message }}</label>
                                        @enderror
                                    </div>
                                    <div class="position-relative mb-2">
                                        <input id="password" type="password" class="form-control @error('password') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" name="password" required autocomplete="new-password" autofocus>
                                        @error('password')
                                        <label id="my-error" class="invalid-feedback error">{{ $message }}</label>
                                        @enderror
                                    </div>
                                    <div class="position-relative mb-2">
                                        <input id="password_confirmation" type="password" class="form-control @error('password_confirmation') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" name="password_confirmation" required autocomplete="new-password" autofocus>
                                        @error('password_confirmation')
                                        <label id="my-error" class="invalid-feedback error">{{ $message }}</label>
                                        @enderror
                                    </div>

                                    <div class="position-relative  mb-2">
                                        <button type="submit" class="btn btn_theme w-100">{{ __('Reset Password') }}</button>
                                    </div>                            
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>

@endsection

@push ('after-scripts')

@endpush

