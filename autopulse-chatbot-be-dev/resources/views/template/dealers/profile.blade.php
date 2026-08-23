@extends('layouts.front')
 
@section('content')

<main class="page-wrapper rbt-dashboard-page">
    <div class="rbt-panel-wrapper">

    <!-- Start Header  -->
    @include('template.dealers.include.header')
    <!-- End Header  -->

    <!-- start mobilemenu -->
    @include('template.dealers.include.mobilemenu')
    <!-- End mobilemenu -->

    <!-- start mobilemenu -->
    @include('template.dealers.include.sidebar')
    <!-- End mobilemenu -->

    @php
        $user = Auth::guard('dealer')->user();  
    @endphp
    <!-- Start Main content -->
    <div class="rbt-main-content mr--0 mb--0">
        <div class="rbt-daynamic-page-content center-width">

            <!-- Dashboard Center Content -->
            <div class="rbt-dashboard-content">
                <div class="banner-area">
                    <!-- ChatenAI small Slider -->
                    <div class="settings-area mb-0">
                        <h3 class="title mb-0">Profile Details</h3>
                    </div>
                </div>
                <div class="content-page pb--50">
                    <h5 class="title">Step 2</h5>
                    <div class="chat-box-list overflow-y-initial">

                        @if($user && !$user->email_verified_at)
                            <div class="alert alert-danger" role="alert">
                                Your email address is not verified. Please verify it to access all features. <a href="{{route('dealer.sendverify')}}"> Send Verification Mail </a>
                            </div>
                        @endif

                        <!-- ChatenAI Settings Settings -->
                        <div class="single-settings-box profile-details-box top-flashlight light-xl leftside overflow-hidden">
                            <div class="profile-details-tab">
                                <div class="advance-tab-button mb--30">
                                    <ul class="nav nav-tabs tab-button-style-2 justify-content-start" id="settinsTab-4" role="tablist">
                                        <li role="presentation">
                                            <a href="#" class="tab-button active" id="profile-tab" data-bs-toggle="tab" data-bs-target="#profile" role="tab" aria-controls="profile" aria-selected="true">
                                                <span class="title">Profile</span>
                                            </a>
                                        </li>
                                        <li role="presentation">
                                            <a href="#" class="tab-button" id="password-tab" data-bs-toggle="tab" data-bs-target="#password" role="tab" aria-controls="password" aria-selected="false">
                                                <span class="title">Address</span>
                                            </a>
                                        </li>
                                        <li role="presentation">
                                            <a href="#" class="tab-button" id="del-account-tab" data-bs-toggle="tab" data-bs-target="#delaccount" role="tab" aria-controls="delaccount" aria-selected="false">
                                                <span class="title">Password</span>
                                            </a>
                                        </li>
                                    </ul>
                                </div>

                                <div class="tab-content">
                                    <div class="tab-pane fade active show" id="profile" role="tabpanel" aria-labelledby="profile-tab">
                                        <!-- Start Profile Row  -->
                                        <form action="{{ route('dealer.updateProfile') }}" class="rbt-profile-row rbt-default-form row row--15" id="update_profile_dashbaord" method="post" enctype="multipart/form-data">
                                            @csrf    
                                            <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                                <div class="form-group">
                                                    <label>Name</label>
                                                    <input type="text" id="update_name" name="name" placeholder="Name"  value="{{ auth('dealer')->user()->name }}" class="required">
                                                </div>
                                            </div>
                                            <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                                <div class="form-group">
                                                    <label>Contact Number</label>
                                                    <input type="tel" id="update_phone_number" name="phone_number" placeholder="Contact Number" value="{{ auth()->user('dealer')->phone_number }}">
                                                </div>
                                            </div>
                                            <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                                <div class="form-group">
                                                    <label for="username">Work Email</label>
                                                    <input type="email" id="update_email"  name="email" placeholder="Work Email" value="{{ auth('dealer')->user()->email }}" class="form-control required email" @if(auth('dealer')->user()->social_account) readonly @endif>
                                                </div>
                                            </div>
                                            <div class="col-12 mt--20">
                                                <div class="form-group mb--0">
                                                    <button class="rainbow-gradient-btn m-0" type="button" name="submit"><span>Update Info</span></button>
                                                </div>
                                            </div>
                                        </form>
                                        <!-- End Profile Row  -->
                                    </div>

                                    <div class="tab-pane fade" id="password" role="tabpanel" aria-labelledby="password-tab">
                                        <!-- Start Address Row  -->
                                        <form action="{{ route('dealer.updateAddress') }}" class="rbt-profile-row rbt-default-form row row--15" id="update_profile_address" method="post" enctype="multipart/form-data">
                                            @csrf    
                                            <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                                <div class="form-group">
                                                    <label>Address line 1</label>
                                                    <input type="text" name="address" id="address" placeholder="Address line 1" value="{{ auth()->user()->address }}" class="required">
                                                </div>
                                            </div>
                                            <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                                <div class="form-group">
                                                    <label>Address line 2 (optional)</label>
                                                    <input type="text" name="address2" placeholder="Address line 2 (optional)" value="{{ auth()->user()->address2 }}">
                                                </div>
                                            </div>
                                            <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                                <div class="form-group">
                                                    <label for="username">ZIP Code</label>
                                                    <input type="text" name="zip_code" id="zip_code" placeholder="ZIP Code" class="required" value="{{ auth()->user()->zip_code }}">
                                                </div>
                                            </div>
                                            <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                                                <div class="form-group">
                                                    <label for="username">City</label>
                                                    <input type="text" name="city" id="city" placeholder="City" class="required" value="{{ auth()->user()->city }}">
                                                    <input type="hidden" name="state" id="state" placeholder="State" class="required"  value="{{ auth()->user()->state }}" />
                                                    <input type="hidden" name="country" id="country" placeholder="USA" value="{{ auth()->user()->country }}" />
                                                    <input type="hidden" name="latitude" id="latitude" placeholder="State" value="{{ auth()->user()->latitude }}" />
                                                    <input type="hidden" name="longitude" id="longitude" placeholder="USA" value="{{ auth()->user()->longitude }}" />
                                                </div>
                                            </div>
                                            <div class="col-12 mt--20">
                                                <div class="form-group mb--0">
                                                    <button class="rainbow-gradient-btn m-0" type="button" name="submit"><span>Update Address</span></button>
                                                </div>
                                            </div>
                                        </form>
                                        <!-- End Address Row  -->
                                    </div>
                                    <div class="tab-pane fade" id="delaccount" role="tabpanel" aria-labelledby="del-account-tab">
                                        <!-- Start Password Row  -->
                                        @if(!auth('dealer')->user()->social_account)
                                        <form action="" class="rbt-profile-row rbt-default-form row row--15" id="update_password_form">
                                            @csrf      
                                            <div class="col-12">
                                                <div class="form-group">
                                                    <label for="currentpassword">Current Password</label>
                                                    <input type="password" name="current_password" id="current_password" class="required" placeholder="Current Password">
                                                </div>
                                            </div>
                                            <div class="col-12">
                                                <div class="form-group">
                                                    <label for="newpassword">New Password</label>
                                                    <input type="password" name="new_password" id="new_password" class="required" placeholder="New Password">
                                                </div>
                                            </div>
                                            <div class="col-12">
                                                <div class="form-group">
                                                    <label for="retypenewpassword">Re-type New Password</label>
                                                    <input type="password" name="new_confirm_password" id="new_confirm_password" class="required" placeholder="Re-type New Password">
                                                </div>
                                            </div>
                                            <div class="col-12 mt--20">
                                                <div class="form-group mb--0">
                                                    <button type="button" id="update_password_btn" class="rainbow-gradient-btn m-0"><span>Update Password</span></button>
                                                </div>
                                            </div>
                                        </form>
                                        @endif
                                        <!-- End Password Row  -->
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>

        </div>
    </div>
    <!-- End Main content  -->

    </div>
