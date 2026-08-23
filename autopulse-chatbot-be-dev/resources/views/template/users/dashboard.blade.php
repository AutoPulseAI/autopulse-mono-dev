@extends('layouts.app')
 
@section('content')
@php #dd(auth()->user()->social_account) @endphp
<section class="account_main" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-3 col-12">
                @include('template.users.include.user-sidebar')
               
            </div>
            <div class="col col-lg-9 col-12">
                <!-- Vehicles Of Interest -->
                <div class="acc_right_main">
                    <div class="acc_page_head sticky" id="acc_page_head">
                        <div class="row align-items-center">
                            <div class="col col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    <div class="acc_page_heading">
                                        <h3>Profile Settings</h3>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="acc_page_content">

                        <div class="row justify-content-center">
                            <div class="col col-lg-6 col-md-8 col-12">
                                <!-- Update Profile Form -->
                                <div class="acc_profile_address acc_page_box">
                                    <h4>Update Profile</h4>
                                    <hr>
                                  
                                    <form action="{{ route('updateProfile') }}" class="row" id="update_profile_dashbaord" method="post" enctype="multipart/form-data">  
                                        @csrf    
                                        <div class="col col-md-6 col-6">
                                            <input type="text" id="name" name="name" placeholder="Enter First Name"  value="{{ auth()->user()->name }}" class="form-control required">
                                           
                                        </div>
                                        <div class="col col-md-6 col-6">
                                            <input type="text" id="last_name"  name="last_name" placeholder="Enter Last Name*" value="{{ auth()->user()->last_name }}" class="form-control required">
                                        </div>
                                        <div class="col col-md-12 col-12">
                                            <input type="text" name="phone_number" id="phone_number" class="form-control" placeholder="Enter Mobile Number" value="{{ auth()->user()->phone_number }}" >
                                        </div>
                                        <div class="col col-md-12 col-12">
                                            <input type="text" id="email" name="email" placeholder="Enter Email Id*" value="{{ auth()->user()->email }}" class="form-control required email" @if(auth()->user()->social_account) readonly @endif>
                                           
                                        </div>

                                        <div class="col col-md-12 col-12 mt-0">
                                            <div class="position-relative text-center">
                                                <button type="button" id="" name="submit" class="btn btn_theme">Save Changes</button> 
                                            </div>
                                        </div> 
                                    </form>
                                </div>
                            </div>

                            <div class="col col-lg-6 col-md-8 col-12">
                                <!-- Add Address Form -->
                                <div class="acc_profile_address acc_page_box">
                                    <h4>Add Address</h4>
                                    <hr>
                                    <form action="{{ route('updateAddress') }}" class="row" id="update_profile_address" method="post" enctype="multipart/form-data">                                     
                                       @csrf
                                        <div class="col col-md-12 col-12">
                                            <input type="text" name="address" id="address" placeholder="Address line 1" value="{{ auth()->user()->address }}" class="form-control required"  />
                                            
                                        </div>
                                        <div class="col col-md-12 col-12">
                                            <input type="text" name="address2" class="form-control" placeholder="Address line 2 (optional)" value="{{ auth()->user()->address2 }}" >
                                        </div>
                                        <div class="col col-md-6 col-6">
                                           
                                            <input type="text" name="zip_code" id="zip_code" placeholder="ZIP Code"    class="form-control required" value="{{ auth()->user()->zip_code }}" />
                                            
                                        </div>
                                        <div class="col col-md-6 col-6">
                                            <input type="text" name="city" id="city" placeholder="City" value="{{ auth()->user()->city }}" class="form-control required"  />
                                            <input type="hidden" name="state" id="state" placeholder="State"    class="form-control required"  value="{{ auth()->user()->state }}" />
                                            <input type="hidden" name="country" id="country" placeholder="USA"   value="{{ auth()->user()->country }}" />
                                            <input type="hidden" name="latitude" id="latitude" placeholder="State"    class="form-control "  value="{{ auth()->user()->latitude }}" />
                                            <input type="hidden" name="longitude" id="longitude" placeholder="USA"   value="{{ auth()->user()->longitude }}" />
                                        </div>
                                        <div class="col col-md-12 col-12 mt-0">
                                            <div class="position-relative text-center">
                                            <button type="button" class="btn btn_theme">Save Address</button>
                                            </div>
                                        </div> 
                                    </form>
                                </div>
                            </div>

                             <!-- Change Password start -->
                             @if(!auth()->user()->social_account)
                             <!-- Change Password start -->
                                <div class="col col-lg-12 col-md-8 col-12">
                                    <!-- Change Password Form -->
                                    <div class="acc_profile_address acc_page_box">
                                        <h4>Change Password</h4>
                                        <hr>
                                        <form action="" class="row" id="update_password_form">   
                                            @csrf   
                                            <div class="col col-md-4 col-12">
                                                <input type="password" name="current_password" id="current_password" class="form-control" placeholder="Current Password">
                                            </div>
                                            <div class="col col-md-4 col-12">
                                                <input type="password"  name="new_password" id="new_password" class="form-control" placeholder="New Password">
                                            </div>
                                            <div class="col col-md-4 col-12">
                                                <input type="password"  name="new_confirm_password" id="new_confirm_password" class="form-control" placeholder="Re-enter Password">
                                            </div>
                                            <div class="col col-md-12 col-12 mt-0">
                                                <div class="position-relative text-center">
                                                    <button type="button"  id="update_password_btn" class="btn btn_theme">Save Changes</button>
                                                </div>
                                            </div> 
                                        </form>
                                    </div>
                                </div>
                            @endif
                            <!-- Change Password end -->
                        </div>

                    </div>
                    

                    
                </div>

            </div>
        </div>
    </div>
