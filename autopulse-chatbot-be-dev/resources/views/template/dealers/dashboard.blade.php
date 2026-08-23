@extends('layouts.dealer')
 
@section('content')
<section class="account_main" id="subpage_mt">
    <div class="container">
        <div class="row">
             <div class="col col-lg-3 col-12">
                @include('template.dealers.include.sidebar')
               
            </div>
            <div class="col col-lg-9 col-12">
                <!-- Dashboard -->
                 <!-- Vehicles Of Interest -->
                @php
                    $user = Auth::guard('dealer')->user();  // Get the authenticated user
                @endphp
                <div class="acc_right_main dealer_account">
                    <div class="acc_page_head sticky" id="acc_page_head">
                        <div class="row align-items-center">
                            <div class="col col-md-3 col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    <div class="acc_page_heading">
                                        <h3>Dashboard</h3>
                                    </div>
                                </div>                                
                            </div>
                            <div class="col col-md-9 col-12">
                                <form class="row justify-content-end gx-1 mt-2 mt-md-0">                                            
                                    <div class="col col-lg-4 col-md-6 col-12">
                                        <select class="form-select mb-lg-0 mb-2" id="source" name="source" >
                                            <option>All Stores</option>

                                            @foreach($storeList as $key =>$value)
                                            <option value="{{ $value->source }}" {{ request('source') == $value->source ? 'selected' : '' }}>{{ $value->dealership_name }}</option>
                                            @endforeach

                                        
                                        </select>
                                    </div>
                                    
                                    <div class="col col-lg-2 col-md-2 col-6">
                                        <button type="submit" class="btn btn_theme w-100">Search</button>
                                    </div>
                                    <div class="col col-lg-2 col-md-2 col-6">
                                        <a href="{{ route('dealer.dashboard') }}" class="btn btn_theme w-100">Reset</a>
                                    </div>
                                </form>
                            </div>
                        </div>

                        @if($user && !$user->email_verified_at)
                            <div class="alert alert-danger" role="alert">
                                Your email address is not verified. Please verify it to access all features. <a href="{{route('dealer.sendverify')}}"> Send Verification Mail </a>
                            </div>
                        @endif
                        @if (session('success'))
                            <div class="alert alert-success">
                                {{ session('success') }}
                            </div>
                        @endif

                        @if (session('error'))
                            <div class="alert alert-danger">
                                {{ session('error') }}
                            </div>
                        @endif
                    </div>

                    <div class="row gx-2 mb-2">
                        <div class="col col-md-4 col-6">
                            <div class="bordered_card text_dark">
                                <p class="text_dark">Total no. view</p>
                                <h4>{{ $visitCount}}</h4>
                            </div>
                        </div>
                        @can('view lead', 'dealer')
                        <div class="col col-md-4 col-6">
                            <a href="{{ route('dealer.mylead') }}">
                                <div class="bordered_card text_dark">
                                    <p class="text_dark">Total leads</p>
                                    <h4>{{ $totalCount}}</h4>
                                </div>
                            </a>
                        </div>
                        
                        @can('View Store Vehicles', 'dealer')
                        <div class="col col-md-4 col-12">
                            <a href="{{ route('dealer.myvehicle') }}">
                                <div class="bordered_card text_dark">
                                    <p class="text_dark">Total number of car listed</p>
                                    <h4>{{ $vehiclecount}}</h4>
                                </div>
                            </a>
                        </div>
                        
                        
                    </div>

                    <!-- Total Patient Record -->
                    <div class="row mb-4">
                        <div class="col col-12">
                            <div class="acc_sec_heading mb-3">
                                <h4>Quick Navigation</h4>
                            </div>
                        </div>
                       
                        <div class="col col-lg-4 col-md-4 col-12 mb-md-0 mb-2">
                            <div class="position-relative">
                                <a href="{{ route('dealer.stores') }}#storeForm" class="btn btn_theme_outline w-100"><i class="fa-solid fa-store"></i>&nbsp;&nbsp;|&nbsp;&nbsp;Add New Store</a>
                            </div>
                        </div>
                        

                      
                        <div class="col col-lg-4 col-md-4 col-12 mb-md-0 mb-2">
                            <div class="position-relative">
                                <a href="{{ route('dealer.role') }}#roleForm" class="btn btn_theme_outline w-100"><i class="fa-solid fa-gear"></i>&nbsp;&nbsp;|&nbsp;&nbsp;Create New Role</a>
                            </div>
                        </div>
                        

                        @can('manage employee', 'dealer')
                        <div class="col col-lg-4 col-md-4 col-12 mb-md-0 mb-2">
                            <div class="position-relative">
                                <a href="{{ route('dealer.employee') }}#employeeForm" class="btn btn_theme_outline w-100"><i class="fa-solid fa-user-plus"></i>&nbsp;&nbsp;|&nbsp;&nbsp;Add Employee</a>
                            </div>
                        </div>    
                                 
                    </div>
                    @can('view lead', 'dealer')
                        <div class="acc_page_content acc_page_box">                        
                            <div class="position-relative">
                                <div class="acc_sec_heading">
                                    <h4>Recent Leads</h4>
                                </div>
                                <hr>
                                @if ($paginator->isEmpty())
                                        <div class="no_cars_available py-5">
                                            <p class="mb-0"><span>No Cars Available</span></p>
                                        </div>
                                @else
                                
                                    @foreach ($paginator->items() as $key => $row)
                                        @php
                                        
                                            $item = $row->additional_data ?? [];
                                        @endphp
                                            <div class="dealer_lead_card">
                                                <div class="row gx-1">
                                                    <div class="col col-md-5 col-12">
                                                        <div class="car_card dealer_details_card">
                                                            <a href="javascript:;" onclick='viewCar("{{ $row['vin'] }}")' class="car_card_main">
                                                                <div class="car_card_img">          
                                                                    <img src="{{ $item['media']['photo_links'][0]??'' }}" alt="Car Image">
                                                                </div>
                                                                <div class="car_card_info">
                                                                    <div class="car_title_price">
                                                                    <h4>{{ $item['build']['make'] ??'' }} {{ $item['build']['model']??'' }} </h4>
                                                                        <div class="car_spec mb-0">
                                                                            <div class="car_spec_info">
                                                                                <span>VIN: {{ $item['vin'] ?? ''}}</span>
                                                                            </div>
                                                                        </div>                
                                                                    </div>
                                                                </div>
                                                            </a>
                                                        </div>
                                                    </div>
                                                    <div class="col col-md-4 col-6">
                                                        <div class="leads_by">
                                                            <p class="mb-0"><i class="fa-solid fa-user me-2"></i><span>{{ $row->user['name']}} {{ $row->user['last_name']}}</span><small class="text_secondary ms-1">{{ $row->created_at->diffForHumans() }}</small></p>
                                                        </div>
                                                    </div>
                                                    <div class="col col-md-3 col-6">
                                                        <div class="d-flex align-items-center">
                                                            <a href="javascript:;" onclick="viewCustomer('{{$row['id']}}')"  class="text_primary ms-auto"><small>View Customer Details<i class="fa-solid fa-angle-right ms-2"></i></small></a>
                                                        </div>
                                                    </div>
                                                </div>                            
                                            </div>
                                        @endforeach
                                    @endif
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

$('#update_profile_page button').click(function(e){
    e.preventDefault();
    $('#update_profile_page button').text('Please wait...');
    $('#update_profile_page button').attr('disabled','disabled');
    
    if($('#update_profile_page').valid())
    {    
        url = '{{route('dealer.updateProfile')}}';

        var formData = new FormData($('#update_profile_page')[0]);
        
        uploadajax(url, formData, 'post', '', 'json', function(output) {
            // var output = JSON.parse(res);
            $('#update_profile_page button').text('Update Profile ');
            $('#update_profile_page button').removeAttr('disabled');
            if (output.success) 
            {
                $('#update_profile_page')[0].reset();	
                
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
        $('#update_profile_page button').text('Update Profile');
        $('#update_profile_page button').removeAttr('disabled');
    }
});

</script>
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
@endpush