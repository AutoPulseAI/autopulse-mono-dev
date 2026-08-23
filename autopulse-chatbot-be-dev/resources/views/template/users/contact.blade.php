@extends('layouts.front')
@section('title', 'Contact Autopulse AI | Customizable AI Solutions for Automotive Dealerships')

@section('meta_description', ' Meta Description: Contact Autopulse AI today to learn how our AI-powered chatbot, real-time live inventory, and customizable solutions can elevate your automotive dealership’s digital experience. Start your journey with us in just minutes.')
@section('content')
<section class="position-relative contact_page" id="subpage_mt">

    <!-- Contact Us -->
    <div class="position-relative section_padding">
        <div class="container">
            <div class="row justify-content-center">
                <div class="col col-lg-6 col-md-9 col-12">
                    <div class="contact_content">
                        <div class="section_heading">
                            <h2>Contact Us</h2>
                        </div>
                        <p>Fill out the form and our team will try to get back to you within 24 hours.</p>
                        <div class="contact_email">
                        @if(isset($setting['website_email']) && !empty($setting['website_email']))  
                            <p class="mb-1"><small>Email Id</small></p>
                            <h5>{{$setting['website_email']}}</h5>
                        @endif
                        </div>

                    </div>
                </div>
                <div class="col col-lg-6 col-md-9 col-12">
                    <div class="contact_form">
                        <form action="" class="row" id="contactus">
                            @csrf
                            <div class="col col-12">
                                <input type="text" name ="name" id ="name" class="form-control required" placeholder="Enter Full Name">
                            </div>
                            <div class="col col-12">
                                <input type="text" name ="email" id ="email"  class="form-control required email" placeholder="Enter Email Id">
                            </div>
                            <div class="col col-12">
                                <input type="phone" name ="phone" id ="phone"  class="form-control required " placeholder="Enter Phone number">
                            </div>
                            
                            <div class="col col-12">
                                <textarea class="form-control required"  id ="message"  name="message" rows="3"></textarea>
                            </div>

                            <div class="col col-md-12 col-12 mt-0">
                                <div class="position-relative text-center">
                                <button id ="contactbtn"type="submit" class="btn btn_theme">Submit</button>
                                </div>
                            </div> 
                        </form>
                    </div>
                </div>
                
            </div>
        </div>
    </div>

</section>


@endsection
@push ('after-scripts')
<script>
$('#contactus').submit(function(e){
    e.preventDefault();

       if($('#contactus').valid())
       
       {   
      
        url = '{{ route("contactus.post") }}';
           var formData = $('#contactus').serialize();
           var originalText = $('#contactbtn').text();
   
               // Change the text of the button to indicate processing
           $('#contactbtn').text('Please wait...').prop('disabled', true);
   
           runajax(url, formData, 'post', '', 'json', function(output) {
               
               $('#contactbtn').text(originalText).prop('disabled', false);
               if (output.success) 
               {
                   $('.successmsgdiv').html('Thank you your query have been sumitted. Please Contact soon.')
                   $('#thank_you').modal('show');

                   $('#contactus')[0].reset();	
                   
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
</script>
@endpush