</section>
  

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
    $('#update_profile_address button').text('Please wait...');
    $('#update_profile_address button').attr('disabled','disabled');
    
    if($('#update_profile_address').valid())
    {    
        url = '{{route('updateAddress')}}';

        var formData = new FormData($('#update_profile_address')[0]);
        
        uploadajax(url, formData, 'post', '', 'json', function(output) {
            // var output = JSON.parse(res);
            $('#update_profile_address button').text('Save Address ');
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
        $('#update_profile_address button').text('Save Address');
        $('#update_profile_address button').removeAttr('disabled');
    }
});
$('#update_profile_dashbaord button').click(function(e){
    e.preventDefault();
    $('#update_profile_dashbaord button').text('Please wait...');
    $('#update_profile_dashbaord button').attr('disabled','disabled');
    
    if($('#update_profile_dashbaord').valid())
    {    
        url = '{{route('updateProfile')}}';

        var formData = new FormData($('#update_profile_dashbaord')[0]);
        
        uploadajax(url, formData, 'post', '', 'json', function(output) {
            // var output = JSON.parse(res);
            $('#update_profile_dashbaord button').text('Update Profile ');
            $('#update_profile_dashbaord button').removeAttr('disabled');
            if (output.success) 
            {
                //$('#update_profile_dashbaord')[0].reset();	
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
        $('#update_profile_dashbaord button').text('Update Profile');
        $('#update_profile_dashbaord button').removeAttr('disabled');
    }
});

$('#update_profile_dashbaord button').click(function(e){
    e.preventDefault();
    $('#update_profile_dashbaord button').text('Please wait...');
    $('#update_profile_dashbaord button').attr('disabled','disabled');
    
    if($('#update_profile_dashbaord').valid())
    {    
        url = '{{route('updateProfile')}}';

        var formData = new FormData($('#update_profile_dashbaord')[0]);
        
        uploadajax(url, formData, 'post', '', 'json', function(output) {
            // var output = JSON.parse(res);
            $('#update_profile_dashbaord button').text('Update Profile ');
            $('#update_profile_dashbaord button').removeAttr('disabled');
            if (output.success) 
            {
                //$('#update_profile_dashbaord')[0].reset();	
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
        $('#update_profile_dashbaord button').text('Update Profile');
        $('#update_profile_dashbaord button').removeAttr('disabled');
    }
});

$('#update_password_form button').click(function(e){
    e.preventDefault();
    $('#update_password_form button').text('Please wait...');
    $('#update_password_form button').attr('disabled','disabled');
    
    if($('#update_password_form').valid())
    {    
        url = '{{route('user.changePassword')}}';

        var formData = new FormData($('#update_password_form')[0]);
        
       
        
        uploadajax(url, formData, 'post', '', 'json', function(output) {
            // var output = JSON.parse(res);
            $('#update_password_form button').text('Change Password ');
            $('#update_password_form button').removeAttr('disabled');
            if (output.success) 
            {
                //$('#update_profile_dashbaord')[0].reset();	
                $('.successmsgdiv').html(output.message)
                $('#thank_you').modal('show');
                
            }else{
                
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
        $('#update_password_form button').text('Update Profile');
        $('#update_password_form button').removeAttr('disabled');
    }
});
</script>
@endpush