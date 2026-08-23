<!-- Dealer Login Modal -->
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
                <div class="col col-lg-7 col-12 d-flex align-items-center" id="loginscreen" >
                    <!--<div class="position-relative modal_right">
                        <h3>Login or Signup</h3>
                      
                        <p>You will receive the OTP via automated voice call on your mobile. </p>
                      
                        <form id="login" method="post">
                            @csrf
                            <div class="position-relative d-flex">
                                <select id="dial_code" name="dial_code" class="form-select country_code">
                                    @foreach(config('constants.COUNTRY_CODE') as $country)
                                        <option value="+{{ $country['code'] }}"> {{ $country['name'] }} (+{{ $country['code'] }}) </option>
                                    @endforeach
                                   
                                </select>
                                <input name="phone_number" id="phone_number" type="text"  class="form-control  required" placeholder="Enter Phone Number"><br/>
                               
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
                        <h3>Login as Autopulse Dealer!</h3>
                        <p>For better experience, order tracking & regular updates</p>

                        <form action="" id="login" >
                            @csrf
                            <div class="position-relative">
                                <input name="email" type="text" id="email" class="form-control required email" placeholder="Email">
                            </div>
                            <div class="position-relative">
                                <button class="btn border-0 position-absolute end-0 top-0 px-3 link-primary" type="button" id="togglePassword">Show</button>
                                <input type="password" name="password" class="form-control required" id="passwordInput" placeholder="Password">
                                <label id="my-error" class="error" style=""></label>
                            </div>
                            <div class="position-relative d-flex align-items-center justify-content-between mb-3">
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" value="" id="defaultCheck1">
                                    <label class="form-check-label" for="defaultCheck1"><small>Keep me signed in</small></label>
                                </div>
                                <a class="link-primary" data-bs-toggle="modal" data-bs-target="#forgotPassModal" data-bs-dismiss="modal"><small>Forgot Password</small></a>
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
                            <a href="{{ route('dealer.social.redirect','google') }}" class="btn w-100 mb-2"><img src="{{ asset('assets/images/social/google.png') }}" alt=""><span>Continue with Google</span></a>
                            <a href="{{ route('dealer.social.redirect','linkedin-openid') }}" class="btn w-100 mb-2"><img src="{{ asset('assets/images/social/li.png') }}" alt=""><span>Continue with LinkedIN</span></a>
                            <!--a href="{{ route('dealer.social.redirect','facebook') }}" class="btn w-100 mb-2"><img src="{{ asset('assets/images/social/fb.png') }}" alt=""><span>Continue with Facebook</span></a-->
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
                        <h3>Login or Signup</h3>
                        <p id="otpmsg">OTP has been sent to +0-0000000000</p>

                        <!-- <form action=""> -->

                        <form id="otpform"> 
                            @csrf
                            <div  class="position-relative" >
                                <input type="text" maxlength="6" name="otp" id ="otp" class="required form-control" placeholder="Enter OTP" />
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
                <div class="col col-md-8 col-12 align-items-center rightscreen" id="profilestep" style="display:none !important;">
                    <div class="position-relative modal_right">
                        <h3>Logged in Successfully</h3>
                        <p>Please provide some more information for better communication</p>
                        <form action="{{ route('updateProfile') }}" id="update_profile"  enctype="multipart/form-data">  
                            @csrf
                            <div class="row">
                                <div class="col col-6">
                                    <input type="text" id="first_name" name="first_name" placeholder="Enter First Name*" value="" class="form-control required">
                                    <input type="hidden" name="sendverify" value="1" >
                                </div>
                                <div class="col col-6">
                                    <input type="text" id="last_name"  name="last_name" placeholder="Enter Last Name*" value="" class="form-control required">   
                                </div>
                                <div class="col col-12">
                                    <input type="text" id="designation" name="designation" class="form-control required" placeholder="Enter Designation ">
                                </div>
                            
                                <div class="col col-12">
                                    <input type="text" id="source" name="source" class="form-control required" placeholder="Enter Dealership Url">
                                </div>

                                <div class="col col-12">
                                    <input type="text" id="email"  name="email" placeholder="Work Email" value="" class="form-control required">   
                                </div>
                                
                                <div class="col col-12"> 
                                    <p class="form-check text-start">
                                        <input type="checkbox" class="form-check-input required" onclick="iagree(this)" name="i_agree" value="1" id="i_agreee">
                                        <label class="form-check-label" for="i_agreee"><small>By continuing, you agree to our <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>&nbsp;and&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></label>
                                    </p>
                                </div>
                                    
                                <div class="position-relative">
                                    <button type="button" class="btn btn_theme w-100" >Continue</button>
                                </div> 
                                
                            </div>                                                       
                        </form>

                        <div class="position-relative agree_text text-center">
                            <p class="mb-0 text_secondary"><small>By continuing, you agree to our <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>&nbsp;and&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></p>
                        </div>
                    </div>
                </div>
                <div class="col col-lg-8 col-12 align-items-center rightscreen" id="thankyoustep" style="display:none !important;">
                    <div class="position-relative modal_right">
                        <h3>Verify you email</h3>
                        <p id="successemaildiv">We've sent an email to test@test.com to verify your email address and activate your account.</p>

                        <div class="position-relative">
                            <!-- <button class="btn btn_theme w-100" data-bs-dismiss="modal">Ok</button> -->
                            <a href="{{ route('dealer.profile')}}" class="btn btn_theme w-100">Ok</a>
                        </div> 
                    </div>
                </div>
            </div>

        </div>
      </div>
    </div>
  </div>
