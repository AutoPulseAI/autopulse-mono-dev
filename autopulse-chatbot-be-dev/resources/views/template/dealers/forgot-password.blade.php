<!-- resources/views/child.blade.php -->
 
@extends('layouts.front')
 
@section('content')
        <!-- Start Header  -->
        @include('template.dealers.include.header')
        <!-- End Header  -->

        <!-- start mobilemenu -->
        @include('template.dealers.include.mobilemenu')
        <!-- End mobilemenu -->

        <!-- Start Forgot Password Area  -->
        <div class="signup-area rainbow-section-gapTop-big" data-black-overlay="2">
            <div class="sign-up-wrapper rainbow-section-gap">
                <div class="sign-up-box bg-flashlight">
                    <div class="signup-box-top top-flashlight light-xl">
                        <img src="{{ asset('assets/front/images/logo/boxed-logo.png') }}" alt="sign-up logo">
                    </div>
                    <div class="signup-box-bottom">
                        <div class="signup-box-content">
                            <h4 class="title">Forgot Password</h4>
                            <form action="" id="forgetpassword"> 
                                @csrf
                                <div class="input-section mail-section">
                                    <div class="icon"><i class="feather-mail"></i></div>
                                    <input type="email" name="email" id="forgot_email" class="required" placeholder="Enter email address">
                                </div>           
                                <button type="button" id="forgetpasswordbtn" class="rainbow-gradient-btn"><span>Reset Password</span></button>
                            </form>
                        </div>
                        <div class="signup-box-footer">
                            <div class="bottom-text">
                                If you have an account <a class="btn-read-more" href="{{route('dealer.login') }}"><span>Sign In</span></a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- End Forgot Password Area  -->

        <!-- Start Footer Area  -->
        @include('template.dealers.include.footer')
        <!-- End Footer Area  -->

        <!-- Start Copy Right Area  -->
        @include('template.dealers.include.copyRight')
        <!-- End Copy Right Area  -->

        <!-- Start Forgot Password Modal  -->
        <div id="forgotPassConfModal" class="modal rbt-modal-box fade" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content wrapper top-flashlight leftside light-xl modal-small text-center">
                    <p class="b1 text-center mb--0">Your reset password link has been shared to your registered email address. Please check your inbox.</p>
                    <div class="bottom-btn mt--20 w-100">
                        <button type="button" class="btn-default btn-small round" data-bs-dismiss="modal">OK</button>
                    </div>
                    <button class="close-button" data-bs-dismiss="modal">
                        <i class="feather-x"></i>
                    </button>
                </div>
            </div>
        </div>
        <!-- End Forgot Password Modal  -->

@endsection

@push ('after-scripts')
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-validate/1.19.3/jquery.validate.min.js" integrity="sha512-37T7leoNS06R80c8Ulq7cdCDU5MNQBwlYoy1TX/WUsLFC2eYNqtKlV0QjH7r8JpG/S0GUMZwebnVFLPd6SU5yg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script>
// Forgot Password
$('#forgetpasswordbtn').click(function(e) {
    if ($('#forgetpassword').valid()) {
        var url = '{{ route("dealerforgotPassword") }}';
        var formData = $('#forgetpassword').serialize();
        var originalText = $('#forgetpasswordbtn span').text();

        // Set loading text and disable the button
        $('#forgetpasswordbtn span').text('Please wait...');
        $('#forgetpasswordbtn').prop('disabled', true);

        runajax(url, formData, 'post', '', 'json', function(output) {

            // Restore original button text and enable it
            $('#forgetpasswordbtn span').text(originalText);
            $('#forgetpasswordbtn').prop('disabled', false);

            if (output.success) {
                var data = output.data;
                $('#forgotPassModal').modal('hide');
                $('#forgotPassConfModal').modal('show');
            } else {
                if (output.data.length === 0) {
                    var key = 'forgot_email';
                    var existvalue = $('#forgot_email').val();

                    jQuery.validator.addMethod(key + "error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.message));

                    $('#' + key).addClass(key + "error");
                    jQuery('#' + key).valid();
                } else {
                    for (var key in output.data) {
                        var existvalue = $('#reset_' + key).val();

                        jQuery.validator.addMethod(key + "error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.data[key][0]));

                        $('#reg_' + key).addClass(key + "error");
                        jQuery('#reg_' + key).valid();
                    }
                }
            }
        });
    }
});


// $('#forgetpasswordbtn').click(function(e){
//     //$('#phone_number').removeClass('phone_numbererror');
//     if($('#forgetpassword').valid())
//     {    url = '{{ route("dealerforgotPassword") }}';
//         var formData = $('#forgetpassword').serialize();
//         var originalText = $('#forgetpasswordbtn').text();
       
//             // Change the text of the button to indicate processing
//         $('#forgetpasswordbtn').text('Please wait...').prop('disabled', true);

//         runajax(url, formData, 'post', '', 'json', function(output) {
            
//             $('#forgetpasswordbtn').text(originalText).prop('disabled', false);
//             if (output.success) 
//             {
//                 data  = output.data
                
//                 $('#forgotPassModal').modal('hide');
//                 $('#forgotPassConfModal').modal('show');
                
//             }else{
//                 if (output.data.length === 0) {
//                     //key = 'phone_number'
//                     key ='forgot_email'
//                     existvalue= $('#forgot_email').val();
//                         jQuery.validator.addMethod(key+"error", function(value, element) {
//                             return this.optional(element) || value !== existvalue;
//                         }, jQuery.validator.format(output.message));
//                         $('#'+key).addClass(key+"error");
//                         jQuery('#'+key).valid();
//                 } else {
//                     for (var key in output.data){
                    
//                         existvalue= $('#reset_'+key).val();
//                         jQuery.validator.addMethod(key+"error", function(value, element) {
//                             return this.optional(element) || value !== existvalue;
//                         }, jQuery.validator.format(output.data[key][0]));
//                         $('#reg_'+key).addClass(key+"error");
//                         jQuery('#reg_'+key).valid();
//                     }
//                 }
                    
//             }
//         }); 
//     }
// });
</script>
@endpush