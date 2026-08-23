<!-- Dealer Login Modal -->
<div class="modal fade" id="userLoginModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-lg">
    <div class="modal-content">
      <div class="modal-body">
        <div class="position-relative">
            <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

            <div class="row">
                <div class="col col-md-4 col-12">
                    <div class="modal_left">
                        <img src="{{asset('assets/images/login_image.png') }}" alt="Image" class="img-fluid">
                    </div>
                </div>
                <div class="col col-md-8 col-12 d-flex align-items-center rightscreen" id="loginscreen" >
                    <div class="position-relative modal_right">
                        <h3>Login or Signup</h3>
                        <!--p>for Better Experience, Order tracking & Regular updates</p>-->
                        <p>You will receive the OTP via automated voice call on your mobile. </p>
                        <!-- <form action=""> -->

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
                                                    
                        <!-- </form> -->

                        <div class="position-relative agree_text text-center">
                            <p class="mb-0 text_secondary"><small>By continuing I agree with the <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>,&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></p>
                        </div>
                    </div>
                </div>
                <div class="col col-md-8 col-12  align-items-center rightscreen" id="otpscreen" style="display:none !important;">
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
                            <p class="mb-0 text_secondary"><small>By continuing I agree with the <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>,&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></p>
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
                                    <input type="text" id="name" name="name" placeholder="Enter First Name*" value="" class="form-control required">
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
                                        <label class="form-check-label" for="i_agreee"><small>By continuing I agree with the <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>,&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></label>
                                    </p>
                                </div>
                                    
                                <div class="position-relative">
                                    <button type="button" class="btn btn_theme w-100" >Continue</button>
                                </div> 
                                
                            </div>                                                       
                        </form>

                        <div class="position-relative agree_text text-center">
                            <p class="mb-0 text_secondary"><small>By continuing I agree with the <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>,&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></p>
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
                        <div class="col col-lg-4 col-12">
                            <div class="modal_left">
                                <img src="./assets/images/login_image.png" alt="Image" class="img-fluid">
                            </div>
                        </div>
                        <div class="col col-lg-8 col-12 d-flex align-items-center">
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
                                <p><small><i class="fa-solid fa-circle-check me-2"></i><span>Soon, Your contact details will be shared with the seller</span></small></p>
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

                                            <a href="" class="text_primary ms-auto"><small>View Dealer Details<i class="fa-solid fa-angle-right ms-2"></i></small></a>
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
                <p>Linkedin</p>
            </a>
            <a href="#" id="share-whatsapp" onclick="shareToWhatsApp(event, this)">
                <i class="fab fa-whatsapp"></i>
                <p>Whatsapp</p>
            </a>
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
                    const hasFirstName = data.hasOwnProperty('name') && data.name && data.name.trim() !== '';
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
</script>
@endpush