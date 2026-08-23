<!-- resources/views/child.blade.php -->
 
@extends('layouts.front')
 
@section('content')
        <!-- Start Header  -->
        @include('template.dealers.include.header')
        <!-- End Header  -->

        <!-- start mobilemenu -->
        @include('template.dealers.include.mobilemenu')
        <!-- End mobilemenu -->

        <!-- Start Sign up Area  -->
        <div class="signup-area rainbow-section-gapTop-big" data-black-overlay="2">
            <div class="sign-up-wrapper rainbow-section-gap">
                <div class="sign-up-box bg-flashlight">
                    <div class="signup-box-top top-flashlight light-xl">
                        <img src="{{ asset('assets/front/images/logo/boxed-logo.png') }}" alt="sign-up logo">
                    </div>
                    <div class="signup-box-bottom">
                        <div class="signup-box-content">
                            <h4 class="title">Welcome Back!</h4>
                            <form action="" id="login" >
                                @csrf
                                <div class="input-section mail-section">
                                    <div class="icon"><i class="feather-mail"></i></div>
                                    <input name="email" type="text" id="email" class="required email" placeholder="Enter email address">
                                </div>
                                <div class="input-section password-section">
                                    <div class="icon"><i class="feather-lock"></i></div>
                                    <input type="password" name="password" id="passwordInput" class="required" placeholder="Password">
                                    <div class="togglePassword hidden" id="togglePassword">Show</div>
                                </div>
                                <div class="row align-items-center">
                                    <div class="col col-6">
                                        <div class="input-section">
                                            <div class="form-check text-start ps-0">
                                                <input class="form-check-input" type="checkbox" value="" id="flexCheckDefault">
                                                <label class="form-check-label" for="flexCheckDefault">Remember me</label>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col col-6">
                                        <div class="forget-text"><a class="btn-read-more" href="{{route('dealer.forgot-password') }}"><span>Forgot password</span></a></div>
                                    </div>
                                </div>
                                
                                <button type="submit" id="loginbtn" class="rainbow-gradient-btn"><span>Sign In</span></button>
                            </form>
                        </div>
                        <div class="signup-box-footer">
                            <div class="bottom-text">
                                Don't have an account? <a class="btn-read-more" href="{{route('dealer.signup') }}"><span>Sign Up</span></a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- End Sign up Area  -->

        <!-- Start Footer Area  -->
        @include('template.dealers.include.footer')
        <!-- End Footer Area  -->

        <!-- Start Copy Right Area  -->
        @include('template.dealers.include.copyRight')
        <!-- End Copy Right Area  -->

@endsection

@push ('after-scripts')
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-validate/1.19.3/jquery.validate.min.js" integrity="sha512-37T7leoNS06R80c8Ulq7cdCDU5MNQBwlYoy1TX/WUsLFC2eYNqtKlV0QjH7r8JpG/S0GUMZwebnVFLPd6SU5yg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script>
// Login
$('#loginbtn').click(function(e) {
    if ($('#login').valid()) {
        var url = '{{ route("dealerlogin") }}';
        var formData = $('#login').serialize();
        var originalText = $('#loginbtn span').text(); // Get text from span

        // Set loading text and disable the button
        $('#loginbtn span').text('Please wait...');
        $('#loginbtn').prop('disabled', true);

        runajax(url, formData, 'post', '', 'json', function(output) {
            // Restore original text and enable the button
            $('#loginbtn span').text(originalText);
            $('#loginbtn').prop('disabled', false);

            if (output.success) {
                var data = output.data;
                window.location.href = '{{ route("dealer.chat.index") }}';
            } else {
                if (output.data.length === 0) {
                    var key = 'passwordInput';
                    var existvalue = $('#' + key).val();

                    jQuery.validator.addMethod(key + "error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.message));

                    $('#' + key).addClass(key + "error");
                    jQuery('#' + key).valid();
                } else {
                    if (output.data.length === 0) {
                        $('#my-error').html(output.message);
                        $('#my-error').show();
                    } else {
                        for (var key in output.data) {
                            var existvalue = $('#' + key).val();

                            jQuery.validator.addMethod(key + "error", function(value, element) {
                                return this.optional(element) || value !== existvalue;
                            }, jQuery.validator.format(output.data[key][0]));

                            $('#' + key).addClass(key + "error");
                            jQuery('#' + key).valid();
                        }
                    }
                }
            }
        });
    }
});


// $('#loginbtn').click(function(e){
//     if($('#login').valid())
//     {    url = '{{ route("dealerlogin") }}';
//         var formData = $('#login').serialize();
//         var originalText = $('#loginbtn').text();
       
          
//         $('#loginbtn span').text('Please wait...').prop('disabled', true);

//         runajax(url, formData, 'post', '', 'json', function(output) {
            
//             $('#loginbtn').text(originalText).prop('disabled', false);
//             if (output.success) 
//             {
                
//                 data  = output.data
              
//                 window.location.href ='{{ route("dealer.chat.index")}}';
                
//             }else{
//                 if (output.data.length === 0) {
//                     key = 'passwordInput'
//                     existvalue= $('#'+key).val();
//                         jQuery.validator.addMethod(key+"error", function(value, element) {
//                             return this.optional(element) || value !== existvalue;
//                         }, jQuery.validator.format(output.message));
//                         $('#'+key).addClass(key+"error");
//                         jQuery('#'+key).valid();
//                 } else {
//                     if (output.data.length === 0) {
                        
//                         $('#my-error').html(output.message);
//                         $('#my-error').show();
                        
//                     } else {
//                         for (var key in output.data){
                        
//                             existvalue= $('#'+key).val();
//                             jQuery.validator.addMethod(key+"error", function(value, element) {
//                                 return this.optional(element) || value !== existvalue;
//                             }, jQuery.validator.format(output.data[key][0]));
//                             $('#'+key).addClass(key+"error");
//                             jQuery('#'+key).valid();
//                         }
//                     }
//                 }
                    
//             }
//         }); 
//     }
// });

// Toggle Password
document.addEventListener('DOMContentLoaded', function () {
    const togglePassword = document.querySelector('#togglePassword');
    const passwordInput = document.querySelector('#passwordInput');

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