</div>

<!-- Dealer OTP Modal -->




<!-- Dealer Logged In Modal -->
<div class="modal fade" id="verifyEmailModal" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg">
            <div class="modal-content">
            <div class="modal-body">
                <div class="position-relative">
                    <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                    <div class="row">
                        <div class="col col-lg-5 col-12">
                            <div class="modal_left h-100">
                                <img src="./assets/images/login_image.png" alt="Image" class="img-fluid">
                            </div>
                        </div>
                        <div class="col col-lg-7 col-12 d-flex align-items-center">
                            <div class="position-relative modal_right">
                                <h3>Verify you email</h3>
                                <p>We've sent an email to test@test.com to verify your email address and activate your account.</p>

                                <div class="position-relative">
                                    <!-- <button class="btn btn_theme w-100" data-bs-dismiss="modal">Ok</button> -->
                                    <a href="{{ route('dealer.profile')}}" class="btn btn_theme w-100">Ok</a>
                                </div> 
                            </div>
                        </div>
                    </div>

                </div>
            </div>
            </div>
        </div>
    </div>


    <!-- Dealer Details Modal -->
<div class="modal fade" id="dealerDetailsModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-body">
            <div class="position-relative dealer_details_modal">
                <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                <div class="row">
                    <div class="col col-12">
                        <div class="position-relative">
                            <div class="modal_heading">
                                <h3>Seller Details</h3>
                            </div>

                            <div class="car_card dealer_details_card">
                                <a class="car_card_main">
                                    <div class="car_card_img">          
                                        <div class="bg-span"></div>                  
                                        <img src="./assets/images/newjeep.jpg" alt="Car Image">
                                    </div>
                                    <div class="car_card_info">
                                        <div class="car_title_price">
                                            <h4>Jeep Compass</h4>
                                            <div class="car_spec">
                                                <div class="car_spec_info">
                                                    <span>2021</span>&nbsp;|&nbsp;<span>Gasoline</span>&nbsp;|&nbsp;<span>Automatic</span>
                                                </div>
                                            </div>                                                
                                            <h5>$23,495</h5>
                                        </div>
                                    </div>
                                </a>
                            </div>

                            <div class="short_note mt-3">
                                <p><small><i class="fa-solid fa-circle-check me-2"></i><span>Your contact has been shared-You will be contacted shortly</span></small></p>
                            </div>

                            <hr>
            
                            <div class="dealer_contact">
                                <i class="fa-solid fa-location-dot me-2"></i>
                                <div class="position-relative">
                                    <p>Lorem Ipsum</p>
                                    <p><small>20 Cooper Square, New York, NY 10003, USA</small></p>
                                </div>
                            </div>
                            <div class="dealer_contact">
                                <i class="fa-solid fa-phone me-2"></i>
                                <div class="position-relative">
                                    <p>+0-0000000000</p>
                                </div>
                            </div>
                            <div class="position-relative agree_text">
                                <p class="mb-0 text_secondary"><small>autopulse.ai is not responsible for seller actions. Always inspect the car in person before making any transactions.</small></p>
                            </div>

                            <hr>

                            <div class="modal_heading">
                                <h3>Recommended Cars</h3>
                            </div>

                            <div class="recommended_list">
                                <?php  
                                    for ($x = 1; $x <= 4; $x++) {
                                ?>
                                    <div class="recommended_list_card">
                                        <div class="car_card dealer_details_card">
                                            <a href="car-details.php" class="car_card_main">
                                                <div class="car_card_img">          
                                                    <div class="bg-span"></div>                  
                                                    <img src="./assets/images/newjeep.jpg" alt="Car Image">
                                                </div>
                                                <div class="car_card_info">
                                                    <div class="car_title_price">
                                                        <h4>Jeep Compass</h4>
                                                        <div class="car_spec">
                                                            <div class="car_spec_info">
                                                                <span>2021</span>&nbsp;|&nbsp;<span>Gasoline</span>&nbsp;|&nbsp;<span>Automatic</span>
                                                            </div>
                                                        </div>                                                
                                                        <h5>$23,495</h5>
                                                    </div>
                                                </div>
                                            </a>
                                        </div>
                                        <hr>
                                        <div class="d-flex align-items-center ">
                                            <div class="like_share_icon">
                                                <!-- Toggle Favorite Button -->
                                                <div class="form-check fevCheck">
                                                    <input type="checkbox" class="form-check-input" id="btn-check" autocomplete="off">
                                                    <label class="form-check-label" for="btn-check"><i class="far fa-heart" id="heart-icon"></i></label>
                                                </div>

                                                <!-- Share Icon -->
                                                <div class="share_icon">
                                                    <i class="fa-regular fa-share-from-square"></i>
                                                </div>
                                            </div>

                                            <a href="" class="text_primary ms-auto"><small>Request Contact from Dealer<i class="fa-solid fa-angle-right ms-2"></i></small></a>
                                        </div>
                                    
                                    </div>
                                <?php  
                                    }
                                ?>

                                <hr class="mt-0">

                                <div class="position-relative">
                                    <a href="" class="text_primary"><small>View More Cars<i class="fa-solid fa-angle-right ms-2"></i></small></a>
                                </div>
                            </div>
                            
                        </div>
                    </div>
                </div>

            </div>
        </div>
        </div>
    </div>
