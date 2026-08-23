<!-- User Login Modal -->
<div class="modal fade" id="userLoginModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-lg">
    <div class="modal-content">
      <div class="modal-body">
        <div class="position-relative">
            <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

            <div class="row">
                <div class="col col-lg-5 col-12">
                    <div class="modal_left h-100">
                        <img src="{{asset('assets/images/login_image.png') }}" alt="Image" class="img-fluid">
                    </div>
                </div>
                <div class="col col-lg-7 col-12 d-flex align-items-center" id="loginscreen">
                    <!--<div class="position-relative modal_right">
                        <h3>Save time-Create your one-time passcode</h3>
                        
                         <p>You will receive the OTP via automated voice call on your mobile. </p>

                       

                        <form id="login" >
                            @csrf
                            <div class="position-relative d-flex">
                                <select name="dial_code" id="dial_code" class="form-select country_code">
                                    @foreach(config('constants.COUNTRY_CODE') as $country)
                                        <option value="+{{ $country['code'] }}"> {{ $country['name'] }} (+{{ $country['code'] }}) </option>
                                    @endforeach
                                   
                                </select>
                                <input name="phone_number" id="phone_number" type="text"  class="form-control required" placeholder="Enter Phone Number">
                            </div>
                            <label id="phone_number-error" class="error" for="phone_number"></label>
                            <div class="position-relative">
                                <button type="button"  id="loginbtn"  class="btn btn_theme w-100"  >Send OTP</button>
                            </div> 
                              
                            
                        </form>
                                                    
                     

                        <div class="position-relative agree_text text-center">
                            <p class="mb-0 text_secondary"><small>By continuing I agree with the <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>,&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></p>
                        </div>
                    </div>-->
                    <div class="position-relative modal_right">
                        <h3>Join Autopulse - Shop & Search vehicles FREE (Forever!) with Automotive AI!</h3>
                        <p>Use our AI-powered platform to find your dream car & save your local favorites.</p>

                        <form action="" id="login" >
                            @csrf
                            <div class="position-relative">
                                <input name="email" id="email" type="text"  class="form-control required email" placeholder="Email">
                            </div>
                            <div class="position-relative">
                                <button class="btn border-0 position-absolute end-0 top-0 px-3 link-primary" type="button" id="togglePassword">Show</button>
                                <input type="password" id="passwordInput" name="password" class="form-control required" id="passwordInput" placeholder="Password">
                                <label id="my-error" class="error" style=""></label>
                            </div>
                            <div class="position-relative d-flex align-items-center justify-content-between mb-3">
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" value="" id="defaultCheck1">
                                    <label class="form-check-label" for="defaultCheck1"><small>Keep me signed in</small></label>
                                </div>
                                <a class="link-primary" data-bs-toggle="modal" data-bs-target="#forgotPassModal" data-bs-dismiss="modal"><small>Forgot your password</small></a>
                            </div>
                            <div class="position-relative">
                                <button type="button"  id="loginbtn"  class="btn btn_theme w-100"  >Login</button>
                                <!--button type="submit" class="btn btn_theme w-100" >Login</button-->
                            </div>                            
                        </form>

                        <div class="position-relative auth_ortext text-center">
                            <p class="mb-0 text_secondary"><small>Quick login via options below</small></p>
                        </div>

                        <div class="position-relative auth_sociallinks">
                            <a href="{{ route('social.redirect','google') }}" class="btn w-100 mb-2"><img src="{{ asset('assets/images/social/google.png') }}" alt=""><span>Continue with Google</span></a>
                            <a href="{{ route('social.redirect','linkedin-openid') }}" class="btn w-100 mb-2"><img src="{{ asset('assets/images/social/li.png') }}" alt=""><span>Continue with LinkedIn</span></a>
                            <!--a href="{{ route('social.redirect','facebook') }}" class="btn w-100 mb-2"><img src="{{ asset('assets/images/social/fb.png') }}" alt=""><span>Continue with Facebook</span></a-->
                        </div>
                        <div class="position-relative text-center">
                            <p class="my-3"><span class="text_secondary">Do not have an account?</span>&nbsp;<a class="link-primary" data-bs-target="#RegisterModal" data-bs-toggle="modal" data-bs-dismiss="modal">Sign Up</a></p>
                        </div>
                        <div class="position-relative agree_text text-center">
                            <p class="mb-0 text_secondary"><small>By continuing, you agree to our <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>&nbsp;and&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></p>
                        </div>
                    </div>
                    
                </div>
                <div class="col col-lg-7 col-12 d-flex align-items-center" id="otpscreen" style="display:none !important;">
                    <div class="position-relative modal_right">
                        <h3>Save time-Create your one-time passcode</h3>
                        <p id="otpmsg">OTP has been sent to +0-0000000000</p>

                        <!-- <form action=""> -->

                        <form id="otpform"> 
                            @csrf
                            <div  class="position-relative" >
                                <input type="text" maxlength="6" name="otp" id ="otp" class="required form-control " placeholder="Enter OTP" />
                                <input type="hidden" name="phone_number" id="phone_number_added" />
                                <input type="hidden" name="dial_code" id="dial_code_hidden" />
                            </div>
                            <div class="resend_otp">
                                <a href="javascript:;" onclick="resend()" id="resendbtn" class="disabled">Resend OTP</a>
                                <span id="timer">00:20</span>
                            </div>
                            <div class="position-relative">
                                <button type="button" id="verify" class="btn btn_theme w-100"  >Verify OTP</button>
                            </div> 
                          
                            
                        </form>
                           

                                                      
                        <!-- </form> -->

                        <div class="position-relative agree_text text-center">
                            <p class="mb-0 text_secondary"><small>By continuing, you agree to our <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>&nbsp;and&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></p>
                        </div>
                    </div>
                </div>
               
                
            </div>

        </div>
      </div>
    </div>
  </div>
