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
            <div class="sign-up-wrapper rainbow-section-gap pt--0">
                <div class="position-relative">
                    <h5 class="title">Step 1</h5>
                    <div class="sign-up-box bg-flashlight">
                        <div class="signup-box-top top-flashlight light-xl">
                            <img src="{{ asset('assets/front/images/logo/boxed-logo.png') }}" alt="sign-up logo">
                        </div>
                        <div class="signup-box-bottom">
                            <div class="signup-box-content">
                                <h4 class="title">Welcome</h4>

                                <form action="" id="register"> 
                                    @csrf
                                    <div class="input-section mail-section">
                                        <div class="icon"><i class="feather-user"></i></div>
                                        <input type="text" name="name" id="reg_name" placeholder="Enter Your Name" autocomplete="off">
                                    </div>
                                    <div class="input-section mail-section">
                                        <div class="icon"><i class="feather-mail"></i></div>
                                        <input type="text" name="phone_number" id="reg_phone_number" class="required digit" maxlength ="10" placeholder="Enter contact number">
                                    </div>
                                    <div class="input-section mail-section">
                                        <div class="icon"><i class="feather-mail"></i></div>
                                        <input type="email" name="email" id="reg_email" class="required" placeholder="Enter email address">
                                    </div>                                
                                    <div class="input-section password-section">
                                        <div class="icon"><i class="feather-lock"></i></div>
                                        <input type="password" name="password" id="reg_password" class="required" placeholder="Create Password" autocomplete="new-password">
                                    </div>
                                    <div class="input-section password-section">
                                        <div class="icon"><i class="feather-lock"></i></div>
                                        <input type="password" name="confirm_password" id="reg_confirm_password" class="required" placeholder="Confirm Password">
                                    </div>
                                    <button type="submit" id="register_button" class="rainbow-gradient-btn"><span>Sign Up</span></button>
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

<script>
// Register
$('#register_button').click(function(e) {
    if ($('#register').valid()) {
        var url = '{{ route("dealerregister") }}';
        var formData = $('#register').serialize();
        var originalText = $('#register_button span').text();

        // Update span text and disable the button (not the span)
        $('#register_button span').text('Please wait...');
        $('#register_button').prop('disabled', true);

        runajax(url, formData, 'post', '', 'json', function(output) {
            // Restore original span text and enable the button
            $('#register_button span').text(originalText);
            $('#register_button').prop('disabled', false);

            if (output.success) {
                var data = output.data;

                $('.modal').modal('hide');
                $('#registerConfModal').modal('show');

                window.location.href = '{{ route("dealer.chat.index") }}';
            } else {
                if (output.data.length === 0) {
                    var key = 'phone_number'; // You had this commented out
                    var existvalue = $('#reg_' + key).val();

                    jQuery.validator.addMethod(key + "error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.message));

                    $('#reg_' + key).addClass(key + "error");
                    jQuery('#reg_' + key).valid();
                } else {
                    for (var key in output.data) {
                        var existvalue = $('#reg_' + key).val();

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


// $('#register_button').click(function(e){
//     //$('#phone_number').removeClass('phone_numbererror');
//     if($('#register').valid())
//     {    url = '{{ route("dealerregister") }}';
//         var formData = $('#register').serialize();
//         var originalText = $('#register_button').text();
       
//             // Change the text of the button to indicate processing
//         $('#register_button span').text('Please wait...').prop('disabled', true);

//         runajax(url, formData, 'post', '', 'json', function(output) {
            
//             $('#register_button').text(originalText).prop('disabled', false);
//             if (output.success) 
//             {
//                 data  = output.data
                
//                 $('.modal').modal('hide');
               
//                 $('#registerConfModal').modal('show');
//                 window.location.href ='{{ route("dealer.chat.index")}}';
               
                
//             }else{
//                 if (output.data.length === 0) {
//                     //key = 'phone_number'
//                     existvalue= $('#reg_'+key).val();
//                         jQuery.validator.addMethod(key+"error", function(value, element) {
//                             return this.optional(element) || value !== existvalue;
//                         }, jQuery.validator.format(output.message));
//                         $('#'+key).addClass(key+"error");
//                         jQuery('#'+key).valid();
//                 } else {
//                     for (var key in output.data){
                    
//                         existvalue= $('#reg_'+key).val();
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
// })
</script>
@endpush