</div>

<!-- Consumer Details Modal -->
<div class="modal fade" id="consumerDetailsModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-body">
            <div class="position-relative dealer_details_modal">
                <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                <div class="row" id="consumerDetailsModalbody">
                    
                </div>

            </div>
        </div>
        </div>
    </div>
</div>

<!-- Are you sure? You want to logout? Modal -->
<!-- <div class="modal fade" id="dealerlogoutConfirmationModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
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
                                <a href="{{ route('dealer.logout')}}" class="btn btn_theme_light">Yes</a>
                                <a data-bs-dismiss="modal" class="btn btn_secondary_light">No</a>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
        </div>
    </div>
</div> -->

<!-- Car Details Modal -->
<div class="modal fade" id="carDetailsModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-fullscreen">
        <div class="modal-content">
            <div class="modal-header">
                <div class="modal_heading">
                    <h3 class="mb-0">Car Details</h3>
                </div>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body py-3 px-0" id='cardetailbody'>
               
            </div>
        </div>
    </div>
</div>
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
                <p>LinkedIn</p>
            </a>
            <a href="#" id="share-whatsapp" onclick="shareToWhatsApp(event, this)">
                <i class="fab fa-whatsapp"></i>
                <p>Whatsapp</p>
            </a>
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
                                    <input  type="text" name="email" id="forgot_email"class="form-control" placeholder="Enter Your Email ID">
                                </div>
                                <div class="position-relative">
                                    <button type="button" id="forgetpasswordbtn" class="btn btn_theme w-100 mt-3" >Reset password</button>
                                </div>                            
                            </form>

                            <div class="position-relative text-center">
                                <p class="my-3"><a class="link-primary" data-bs-target="#userLoginModal" data-bs-toggle="modal" data-bs-dismiss="modal">Back to Login</a></p>
                            </div>

                            <div class="position-relative agree_text text-center">
                                <p class="mb-0 text_secondary"><small>By continuing, you agree to our <a ref="{{ route('privacy') }}" target="blank">Privacy Policy</a>&nbsp;and&nbsp;<a href="{{ route('term') }}"  target="blank">Terms & Conditions</a></small></p>
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
                            <h3 class="text_primary">Your Password has been changed Successfully</h3>
                           
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
                        <h3>Create Dealer Account!</h3>
                        <p>For better experience, order tracking & regular updates</p>

                        <form action="" id="register" > 
                            @csrf
                            <div class="row gx-2 registrationpart" id="regpart1">
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
                                        <input name="email" id="reg_email" type="text" class="form-control required " placeholder="Email">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="phone_number" id="reg_phone_number" type="text" class="form-control required digit" maxlength ="10" placeholder="Contact Number">
                                    </div>
                                </div>
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="designation" id="reg_designation" type="text" class="form-control required " placeholder="Title">
                                    </div>
                                </div>    
                                <div class="col col-12">
                                        <div class="position-relative">
                                            <input name="dealership_group" id="reg_dealership_group" type="text" class="form-control required "  placeholder="Dealership Group">
                                        </div>
                                </div>
                               
                               
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="password" id="reg_password" type="password" class="form-control required" placeholder="Password">
                                    </div>
                                </div>

                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="confirm_password" id="reg_confirm_password" type="password" class="form-control required" placeholder="Confirm Password">
                                    </div>
                                </div>
                                
                                <div class="position-relative">
                                        <button type="button" id="register_button" class="btn btn_theme w-100" >Register</button>
                                </div>  
                                <!--div class="position-relative">
                                    <button type="button" id="register_preview" class="btn btn_theme w-100" >Next</button>
                                </div-->    
                               
                            </div>
                            <!--
                                <div class="row gx-2 registrationpart" id="regpart2" style="display:none;">
                                    <div class="col col-12">
                                        <div class="position-relative">
                                            <input name="designation" id="reg_designation" type="text" class="form-control required " placeholder="Title">
                                        </div>
                                    </div>                                
                                    <div class="col col-12">
                                        <div class="position-relative">
                                            <input name="dealership_name" id="reg_dealership_name" type="text" class="form-control required " maxlength ="10" placeholder="Dealership Name">
                                        </div>
                                    </div>
                                </div>                                
                                <div class="col col-12">
                                    <div class="position-relative">
                                        <input name="dealership_name" id="reg_dealership_name" type="text" class="form-control required "  placeholder="Dealership Name">
                                    </div>
                                

                                
                                    

                                    <div class="position-relative">
                                        <button type="button" id="register_button" class="btn btn_theme w-100" >Register</button>
                                    </div>                            
                                </div>
                            -->                            
                        </form>
                        <!--div class="position-relative text-center">
                            <p class="my-3"><a href="javascript:;"class="link-primary" onclick="backtobtn(`regpart1`,`registrationpart`)" data-bs-dismiss="modal">Back to Edit</a></p>
                        </div-->

                        <div class="position-relative text-center">
                            <p class="my-3"><span class="text_secondary">Aleady have an account?</span>&nbsp;<a class="link-primary" data-bs-target="#userLoginModal" data-bs-toggle="modal" data-bs-dismiss="modal">Login Now</a></p>
                        </div>

                        <div class="position-relative agree_text text-center">
                            <p class="mb-0 text_secondary"><small>By continuing, you agree to our <a ref="{{ route('privacy') }}" target="blank">Privacy Policy</a>&nbsp;and&nbsp;<a href="{{ route('term') }}"  target="blank">Terms & Conditions</a></small></p>
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
                                    <p class="my-3"><a  href="javascript::"class="link-primary" onclick="resendverification()">Resend the Link</a></p>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
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
                            <p class="mb-0 text_secondary"><small>By continuing, you agree to our <a ref="{{ route('privacy') }}" target="blank">Privacy Policy</a>&nbsp;and&nbsp;<a href="{{ route('term') }}"  target="blank">Terms & Conditions</a></small></p>
                        </div>
                    </div>
                </div>
            </div>

        </div>
      </div>
    </div>
  </div>