</div>

<div class="modal fade" id="forgotPassModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
        <div class="modal-body">
            <div class="position-relative">
                <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                <div class="row">
                    <div class="col col-lg-5 col-12">
                        <div class="modal_left h-100">
                            <img src="{{ asset('assets/images/login_image.png') }}" alt="Image" class="img-fluid">
                        </div>
                    </div>
                    <div class="col col-lg-7 col-12 d-flex align-items-center">
                        <div class="position-relative modal_right">
                            <h3>Forgot Your Password?</h3>
                            <p>Please enter your email address to send a link to reset your password</p>

                            <form action="" id="forgetpassword">
                                @csrf
                                <div class="position-relative">
                                    <input  type="text" name="email" id="reset_email"class="form-control" placeholder="Enter Your Email ID">
                                </div>
                                <div class="position-relative">
                                    <button type="button" id="forgetpasswordbtn" class="btn btn_theme w-100 mt-3" >Reset password</button>
                                </div>                            
                            </form>

                            <div class="position-relative text-center">
                                <p class="my-3"><a class="link-primary" data-bs-target="#userLoginModal" data-bs-toggle="modal" data-bs-dismiss="modal">Back to Login</a></p>
                            </div>

                            <div class="position-relative agree_text text-center">
                                <p class="mb-0 text_secondary"><small>By continuing, you agree to our <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>&nbsp;and&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></p>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
        </div>
    </div>
</div>

<!-- User Confirmation Forgot Modal -->
<div class="modal fade" id="forgotPassConfModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
        <div class="modal-body">
            <div class="position-relative">
                <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                <div class="row">
                    <div class="col col-lg-4 col-12">
                        <div class="modal_left h-100">
                            <img src="{{ asset('assets/images/login_image.png') }}" alt="Image" class="img-fluid">
                        </div>
                    </div>
                    <div class="col col-lg-8 col-12 d-flex align-items-center">
                        <div class="position-relative modal_right text-center">
                            <div class="conf_check">
                                <img src="{{ asset('assets/images/check.png') }}" alt="check">
                            </div>
                            <h3 class="text_primary">Link to reset your password has been sent to your email!</h3>
                            <div class="position-relative">
                                <p class="my-3"><a class="link-primary" href="javascript:;" onclick="forget()">Did not receive the password reset link?</a></p>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
        </div>
    </div>
</div>


<div class="modal fade" id="paswordsuccessfully" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
        <div class="modal-body">
            <div class="position-relative">
                <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                <div class="row">
                    <div class="col col-lg-4 col-12">
                        <div class="modal_left h-100">
                            <img src="{{ asset('assets/images/login_image.png') }}" alt="Image" class="img-fluid">
                        </div>
                    </div>
                    <div class="col col-lg-8 col-12 d-flex align-items-center">
                        <div class="position-relative modal_right text-center">
                            <div class="conf_check">
                                <img src="{{ asset('assets/images/check.png') }}" alt="check">
                            </div>
                            @php
                                $intendedUrl = session('url.intended', '/dashboard');
                            @endphp
                            <h3 class="text_primary">Your Password has been changed Successfully. <a href="{{ $intendedUrl }}" >Click here to visit your session url  </a></h3>
                           
                        </div>
                    </div>
                </div>

            </div>
        </div>
        </div>
    </div>
