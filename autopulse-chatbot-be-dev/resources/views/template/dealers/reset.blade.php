@extends('layouts.front')
 
@section('content')

        <!-- Start Reset Password Area  -->
        <div class="signup-area rainbow-section-gapTop-big" data-black-overlay="2">
            <div class="sign-up-wrapper rainbow-section-gap">
                <div class="sign-up-box bg-flashlight">
                    <div class="signup-box-top top-flashlight light-xl">
                        <img src="{{ asset('assets/front/images/logo/boxed-logo.png') }}" alt="sign-up logo">
                    </div>
                    <div class="signup-box-bottom">
                        <div class="signup-box-content">
                            <h4 class="title">Reset Password</h4>
                            <form action="" id="resetform" > 
                                @csrf
                                <div class="input-section mail-section">
                                  
                                    <input type="hidden" name="token" value="{{ $token ?? '' }}" placeholder="Enter Your Name" autocomplete="off">
                                </div>
                                <div class="input-section mail-section">
                                    <div class="icon"><i class="feather-mail"></i></div>
                                    <input type="email" name="email" id="reset_email" class="required" placeholder="Enter email address">
                                </div>                                
                                <div class="input-section password-section">
                                    <div class="icon"><i class="feather-lock"></i></div>
                                    <input type="password" name="password" id="reset_password" class="required" placeholder="New Password" autocomplete="new-password">
                                </div>
                                <div class="input-section password-section">
                                    <div class="icon"><i class="feather-lock"></i></div>
                                    <input type="password" name="confirm_password" id="reset_confirm_password" class="required" placeholder="Confirm Password">
                                </div>
                                <button type="submit" id="reset_btn" class="rainbow-gradient-btn"><span>Change Password</span></button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- End Reset Password Area  -->

        <!-- Start Reset Password Modal  -->
        <div id="forgotPassConfModal" class="modal rbt-modal-box fade" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content wrapper top-flashlight leftside light-xl modal-small text-center">
                    <p class="b1 text-center mb--0">Your Request has been shared successfully.</p>
                    <div class="bottom-btn mt--20 w-100">
                        <button type="button" class="btn-default btn-small round" data-bs-dismiss="modal">OK</button>
                    </div>
                    <button class="close-button" data-bs-dismiss="modal">
                        <i class="feather-x"></i>
                    </button>
                </div>
            </div>
        </div>
        <!-- End Reset Password Modal  -->


<div id="chatbot-widget" data-user-id="4fe717fb-3031-4cba-acbd-fd55601e90d3"></div>
<script src="http://127.0.0.1:8000/assets/js/widget.js?userid_id=4fe717fb-3031-4cba-acbd-fd55601e90d3"></script>
@endsection
@push ('after-scripts')
<script>
    $('#reset_btn').click(function(e) {
    if ($('#resetform').valid()) {
        var url = '{{ route("dealerpassword.update") }}';
        var formData = $('#resetform').serialize();
        var originalText = $('#reset_btn span').text();

        // Show loading text and disable the button
        $('#reset_btn span').text('Please wait...');
        $('#reset_btn').prop('disabled', true);

        runajax(url, formData, 'post', '', 'json', function(output) {
            // Restore original button text and enable it
            $('#reset_btn span').text(originalText);
            $('#reset_btn').prop('disabled', false);

            if (output.success) {
                var data = output.data;
                $('.modal').modal('hide');
                $('#paswordsuccessfully').modal('show');
                window.location.href = '{{ route("dealer.profile") }}';
            } else {
                if (output.data.length === 0) {
                    var key = 'email';
                    var existvalue = $('#reset_' + key).val();

                    jQuery.validator.addMethod(key + "error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.message));

                    $('#reset_' + key).addClass(key + "error");
                    jQuery('#reset_' + key).valid();
                } else {
                    for (var key in output.data) {
                        var existvalue = $('#reset_' + key).val();

                        jQuery.validator.addMethod(key + "error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.data[key][0]));

                        $('#reset_' + key).addClass(key + "error");
                        jQuery('#reset_' + key).valid();
                    }
                }
            }
        });
    }
});


// $('#reset_btn').click(function(e){
//     //$('#phone_number').removeClass('phone_numbererror');
//     if($('#resetform').valid())
//     {    url = '{{ route("dealerpassword.update") }}';
//         var formData = $('#resetform').serialize();
//         var originalText = $('#reset_btn').text();
       
//             // Change the text of the button to indicate processing
//         $('#reset_btn span').text('Please wait...').prop('disabled', true);

//         runajax(url, formData, 'post', '', 'json', function(output) {
            
//             $('#reset_btn').text(originalText).prop('disabled', false);
//             if (output.success) 
//             {
                
//                 data  = output.data
//                 $('.modal').modal('hide');
//                 $('#paswordsuccessfully').modal('show');
//                 window.location.href ='{{ route("dealer.profile")}}';
               
//             }else{
//                 if (output.data.length === 0) {
//                     key = 'email'
//                     existvalue= $('#reset_'+key).val();
//                         jQuery.validator.addMethod(key+"error", function(value, element) {
//                             return this.optional(element) || value !== existvalue;
//                         }, jQuery.validator.format(output.message));
//                         $('#reset_'+key).addClass(key+"error");
//                         jQuery('#reset_'+key).valid();
//                 } else {
//                     for (var key in output.data){
                    
//                         existvalue= $('#reset_'+key).val();
//                         jQuery.validator.addMethod(key+"error", function(value, element) {
//                             return this.optional(element) || value !== existvalue;
//                         }, jQuery.validator.format(output.data[key][0]));
//                         $('#reset_'+key).addClass(key+"error");
//                         jQuery('#reset_'+key).valid();
//                     }
//                 }
                    
//             }
//         }); 
//     }
// })
</script>
@endpush