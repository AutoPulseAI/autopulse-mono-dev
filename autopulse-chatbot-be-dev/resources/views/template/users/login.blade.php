<!-- resources/views/child.blade.php -->
 
@extends('layouts.app')
 
@section('content')
<section class="auth_main h-100">
    <div class="row g-0 h-100">
        
        <div class="col col-lg-6 col-12">
            <div class="position-relative d-flex align-items-center auth_right">
                <div class="position-relative text-center auth_right_form">
                    
                    <h5>Log in to your account</h5>
                    <div class="position-relative auth_login_form loginform">
                        <form id="login" method="post">
                            @csrf
                            <div class="mb-3">
                                <input name="phone_number" id="phone_number" type="text"  class="form-control form-control-lg required" placeholder="Enter Phone Number">
                            </div>
                                <button type="button" id="loginbtn" class="btn btn_theme btn-lg">Get Login Code</button> 
                            
                        </form>

                        <div class="login_or"><p><span>Or</span></p></div>

                       
                    </div>
                    <div class="position-relative auth_login_form otpform" style="display:none;">
                        <form id="otpform"> 
                            @csrf
                            <div class="mb-3 " >
                                <input type="text" maxlength="6" name="otp" id ="otp" class="required form-control form-control-lg" placeholder="_" />
                                <input type="hidden" name="phone_number" id="phone_number_added" />
                                
                            </div>
                            <button type="button" id="verify"class="btn btn_theme btn-lg">Verify</button>
                            
                        </form>

                        <div class="position-relative resend_otp">
                            <a href="javascript::" onclick="resend()">Resend OTP</a>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    </div>
</section>
@endsection

@push ('after-scripts')
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-validate/1.19.3/jquery.validate.min.js" integrity="sha512-37T7leoNS06R80c8Ulq7cdCDU5MNQBwlYoy1TX/WUsLFC2eYNqtKlV0QjH7r8JpG/S0GUMZwebnVFLPd6SU5yg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script>

function resend(){
    $('#loginbtn').trigger('click');
}  
$('#loginbtn').click(function(e){
       
       if($('#login').valid())
       {    url = '{{ route("generateOtp") }}';
            var formData = $('#login').serialize();
            runajax(url, formData, 'post', '', 'json', function(output) {
              
              
                if (output.success) 
                {
                    $('#phone_number_added').val($('#phone_number').val());
                    $('.otpform').show();
                    $('.loginform').hide();
                    
                }else{
                    
                    for (var key in output.data){
                    
                        existvalue= $('#'+key).val();
                        jQuery.validator.addMethod(key+"error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.data[key][0]));
                        $('#'+key).addClass(key+"error");
                        jQuery('#'+key).valid();
                    }
                        
                }
            }); 
        }
    })
    $('#verify').click(function(e){
       
       if($('#otpform').valid())
       {    url = '{{ route("validateOtp") }}';
            var formData = $('#otpform').serialize();
            runajax(url, formData, 'post', '', 'json', function(output) {
              
              
                if (output.success) 
                {
                  
                    window.location.href="{{route('dashboard')}}"
                    
                }else{
                    
                   // for (var key in output.data){
                        key ="otp";
                        existvalue= $('#otp').val();
                        jQuery.validator.addMethod(key+"error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.message));
                        $('#'+key).addClass(key+"error");
                        jQuery('#'+key).valid();
                    //}
                        
                }
            }); 
        }
    })
</script>
@endpush