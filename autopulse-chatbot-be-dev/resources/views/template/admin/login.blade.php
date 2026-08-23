@extends('layouts.guest')
 
@section('content')
<!-- Login -->
<section class="chatadmin_auth">
    <div class="chatadmin_signin">
        <div class="signin_logo">
            <img src="{{ asset('assets/images/auto/boxed-logo.png') }}" alt="img" class="img-fluid">
        </div>
        <div class="signin_form">
            <div class="signin_form_title">
                <h4>Login</h4>
            </div>
            <div class="position-relative z-1">
                @if (Session::has('status'))
                <div class="alert alert-success alert-dismissible text-white mb-3" role="alert">
                    <span class="text-sm">{{ Session::get('status') }}</span>
                    <button type="button" class="btn-close text-lg py-3 opacity-10"
                        data-bs-dismiss="alert" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                @elseif (Session::has('email'))
                <div class="alert alert-danger alert-dismissible text-white mb-3" role="alert">
                    <span class="text-sm">{{ Session::get('email') }}</span>
                    <button type="button" class="btn-close text-lg py-3 opacity-10"
                        data-bs-dismiss="alert" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                @endif

                <form method="POST" action="{{ route('admin.submitLogin') }}">
                    @csrf

                    <div class="position-relative mb-2">
                        <input id="email" type="email" placeholder="Enter username" class="form-control @error('email') is-invalid @enderror" name="email" value="{{ old('email') }}" required autocomplete="email" autofocus>
                        @error('email')
                        <label id="my-error" class="invalid-feedback error">{{ $message }}</label>
                        @enderror
                    </div>
                    <div class="position-relative mb-2">
                        <div class="togglePassword hidden" id="togglePassword">Show</div>
                        <input id="password" type="password" placeholder="Enter password" class="form-control @error('password') is-invalid @enderror" name="password" required autocomplete="current-password">
                        @error('password')
                            <label id="my-error" class="error invalid-feedback">{{ $message }}</label>
                        @enderror
                    </div>
                    <div class="forget_text">
                        <a class="link_primary" href="{{ route('password.request') }}">Forgot Password</a>
                    </div>
                    <div class="position-relative text-center">
                        <button type="submit" class="btn btn-theme"><span>{{ __('Login') }}</span></button>
                    </div>
                </form>
            </div>
        </div>
    </div>
</section>
@endsection

@push ('after-scripts')
<script>
    document.addEventListener('DOMContentLoaded', function () {
        const togglePassword = document.querySelector('#togglePassword');
        const passwordInput = document.querySelector('#password');

        if (togglePassword && passwordInput) {
            togglePassword.addEventListener('click', function (e) {
            // toggle the type attribute
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            // toggle text
            this.textContent = type === 'password' ? 'Show' : 'Hide';
            });
        }
    });
</script>

@endpush