</div>
<!-- User Register Modal -->
<div class="modal fade" id="RegisterModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-lg">
    <div class="modal-content">
      <div class="modal-body">
        <div class="position-relative">
            <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

            <div class="row">
                <div class="col col-lg-5 col-12">
                    <div class="modal_left h-100">
                        <img src="{{ asset('assets/images/login_image.png') }}" alt="Image" class="img-fluid">
                    </div>
                </div>
                <div class="col col-lg-7 col-12 d-flex align-items-center">
                    <div class="position-relative modal_right">
                        <h3>Create account in Autopulse</h3>
                        <p>For better experience, order tracking & regular updates</p>

                        <form action="" id="register" > 
                            @csrf
                            <div class="row gx-2">
                                <div class="col col-6">
                                    <div class="position-relative">
                                        <input name="first_name" id="reg_first_name" type="text" class="form-control required" placeholder="First Name">
                                    </div>
                                </div>
                                <div class="col col-6">
                                    <div class="position-relative">
                                        <input name="last_name" id="reg_last_name" type="text" class="form-control required" placeholder="Last Name">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="phone_number" id="reg_phone_number" type="text" class="form-control required digit" maxlength ="10" placeholder="Contact Number">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="email" id="reg_email" type="text" class="form-control required " placeholder="Email">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="password" id="reg_password" type="password" class="form-control required" placeholder="Password">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input type="password" name="confirm_password" id="reg_confirm_password" class="form-control required" placeholder="Confirm Password">
                                    </div>
                                </div>

                                <div class="position-relative">
                                    <button type="button" id="register_button" class="btn btn_theme w-100" >Register</button>
                                </div>                            
                            </div>                            
                        </form>

                        <div class="position-relative text-center">
                            <p class="my-3"><span class="text_secondary">Aleady have an account?</span>&nbsp;<a class="link-primary" data-bs-target="#userLoginModal" data-bs-toggle="modal" data-bs-dismiss="modal">Login Now</a></p>
                        </div>

                        <div class="position-relative agree_text text-center">
                            <p class="mb-0 text_secondary"><small>By continuing, you agree to our <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>&nbsp;and&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></p>
                        </div>
                    </div>
                </div>
            </div>

        </div>
      </div>
    </div>
  </div>
</div>

<!-- User Reg Comfirmation Modal -->
<div class="modal fade" id="registerConfModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
            <div class="modal-body">
                <div class="position-relative">
                    <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                    <div class="row">
                        <div class="col col-lg-5 col-12">
                            <div class="modal_left h-100">
                                <img src="{{ asset('assets/images/login_image.png') }}" alt="Image" class="img-fluid">
                            </div>
                        </div>
                        <div class="col col-lg-7 col-12 d-flex align-items-center">
                            <div class="position-relative modal_right text-center">
                                <div class="conf_check">
                                    <img src="{{ asset('assets/images/check.png') }}" alt="check">
                                </div>
                                <h3 class="text_primary">A Verification link has been sent to your Email ID!</h3>
                                <div class="position-relative">
                                    <p class="my-3"><a  href="javascript:;" onclick ="resendverification()" class="link-primary">Resend the Link</a></p>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    </div>
</div>



  <!-- Are you sure? You want to logout? Modal -->
<div class="modal fade" id="logoutConfirmationModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-body">
            <div class="position-relative logout_confirmation_modal">
                <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                <div class="row">
                    <div class="col col-12">
                        <div class="position-relative">
                            <div class="modal_heading">
                                <h3>Confirm</h3>
                            </div>

                            <div class="position-relative logout_icon_text">
                                <i class="fa-solid fa-arrow-right-from-bracket"></i>
                                <h5>Are you sure? You want to logout?</h5>
                            </div>        
                            
                            <div class="position-relative text-center mb-3">
                                <a href="{{route('logout')}}" class="btn btn_theme_light">Yes</a>
                                <a data-bs-dismiss="modal" class="btn btn_secondary_light">No</a>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
        </div>
    </div>
</div>

<!-- Are you sure? You want to logout? Modal -->
<div class="modal fade" id="thank_you" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-body">
            <div class="position-relative logout_confirmation_modal">
                <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                <div class="row">
                    <div class="col col-12">
                        <div class="position-relative">
                            <div class="modal_heading">
                                <h3></h3>
                            </div>

                            <div class="position-relative logout_icon_text">
                               
                                <h5 class="successmsgdiv"></h5>
                            </div>        
                            
                           
                        </div>
                    </div>
                </div>

            </div>
        </div>
        </div>
    </div>
