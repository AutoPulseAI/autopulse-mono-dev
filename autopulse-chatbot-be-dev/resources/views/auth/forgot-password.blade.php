@extends('layouts.guest')
 
@section('content')
<!-- Forgot Password -->
<section class="chatadmin_auth">
    <div class="chatadmin_signin">
        <div class="signin_logo">
            <img src="{{ asset('assets/images/auto/boxed-logo.png') }}" alt="img" class="img-fluid">
        </div>
        <div class="signin_form">
            <div class="signin_form_title">
                <h4>Forgot Password</h4>
                <!-- <p><small>{{ __('Forgot your password? No problem. Just let us know your email address and we will email you a password reset link that will allow you to choose a new one.') }}</small></p> -->
            </div>
            <div class="position-relative z-1">
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

                <form method="POST" action="{{ route('password.email') }}">
                    @csrf
                    <div class="position-relative mb-2">
                        <input id="email" type="email" placeholder="Enter email address" class="form-control @error('email') is-invalid @enderror" name="email" value="{{ old('email') }}" required autocomplete="email" autofocus>
                        @error('email')
                        <label id="my-error" class="invalid-feedback error">{{ $message }}</label>
                        @enderror
                    </div>
                    <div class="position-relative text-center mt-3">
                        <button type="submit" class="btn btn-theme"><span>{{ __('Reset Password') }}</span></button>
                    </div>
                </form>
            </div>
            <div class="signin_footer">
                <div class="signin_footer_text">Back to <a class="link_primary" href="{{route('admin.login') }}"><span>Sign In</span></a></div>
            </div>
        </div>
    </div>
</section>
@endsection

@push ('after-scripts')

@endpush