</main>

<!-- Start thank_you Modal  -->
<div id="thank_you" class="modal rbt-modal-box fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content wrapper top-flashlight leftside light-xl modal-small text-center align-items-center">
            <p class="b1 text-center mb--0 successmsgdiv"></p>
            <div class="bottom-btn mt--20 w-100">
                <button data-bs-dismiss="modal" class="btn-default btn-border btn-small round" onclick="showhide('authscreen','loginscreen');">Ok</button>
            </div>
            <button class="close-button" data-bs-dismiss="modal">
                <i class="feather-x"></i>
            </button>
        </div>
    </div>
</div>
<!-- End thank_you Modal  -->

@endsection

@push ('after-scripts')
<script src="https://maps.googleapis.com/maps/api/js?key={{ env('GOOGLE_PLACE_API')  }}&libraries=places"></script>
<script>

jQuery(document).ready(function(){
      var input = document.getElementById('address');
      var autocomplete = new google.maps.places.Autocomplete(input);
      google.maps.event.addListener(autocomplete, 'place_changed', function(){
         var place = autocomplete.getPlace();
        
        var address = place.formatted_address;
        var latitude = place.geometry.location.lat();
        var longitude = place.geometry.location.lng();

         var reverse_components = place.address_components.reverse(); /*reverse the main array, so less itrations will fall */
       
         document.getElementById('latitude').value = latitude;
	     document.getElementById('longitude').value = longitude;
         for(var index in reverse_components){
                
                if(typeof reverse_components[index]['types']!='undefined')	/* check if the address type is there or not */
                {
                    
                    for(var inner_index in reverse_components[index]['types'])
                    {
                        
                        if(reverse_components[index]['types'][inner_index]=="country") /* COUNTRY OF THE ADDRESS */
                        {
                            var country_address = reverse_components[index]['long_name'];
                            $('#country').val(country_address);
                            break;
                        }
                        if(reverse_components[index]['types'][inner_index]=="postal_code") /* COUNTRY OF THE ADDRESS */
                        {
                            var postal_codes = reverse_components[index]['long_name'];
                            $('#zip_code').val(postal_codes);
                            break;
                        }
                        if(reverse_components[index]['types'][inner_index]=='sublocality_level_1') /* COUNTRY OF THE ADDRESS */
                        {
                            //var city = reverse_components[index]['long_name'];
                            //$('#city').val(city);
                            break;
                        }
                        
                        
                        if(reverse_components[index]['types'][inner_index]=='administrative_area_level_2') 
                        {
                            
                            var city = reverse_components[index]['long_name'];
                            $('#city').val(city);
                            break;
                        }
                        if(reverse_components[index]['types'][inner_index]=='administrative_area_level_1') 
                        {
                            
                            var statelongname=reverse_components[index]['long_name'];
                            jQuery('#state').val(statelongname);
                            break;
                        }
                    }
                }
            }
      })
});
</script>