</div>

<!-- Share Modal -->
<div id="share-popup" class="share-popup" style="display: none;">
    <div class="share-popup-content">
        <p class="d-flex align-items-center"><span>Share</span><span class="close ms-auto" onclick="closeSharePopup()">&times;</span></p>
        <div class="share_modal_icon">
            <a href="#" id="share-facebook" onclick="shareToFb(event, this)">
                <i class="fab fa-facebook-f"></i>
                <p>Facebook</p>
            </a>
            <a href="#" id="share-twitter" onclick="shareToTwitter(event, this)">
                <i class="fab fa-twitter"></i>
                <p>Twitter</p>
            </a>
            <a href="#" id="share-linkedin" onclick="shareToLinkedIn(event, this)">
                <i class="fab fa-linkedin-in"></i>
                <p>Linkedin</p>
            </a>
            <a href="#" id="share-whatsapp" onclick="shareToWhatsApp(event, this)">
                <i class="fab fa-whatsapp"></i>
                <p>Whatsapp</p>
            </a>
            <a href="#"  id="share-sms"  onclick="shareTosms(event, this)"  class="d-md-none">
                <i class="fa-solid fa-comment-sms"></i>
                <p>SMS</p>
            </a>
        </div>
    </div>
</div>

<div class="modal fade" id="resetModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-lg">
    <div class="modal-content">
      <div class="modal-body">
        <div class="position-relative">
            <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

            <div class="row">
                <div class="col col-lg-5 col-12">
                    <div class="modal_left h-100">
                        <img src="{{ asset('assets/images/login_image.png') }}" alt="Image" class="img-fluid">
                    </div>
                </div>
                <div class="col col-lg-7 col-12 d-flex align-items-center">
                    <div class="position-relative modal_right">
                        <h3>Reset Password</h3>
                        <p>for Better Experience, Order tracking & Regular updates</p>

                        <form action="" id="resetform" > 
                            @csrf
                            <div class="row gx-2">
                               
                                <div class="col col-6">
                                    <div class="position-relative">
                                        <input name="token"  type="hidden" class="form-control required"  value="{{ $token ?? '' }}" placeholder="Last Name">
                                    </div>
                                </div>
                                
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="email" id="reset_email" type="text" class="form-control required " placeholder="Email">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="password" id="reset_password" type="password" class="form-control required" placeholder="Password">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input type="password" name="confirm_password" id="reset_confirm_password" class="form-control required" placeholder="Confirm Password">
                                    </div>
                                </div>

                                <div class="position-relative">
                                    <button type="button" id="reset_btn" class="btn btn_theme w-100" >Change Password</button>
                                </div>                            
                            </div>                            
                        </form>

                        <div class="position-relative text-center">
                            <p class="my-3"><span class="text_secondary">Aleady have an account?</span>&nbsp;<a class="link-primary" data-bs-target="#userLoginModal" data-bs-toggle="modal" data-bs-dismiss="modal">Login Now</a></p>
                        </div>

                        <div class="position-relative agree_text text-center">
                            <p class="mb-0 text_secondary"><small>By continuing, you agree to our <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>&nbsp;and&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></p>
                        </div>
                    </div>
                </div>
            </div>

        </div>
      </div>
    </div>
  </div>
</div>


@push ('after-scripts')
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-validate/1.19.3/jquery.validate.min.js" integrity="sha512-37T7leoNS06R80c8Ulq7cdCDU5MNQBwlYoy1TX/WUsLFC2eYNqtKlV0QjH7r8JpG/S0GUMZwebnVFLPd6SU5yg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script>
resendstp='';
function resend(){
    //alert()
    $('#loginbtn').trigger('click');
}  
$('#login').on('keypress', function(event) {
   
        if (event.key === 'Enter') {
            event.preventDefault();
            $('#loginbtn').trigger('click');
        }
});

$('#forgetpasswordbtn').on('keypress', function(event) {
   
   if (event.key === 'Enter') {
       event.preventDefault();
       $('#forgetpassword').trigger('click');
   }
});

$('#register').on('keypress', function(event) {
   
   if (event.key === 'Enter') {
       event.preventDefault();
       $('#register_button').trigger('click');
   }
});
$('#otpform').on('keypress', function(event) {
   
        if (event.key === 'Enter') {
            event.preventDefault();
            $('#verify').trigger('click');
        }
});