</div>

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

@push ('after-scripts')

<script>
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
  $('#forgetpasswordbtn').trigger('click');
}
});

$('#register').on('keypress', function(event) {

if (event.key === 'Enter') {
  event.preventDefault();
  $('#register_button').trigger('click');
}
});

$('#register_preview').on('keypress', function(event) {

if (event.key === 'Enter') {
  event.preventDefault();
  $('#register_preview').trigger('click');
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

function backtobtn(backid, backclass){
    $('#'+backclass).hide()
    $('#'+backid).show()
}
/*
$('#loginbtn').click(function(e){
    $('#phone_number').removeClass('phone_numbererror');
       if($('#login').valid())
       {     var originalText = $('#loginbtn').text();

            // Change the text of the button to indicate processing
             $('#loginbtn').text('Please wait...').prop('disabled', true);
             $('#phone_number').removeClass('phone_numbererror');
            url = '{{ route("dealer.generateOtp") }}';
            var formData = $('#login').serialize();
            runajax(url, formData, 'post', '', 'json', function(output) {
              
                $('#loginbtn').text(originalText).prop('disabled', false);

                if (output.success) 
                {
                    $('.rightscreen').hide();
                    $('.rightscreen').removeClass('d-flex')
                    $('#otpscreen').addClass('d-flex');
                    $('#otpscreen').show();
                    $('#phone_number_added').val($('#phone_number').val());
                    $('#dial_code_hidden').val($('#dial_code').val());
                    $('#otpmsg').html('You will receive the OTP via automated voice call on your mobile  ' +$('#dial_code').val() +$('#phone_number').val());
                    $('.otpform').show();
                    $('#resendbtn').hide();
                    startTimer(60, document.getElementById("timer"));
                    
                }else{
                    if (output.data.length === 0) {
                        key = 'phone_number'
                        existvalue= $('#'+key).val();
                            jQuery.validator.addMethod(key+"error", function(value, element) {
                                return this.optional(element) || value !== existvalue;
                            }, jQuery.validator.format(output.message));
                            $('#'+key).addClass(key+"error");
                            jQuery('#'+key).valid();
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
       {    
            var originalText = $('#loginbtn').text();
            $('#verify').text('Please wait...').prop('disabled', true);
            url = '{{ route("dealer.validateOtp") }}';
            var formData = $('#otpform').serialize();
            runajax(url, formData, 'post', '', 'json', function(output) {
              
                $('#verify').text(originalText).prop('disabled', false);
                if (output.success) 
                {
                    data  = output.data
                    const hasFirstName = data.hasOwnProperty('first_name') && data.first_name && data.first_name.trim() !== '';
                    const hasLastName = data.hasOwnProperty('last_name') && data.last_name && data.last_name.trim() !== '';

                    if(hasFirstName && hasLastName){
                        data  = output.data
                        $('.modal').modal('hide');
                        window.location.href ='{{ route("dealer.profile")}}';
                    }else{
                        $('.rightscreen').hide();
                        $('.rightscreen').removeClass('d-flex')
                        $('#profilestep').addClass('d-flex');
                        $('#profilestep').show();
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
        url = '{{route('dealer.updateProfile')}}';

        var formData = new FormData($('#update_profile')[0]);
        
        uploadajax(url, formData, 'post', '', 'json', function(output) {
            // var output = JSON.parse(res);
            $('#update_profile button').text('Update Profile ');
            $('#update_profile button').removeAttr('disabled');
            if (output.success) 
            {
                $('.rightscreen').hide();
                $('.rightscreen').removeClass('d-flex')
                $('#thankyoustep').addClass('d-flex');
                $('#thankyoustep').show();
                $('#successemaildiv').html(`We've sent an email to `+output.data.email+` to verify your email address and activate your account.`);
                    //$('.modal').modal('hide');
                    //$('#verifyEmailModal').modal('show');
                
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
*/
$('#register_button').click(function(e){
    //$('#phone_number').removeClass('phone_numbererror');
    if($('#register').valid())
    {    url = '{{ route("dealerregister") }}';
        var formData = $('#register').serialize();
        var originalText = $('#register_button').text();
       
            // Change the text of the button to indicate processing
        $('#register_button').text('Please wait...').prop('disabled', true);

        runajax(url, formData, 'post', '', 'json', function(output) {
            
            $('#register_button').text(originalText).prop('disabled', false);
            if (output.success) 
            {
                data  = output.data
                
                $('.modal').modal('hide');
               
                $('#registerConfModal').modal('show');
                window.location.href ='{{ route("dealer.profile")}}';
               // updateUserProfile(data,'{{route("favourite") }}','{{route("dashboard") }}');
                
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

$('#register_preview').click(function(e){
    //$('#phone_number').removeClass('phone_numbererror');
    if($('#register').valid())
    {    url = '{{ route("dealerregister_preview") }}';
        var formData = $('#register').serialize();
        var originalText = $('#register_preview').text();
       
            // Change the text of the button to indicate processing
        $('#register_preview').text('Please wait...').prop('disabled', true);

        runajax(url, formData, 'post', '', 'json', function(output) {
            
            $('#register_preview').text(originalText).prop('disabled', false);
            if (output.success) 
            {
                    $('.registrationpart').hide();
                    $('#regpart2').show();
                
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
    {    url = '{{ route("dealerforgotPassword") }}';
        var formData = $('#forgetpassword').serialize();
        var originalText = $('#forgetpasswordbtn').text();
       
            // Change the text of the button to indicate processing
        $('#forgetpasswordbtn').text('Please wait...').prop('disabled', true);

        runajax(url, formData, 'post', '', 'json', function(output) {
            
            $('#forgetpasswordbtn').text(originalText).prop('disabled', false);
            if (output.success) 
            {
                data  = output.data
                
                $('#forgotPassModal').modal('hide');
                $('#forgotPassConfModal').modal('show');
                window.location.href ='{{ route("dealer.profile")}}';
                //updateUserProfile(data,'{{route("favourite") }}','{{route("dashboard") }}');
                
            }else{
                if (output.data.length === 0) {
                    //key = 'phone_number'
                    key ='forgot_email'
                    existvalue= $('#forgot_email').val();
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
    {    url = '{{ route("dealerpassword.update") }}';
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
                window.location.href ='{{ route("dealer.profile")}}';
                //updateUserProfile(data,'{{route("favourite") }}','{{route("dashboard") }}');
                
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
    {    url = '{{ route("dealerlogin") }}';
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
                window.location.href ='{{ route("dealer.profile")}}';
                
            }else{
                if (output.data.length === 0) {
                    key = 'passwordInput'
                    existvalue= $('#'+key).val();
                        jQuery.validator.addMethod(key+"error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.message));
                        $('#'+key).addClass(key+"error");
                        jQuery('#'+key).valid();
                } else {
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
                    
            }
        }); 
    }
})
</script>
<script>
document.addEventListener('DOMContentLoaded', function() {

    var token = "{{ $token ??'' }}";
   
    if (token) {
        $('#resetModal').modal('show');
    }
});
function resendverification()
{
    url ='{{route('dealer.sendverify')}}';
    runajax(url, formData, 'post', '', 'json', function(output) {
        $('#registerConfModal').modal('show');
        
    });
}
function forget()
{
    $('#forgetpasswordbtn').trigger('click'); 
}
</script>
<script>
    document.addEventListener('DOMContentLoaded', function () {
  const togglePassword = document.querySelector('#togglePassword');
  const passwordInput = document.querySelector('#passwordInput');
  const toggleDealerPassword = document.querySelector('#toggleDealerPassword');
  const passwordDealerInput = document.querySelector('#passwordDealerInput');

  if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', function (e) {
      // toggle the type attribute
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      // toggle text
      this.textContent = type === 'password' ? 'Show' : 'Hide';
    });
  }

  if (toggleDealerPassword && passwordDealerInput) {
    toggleDealerPassword.addEventListener('click', function (e) {
      // toggle the type attribute
      const type = passwordDealerInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordDealerInput.setAttribute('type', type);
      // toggle text
      this.textContent = type === 'password' ? 'Show' : 'Hide';
    });
  }
});

  </script>
@endpush