<script>


$('#update_profile_address button').click(function(e){
    e.preventDefault();
    $('#update_profile_address button').find('span').text('Please wait...');
    $('#update_profile_address button').attr('disabled','disabled');
    
    if($('#update_profile_address').valid())
    {    
        url = '{{route('dealer.updateAddress')}}';

        var formData = new FormData($('#update_profile_address')[0]);
        
        uploadajax(url, formData, 'post', '', 'json', function(output) {
            // var output = JSON.parse(res);
            $('#update_profile_address button').find('span').text('Save Address ');
            $('#update_profile_address button').removeAttr('disabled');
            if (output.success) 
            {
               // $('#update_profile_address')[0].reset();	
                
                $('.successmsgdiv').html(output.message)
                $('#thank_you').modal('show');
                
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
        $('#update_profile_address button').find('span').text('Save Address');
        $('#update_profile_address button').removeAttr('disabled');
    }
});
$('#update_profile_dashbaord button').click(function(e){
    e.preventDefault();
    $('#update_profile_dashbaord button').find('span').text('Please wait...');
    $('#update_profile_dashbaord button').attr('disabled','disabled');
    
    if($('#update_profile_dashbaord').valid())
    {    
        url = '{{route('dealer.updateProfile')}}';

        var formData = new FormData($('#update_profile_dashbaord')[0]);
        
       
        
        uploadajax(url, formData, 'post', '', 'json', function(output) {
            // var output = JSON.parse(res);
            $('#update_profile_dashbaord button').find('span').text('Update Profile ');
            $('#update_profile_dashbaord button').removeAttr('disabled');
            if (output.success) 
            {
                //$('#update_profile_dashbaord')[0].reset();	
                $('.successmsgdiv').html(output.message)
                $('#thank_you').modal('show');
                
            }else{
                
                for (var key in output.data){
                    console.log('hdelo')
                    existvalue= $('#update_'+key).val();
                    jQuery.validator.addMethod(key+"error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.data[key][0]));
                    jQuery('#update_'+key).addClass(key+"error");
                    jQuery('#update_'+key).valid();
                }
                    
            }
        }); 
    }else{
        $('#update_profile_dashbaord button').find('span').text('Update Profile');
        $('#update_profile_dashbaord button').removeAttr('disabled');
    }
});

$('#update_password_form button').click(function(e){
    e.preventDefault();
    $('#update_password_form button').find('span').text('Please wait...');
    $('#update_password_form button').attr('disabled','disabled');
    
    if($('#update_password_form').valid())
    {    
        url = '{{route('dealer.changePassword')}}';

        var formData = new FormData($('#update_password_form')[0]);
        
       
        
        uploadajax(url, formData, 'post', '', 'json', function(output) {
            // var output = JSON.parse(res);
            $('#update_password_form button').find('span').text('Change Password ');
            $('#update_password_form button').removeAttr('disabled');
            if (output.success) 
            {
                //$('#update_profile_dashbaord')[0].reset();	
                $('.successmsgdiv').html(output.message)
                $('#thank_you').modal('show');
                
            }else{
                console.log(output);
                if (output.data.length === 0) {
                    key ='current_password';
                   
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
    }else{
        $('#update_password_form button').find('span').text('Update Profile');
        $('#update_password_form button').removeAttr('disabled');
    }
});

</script>
@endpush