function startTimer(duration, display) {
    var timer = duration, minutes, seconds;
    setInterval(function () {
        minutes = parseInt(timer / 60, 10);
        seconds = parseInt(timer % 60, 10);

        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;

        display.textContent = minutes + ":" + seconds;

        if (--timer < 0) {
            timer = 0;
            $('#resendbtn').show();
            document.getElementById("resendButton").classList.remove('disabled');
        }
    }, 1000);
}
$('#register_button').click(function(e){
    //$('#phone_number').removeClass('phone_numbererror');
    if($('#register').valid())
    {    url = '{{ route("userregister") }}';
        var formData = $('#register').serialize();
        var originalText = $('#register_button').text();
       
            // Change the text of the button to indicate processing
        $('#register_button').text('Please wait...').prop('disabled', true);

        runajax(url, formData, 'post', '', 'json', function(output) {
            
            $('#register_button').text(originalText).prop('disabled', false);
            if (output.success) 
            {
                data  = output.data
                resendstp ='loginbtn';
                $('.modal').modal('hide');
                $('#registerConfModal').modal('show');
                $('#email').val($('#reg_email').val());
                $('#password').val($('#reg_password').val())
                //updateUserProfile(data,'{{route("favourite") }}','{{route("dashboard") }}');
                
            }else{
                if (output.data.length === 0) {
                    //key = 'phone_number'
                    existvalue= $('#reg_'+key).val();
                        jQuery.validator.addMethod(key+"error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.message));
                        $('#'+key).addClass(key+"error");
                        jQuery('#'+key).valid();
                } else {
                    for (var key in output.data){
                    
                        existvalue= $('#reg_'+key).val();
                        jQuery.validator.addMethod(key+"error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.data[key][0]));
                        $('#reg_'+key).addClass(key+"error");
                        jQuery('#reg_'+key).valid();
                    }
                }
                    
            }
        }); 
    }
})

$('#forgetpasswordbtn').click(function(e){
    //$('#phone_number').removeClass('phone_numbererror');
    if($('#forgetpassword').valid())
    {    url = '{{ route("userforgotPassword") }}';
        var formData = $('#forgetpassword').serialize();
        var originalText = $('#forgetpasswordbtn').text();
       
            // Change the text of the button to indicate processing
        $('#forgetpasswordbtn').text('Please wait...').prop('disabled', true);

        runajax(url, formData, 'post', '', 'json', function(output) {
            
            $('#forgetpasswordbtn').text(originalText).prop('disabled', false);
            if (output.success) 
            {
                data  = output.data
                
                $('.modal').modal('hide');
                $('#forgotPassConfModal').modal('show');

                //updateUserProfile(data,'{{route("favourite") }}','{{route("dashboard") }}');
                
            }else{
                if (output.data.length === 0) {
                    //key = 'phone_number'
                    existvalue= $('#reset'+key).val();
                        jQuery.validator.addMethod(key+"error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.message));
                        $('#'+key).addClass(key+"error");
                        jQuery('#'+key).valid();
                } else {
                    for (var key in output.data){
                    
                        existvalue= $('#reset_'+key).val();
                        jQuery.validator.addMethod(key+"error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.data[key][0]));
                        $('#reg_'+key).addClass(key+"error");
                        jQuery('#reg_'+key).valid();
                    }
                }
                    
            }
        }); 
    }
})

$('#reset_btn').click(function(e){
    //$('#phone_number').removeClass('phone_numbererror');
    if($('#resetform').valid())
    {    url = '{{ route("userpassword.update") }}';
        var formData = $('#resetform').serialize();
        var originalText = $('#reset_btn').text();
       
            // Change the text of the button to indicate processing
        $('#reset_btn').text('Please wait...').prop('disabled', true);

        runajax(url, formData, 'post', '', 'json', function(output) {
            
            $('#reset_btn').text(originalText).prop('disabled', false);
            if (output.success) 
            {
                
                data  = output.data
                $('.modal').modal('hide');
                $('#paswordsuccessfully').modal('show');
                updateUserProfile(data,'{{route("favourite") }}','{{route("dashboard") }}');
                
            }else{
                if (output.data.length === 0) {
                    key = 'email'
                    existvalue= $('#reset_'+key).val();
                        jQuery.validator.addMethod(key+"error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.message));
                        $('#reset_'+key).addClass(key+"error");
                        jQuery('#reset_'+key).valid();
                } else {
                    for (var key in output.data){
                    
                        existvalue= $('#reset_'+key).val();
                        jQuery.validator.addMethod(key+"error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.data[key][0]));
                        $('#reset_'+key).addClass(key+"error");
                        jQuery('#reset_'+key).valid();
                    }
                }
                    
            }
        }); 
    }
})
$('#loginbtn').click(function(e){
    //$('#phone_number').removeClass('phone_numbererror');
    if($('#login').valid())
    {    url = '{{ route("userlogin") }}';
        var formData = $('#login').serialize();
        var originalText = $('#loginbtn').text();
       
            // Change the text of the button to indicate processing
        $('#loginbtn').text('Please wait...').prop('disabled', true);

        runajax(url, formData, 'post', '', 'json', function(output) {
            
            $('#loginbtn').text(originalText).prop('disabled', false);
            if (output.success) 
            {
                
                data  = output.data
                $('.modal').modal('hide');
                console.log(data.length);
                if (data.length === 0) {
                      resendstp ='loginbtn';
                    $('#registerConfModal').modal('show');
                }else{
                     updateUserProfile(data,'{{route("favourite") }}','{{route("dashboard") }}');
                }
                
            }else{
                if (output.data.length === 0) {
                 
                    $('#my-error').html(output.message);
                    $('#my-error').show();
                    
                } else {
                    for (var key in output.data){
                    
                        existvalue= $('#'+key).val();
                        jQuery.validator.addMethod(key+"error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.data[key][0]));
                        $('#'+key).addClass(key+"error");
                        jQuery('#'+key).valid();
                    }
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
                data  = output.data
                const hasFirstName = data.hasOwnProperty('first_name') && data.first_name && data.first_name.trim() !== '';
                const hasLastName = data.hasOwnProperty('last_name') && data.last_name && data.last_name.trim() !== '';

                if(hasFirstName && hasLastName){
                    //window.location.reload()
                    data  = output.data
                    $('.modal').modal('hide');
                    updateUserProfile(data,'{{route("favourite") }}','{{route("dashboard") }}');
                }else{

                    $('.rightscreen').hide();
                    $('.rightscreen').removeClass('d-flex')
                    $('#profilestep').addClass('d-flex');
                    $('#profilestep').show();
                    //$('.modal').modal('hide');
                    //$('#loggedInModal').modal('show');
                }
                
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

    $('#update_profile button').click(function(e){
    e.preventDefault();
    $('#update_profile button').text('Please wait...');
    $('#update_profile button').attr('disabled','disabled');
    
    if($('#update_profile').valid())
    {    
        url = '{{route('updateProfile')}}';

        var formData = new FormData($('#update_profile')[0]);
        
        uploadajax(url, formData, 'post', '', 'json', function(output) {
            // var output = JSON.parse(res);
            $('#update_profile button').text('Update Profile ');
            $('#update_profile button').removeAttr('disabled');
            if (output.success) 
            {
                $('#update_profile')[0].reset();	
                //window.location.reload();
                data  = output.data
                $('.modal').modal('hide');
                updateUserProfile(data,'{{route("favourite") }}','{{route("dashboard") }}');
               // $('#thank_you').modal('show');
                
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
    }else{
        $('#update_profile button').text('Update Profile');
        $('#update_profile button').removeAttr('disabled');
    }
});
</script>
<script>
document.addEventListener('DOMContentLoaded', function() {
    var token = "{{ $token ??'' }}";
    if (token) {
        $('#resetModal').modal('show');
    }
});
function forget()
{
    $('#forgetpasswordbtn').trigger('click'); 
}
function resendverification()
{
    //if(resendstp)
    $('.modal').modal('hide');
        $('#'+resendstp).trigger('click');
    //else

}
</script>
<script>
    const togglePassword = document.querySelector('#togglePassword');
    const passwordInput = document.querySelector('#passwordInput');
    const toggleDealerPassword = document.querySelector('#toggleDealerPassword');
    const passwordDealerInput = document.querySelector('#passwordDealerInput');

    togglePassword.addEventListener('click', function (e) {
      // toggle the type attribute
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      // toggle text
      this.textContent = type === 'password' ? 'Show' : 'Hide';
    });

    toggleDealerPassword.addEventListener('click', function (e) {
      // toggle the type attribute
      const type = passwordDealerInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordDealerInput.setAttribute('type', type);
      // toggle text
      this.textContent = type === 'password' ? 'Show' : 'Hide';
    });
  </script>
@endpush